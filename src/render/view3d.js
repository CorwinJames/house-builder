import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ASSEMBLY_3D, FINISH_3D } from "../theme.js";
import { formatFeet } from "../lib/format.js";
import { openingsFor, wallLength, wallPieces } from "../lib/geom.js";
import { LAYER_IDS, wallLayerId } from "../layers.js";
import { isFutureShown } from "./visibility.js";
import { offsetSegment, planDimensions } from "./dimensions.js";
import { createHipAndGableGeometry, roofFootprint } from "./roof.js";

/**
 * 3D model. Plan +x (east) is Three.js +X, plan +y (north) is Three.js −Z,
 * and height is Three.js +Y. The default camera sits south of the house
 * so the rammed-earth wall is in front.
 *
 * Electrical, plumbing, and site groups are created empty on purpose.
 */
export function createView3d(canvas, initialHouse) {
  let house = initialHouse;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (error) {
    return failedView(String(error));
  }
  if (!renderer.getContext()) return failedView("WebGL is not available in this browser.");

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xd5e3ea, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd5e3ea);
  scene.fog = new THREE.Fog(0xd5e3ea, 110, 240);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  camera.position.set(-24, 28, 46);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(34, 6, -14);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 12;
  controls.maxDistance = 170;
  controls.update();

  scene.add(new THREE.AmbientLight(0xfff6ec, 0.38));
  scene.add(new THREE.HemisphereLight(0xf4f7f8, 0xcbb892, 0.72));
  const sun = new THREE.DirectionalLight(0xfff3df, 1.55);
  sun.position.set(-18, 46, 34);
  sun.target.position.set(38, 0, -23.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.00035;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(180, 48),
    new THREE.MeshStandardMaterial({ color: 0xe6dcc8, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(38, -0.04, -23.5);
  ground.receiveShadow = true;
  scene.add(ground);

  const buckets = {};
  const futureBuckets = {};
  for (const id of LAYER_IDS) {
    buckets[id] = new THREE.Group();
    buckets[id].name = id;
    futureBuckets[id] = new THREE.Group();
    futureBuckets[id].name = `${id}-future`;
    buckets[id].add(futureBuckets[id]);
    scene.add(buckets[id]);
  }

  const roofPivot = new THREE.Group();
  scene.add(roofPivot);
  let phaseRoof = buildRoof(house, false);
  let fullRoof = buildRoof(house, true);
  roofPivot.add(phaseRoof);
  roofPivot.add(fullRoof);

  let phaseSlab = buildSlab(house, false);
  let fullSlab = buildSlab(house, true);
  scene.add(phaseSlab);
  scene.add(fullSlab);

  const materials = createMaterials();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8d5a32, roughness: 0.72 });
  buildHouse(house, buckets, futureBuckets, materials, wood);

  let state = null;
  let onChange = () => {};
  let onPick = null;
  let selectedId = null;
  let appliedSavedCamera = false;
  let frameId = 0;

  function tick() {
    frameId = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  }
  tick();

  controls.addEventListener("end", () => {
    onChange(readCamera());
  });

  function readCamera() {
    return {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    };
  }

  function applySavedCamera(saved) {
    if (!saved?.position || !saved?.target) return;
    camera.position.fromArray(saved.position);
    controls.target.fromArray(saved.target);
    controls.update();
  }

  function applyVisibility(next) {
    const futureOn = isFutureShown(next);
    for (const id of LAYER_IDS) {
      buckets[id].visible = !!next.layers[id];
      futureBuckets[id].visible = futureOn;
    }
    phaseRoof.visible = !futureOn;
    fullRoof.visible = futureOn;
    phaseSlab.visible = !futureOn;
    fullSlab.visible = futureOn;
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
  }

  function emptyBucket(group) {
    for (const child of [...group.children]) {
      if (typeof child.name === "string" && child.name.endsWith("-future")) {
        emptyBucket(child);
        continue;
      }
      disposeObject(child);
      group.remove(child);
    }
  }

  function rebuild(nextHouse) {
    house = nextHouse;
    for (const id of LAYER_IDS) emptyBucket(buckets[id]);
    disposeObject(phaseRoof);
    disposeObject(fullRoof);
    roofPivot.remove(phaseRoof);
    roofPivot.remove(fullRoof);
    phaseRoof = buildRoof(house, false);
    fullRoof = buildRoof(house, true);
    roofPivot.add(phaseRoof);
    roofPivot.add(fullRoof);
    disposeObject(phaseSlab);
    disposeObject(fullSlab);
    scene.remove(phaseSlab);
    scene.remove(fullSlab);
    phaseSlab = buildSlab(house, false);
    fullSlab = buildSlab(house, true);
    scene.add(phaseSlab);
    scene.add(fullSlab);
    buildHouse(house, buckets, futureBuckets, materials, wood);
    if (state) applyVisibility(state);
    paintSelection();
  }

  function paintSelection() {
    scene.traverse((object) => {
      if (!object.userData?.wallId || !object.material?.emissive) return;
      const on = object.userData.wallId === selectedId;
      object.material.emissive.set(on ? 0x1f6b45 : 0x000000);
      object.material.emissiveIntensity = on ? 0.55 : 0;
    });
  }

  const raycaster = new THREE.Raycaster();
  let pointerDown = null;
  canvas.addEventListener("pointerdown", (event) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!pointerDown || !onPick) return;
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (moved > 6) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    const hit = hits.find((item) => item.object.userData?.wallId);
    onPick(hit?.object.userData.wallId || null);
  });

  function resetCamera() {
    camera.position.set(-24, 28, 46);
    controls.target.set(34, 6, -14);
    controls.update();
    onChange(readCamera());
  }

  return {
    setState(next) {
      state = next;
      if (!appliedSavedCamera) {
        if (next.camera) applySavedCamera(next.camera);
        appliedSavedCamera = true;
      }
      roofPivot.visible = next?.roof !== false;
      applyVisibility(next);
    },
    resize,
    resetCamera,
    setOnChange(fn) {
      onChange = fn;
    },
    setOnPick(fn) {
      onPick = fn;
    },
    setHouse(next) {
      rebuild(next);
    },
    setSelected(id) {
      selectedId = id;
      paintSelection();
    },
    dispose() {
      cancelAnimationFrame(frameId);
      controls.dispose();
      renderer.dispose();
    },
  };
}

function failedView(message) {
  return {
    failed: true,
    message,
    setState() {},
    resize() {},
    resetCamera() {},
    setOnChange() {},
    dispose() {},
  };
}

function rammedEarthTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  const bands = ["#C47856", "#9A4E36", "#B56A4A", "#8E4632", "#A85B3C", "#C47856"];
  const band = canvas.height / bands.length;
  bands.forEach((color, index) => {
    g.fillStyle = color;
    g.fillRect(0, index * band, canvas.width, band);
    g.fillStyle = "rgba(50, 18, 8, 0.2)";
    g.fillRect(0, (index + 1) * band - 4, canvas.width, 4);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 3);
  return texture;
}

function createMaterials() {
  const rammed = rammedEarthTexture();
  const solid = {};
  const ghost = {};
  for (const [name, color] of Object.entries(ASSEMBLY_3D)) {
    const mapped = name === "rammed-earth";
    solid[name] = new THREE.MeshStandardMaterial({
      color: mapped ? 0xffffff : color,
      map: mapped ? rammed : null,
      roughness: 0.92,
      metalness: 0,
    });
    ghost[name] = new THREE.MeshStandardMaterial({
      color: mapped ? 0xffffff : color,
      map: mapped ? rammed : null,
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
  }
  solid.glass = new THREE.MeshStandardMaterial({
    color: 0xb7d4de,
    roughness: 0.08,
    metalness: 0.05,
    transparent: true,
    opacity: 0.45,
  });
  ghost.glass = solid.glass.clone();
  ghost.glass.opacity = 0.28;
  ghost.glass.depthWrite = false;
  solid.door = new THREE.MeshStandardMaterial({ color: 0x6e4b32, roughness: 0.78 });
  ghost.door = solid.door.clone();
  ghost.door.transparent = true;
  ghost.door.opacity = 0.45;
  ghost.door.depthWrite = false;
  solid.overhead = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.7 });
  ghost.overhead = solid.overhead.clone();
  ghost.overhead.transparent = true;
  ghost.overhead.opacity = 0.45;
  ghost.overhead.depthWrite = false;
  const finishes = {};
  const finishGhost = {};
  for (const [name, color] of Object.entries(FINISH_3D)) {
    finishes[name] = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    finishGhost[name] = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
  }
  return { solid, ghost, finishes, finishGhost };
}

function buildHouse(house, buckets, futureBuckets, materials, wood) {
  for (const room of house.rooms) {
    const parent = room.phase === "future" ? futureBuckets.finishes : buckets.finishes;
    parent.add(roomFloor(room, materials));
    const labels = room.phase === "future" ? futureBuckets.labels : buckets.labels;
    labels.add(roomLabel(room));
  }
  for (const wall of house.walls) {
    const layer = wallLayerId(wall);
    const parent = wall.phase === "future" ? futureBuckets[layer] : buckets[layer];
    const mats = wall.phase === "future" ? materials.ghost : materials.solid;
    addWallMeshes(wall, openingsFor(house, wall), parent, mats);
    const frameParent = wall.phase === "future" ? futureBuckets.framing : buckets.framing;
    addOpeningFrames(wall, openingsFor(house, wall), frameParent, wood, wall.phase === "future");
  }
  addDimensions(house, false, buckets.dimensions);
  addDimensions(house, true, futureBuckets.dimensions);
}

function roomFloor(room, materials) {
  if (!room.polygon || room.polygon.length < 3) return new THREE.Group();
  const shape = new THREE.Shape();
  const [first, ...rest] = room.polygon;
  shape.moveTo(first.x, first.y);
  for (const point of rest) shape.lineTo(point.x, point.y);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const material = room.phase === "future" ? materials.finishGhost[room.finish] : materials.finishes[room.finish];
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.03;
  mesh.receiveShadow = true;
  return mesh;
}

function roomLabel(room) {
  const at = room.labelAt || centroid(room.polygon);
  const sprite = makeSprite(room.name, room.phase === "future");
  sprite.position.set(at.x, 8.4, -at.y);
  return sprite;
}

function centroid(polygon) {
  let areaTwice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    areaTwice += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(areaTwice) < 1e-8) return polygon[0];
  return { x: cx / (3 * areaTwice), y: cy / (3 * areaTwice) };
}

function addWallMeshes(wall, openings, parent, mats) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = wallLength(wall) || 1;
  const angle = Math.atan2(dy, dx);
  const ux = dx / len;
  const uy = dy / len;

  function place(s0, s1, z0, z1, thickness, material) {
    const length = Math.max(0.02, s1 - s0);
    const height = Math.max(0.02, z1 - z0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), material.clone());
    const s = (s0 + s1) / 2;
    mesh.position.set(wall.start.x + ux * s, (z0 + z1) / 2, -(wall.start.y + uy * s));
    mesh.rotation.y = angle;
    mesh.castShadow = material.transparent !== true;
    mesh.receiveShadow = true;
    mesh.userData.wallId = wall.id;
    parent.add(mesh);
  }

  for (const piece of wallPieces(wall, openings)) {
    if (piece.kind === "solid") {
      const z0 = piece.z0 === 0 ? 0.02 : piece.z0;
      place(piece.s0, piece.s1, z0, piece.z1, wall.thickness, mats[wall.assembly]);
      continue;
    }
    if (piece.kind === "window") {
      place(piece.s0 + 0.05, piece.s1 - 0.05, piece.z0 + 0.05, piece.z1 - 0.05, 0.06, mats.glass);
    } else if (piece.kind === "overhead") {
      place(piece.s0 + 0.08, piece.s1 - 0.08, 0.08, piece.z1 - 0.08, 0.16, mats.overhead);
    } else if (piece.kind === "swing" || piece.kind === "sliding") {
      place(piece.s0 + 0.06, piece.s1 - 0.06, 0.04, piece.z1 - 0.04, piece.kind === "sliding" ? 0.08 : 0.14, piece.kind === "sliding" ? mats.glass : mats.door);
    }
  }
}

function addOpeningFrames(wall, openings, parent, wood, future) {
  const length = wallLength(wall) || 1;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const angle = Math.atan2(dy, dx);
  const ux = dx / length;
  const uy = dy / length;
  const material = wood.clone();
  if (future) {
    material.transparent = true;
    material.opacity = 0.55;
    material.depthWrite = false;
  }
  const stud = 0.125;
  function member(s0, s1, z0, z1, thickness) {
    const span = Math.max(0.04, s1 - s0);
    const height = Math.max(0.04, z1 - z0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(span, height, thickness), material);
    const s = (s0 + s1) / 2;
    mesh.position.set(wall.start.x + ux * s, (z0 + z1) / 2, -(wall.start.y + uy * s));
    mesh.rotation.y = angle;
    mesh.castShadow = !future;
    mesh.userData.wallId = wall.id;
    parent.add(mesh);
  }
  for (const opening of openings) {
    const header = opening.header;
    const headBottom = opening.sill + opening.height;
    const headTop = Math.min(wall.height, headBottom + (header?.height || 0.5));
    member(opening.offset - stud, opening.offset + opening.width + stud, headBottom, headTop, Math.min(wall.thickness, header?.depth || 0.25));
    member(opening.offset - stud * 2.2, opening.offset - stud * 0.6, 0.05, wall.height, Math.min(wall.thickness * 0.85, 0.3));
    member(opening.offset + opening.width + stud * 0.6, opening.offset + opening.width + stud * 2.2, 0.05, wall.height, Math.min(wall.thickness * 0.85, 0.3));
    member(opening.offset, opening.offset + stud, 0.05, headBottom, Math.min(wall.thickness * 0.7, 0.25));
    member(opening.offset + opening.width - stud, opening.offset + opening.width, 0.05, headBottom, Math.min(wall.thickness * 0.7, 0.25));
  }
}

function addDimensions(house, futureShown, parent) {
  const dims = planDimensions(house, futureShown).filter((dim) => dim.future === futureShown);
  for (const dim of dims) {
    const seg = offsetSegment(dim);
    const y = 0.25;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(seg.x0, y, -seg.y0),
      new THREE.Vector3(seg.x1, y, -seg.y1),
    ]);
    parent.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x2a241b })));
    const label = makeSprite(formatFeet(seg.len), false, 6);
    label.position.set((seg.x0 + seg.x1) / 2, 1.4, -((seg.y0 + seg.y1) / 2));
    parent.add(label);
  }
}

function buildSlab(house, futureShown) {
  const bounds = futureShown
    ? { x0: 0, y0: 0, x1: house.footprint.width, y1: house.footprint.depth }
    : house.phases.phase1.bounds;
  const w = bounds.x1 - bounds.x0;
  const d = bounds.y1 - bounds.y0;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.35, d),
    new THREE.MeshStandardMaterial({ color: 0xb7b2a8, roughness: 1 }),
  );
  mesh.position.set((bounds.x0 + bounds.x1) / 2, -0.175, -((bounds.y0 + bounds.y1) / 2));
  mesh.receiveShadow = true;
  return mesh;
}

function buildRoof(house, futureShown) {
  const footprint = roofFootprint(house, futureShown);
  const geometry = createHipAndGableGeometry({
    ...footprint,
    plate: house.roof.plateHeight,
    pitch: house.roof.pitchRiseOverRun,
  });
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x8c4634,
      roughness: 0.86,
      side: THREE.DoubleSide,
    }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  const label = makeSprite("Placeholder roof", false, 14);
  const midX = (footprint.x0 + footprint.x1) / 2;
  const midY = (footprint.y0 + footprint.y1) / 2;
  const rise = ((footprint.y1 - footprint.y0) / 2) * house.roof.pitchRiseOverRun;
  label.position.set(midX, house.roof.plateHeight + rise + 3.2, -midY);
  group.add(label);
  return group;
}

function makeSprite(text, muted, scaleWidth) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, 512, 128);
  roundRect(g, 12, 28, 488, 72, 28);
  g.fillStyle = muted ? "rgba(247, 243, 235, 0.78)" : "rgba(247, 243, 235, 0.92)";
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = muted ? "#6F6458" : "#2A241B";
  g.stroke();
  g.fillStyle = muted ? "#6F6458" : "#2A241B";
  g.font = "600 40px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  const width = scaleWidth ?? Math.min(8.5, Math.max(5.2, text.length * 0.42));
  sprite.scale.set(width, width * 0.25, 1);
  return sprite;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
