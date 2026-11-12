import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ASSEMBLY_3D, FINISH_3D } from "../theme.js";
import { formatFeet } from "../lib/format.js";
import { openingsFor, wallLength, wallPieces } from "../lib/geom.js";
import { LAYER_IDS, wallLayerId } from "../layers.js";
import { planToScene, sceneToPlan } from "../build/space.js";
import { SETBACKS } from "../site/design.js";
import { plainPlaceLabel } from "../electrical/design.js";
import { isFutureShown } from "./visibility.js";
import { offsetSegment, planDimensions } from "./dimensions.js";
import { createHipAndGableGeometry, roofFootprints } from "./roof.js";
import { roomGroundLine } from "../build/annotations.js";
import { areaKind } from "../build/areas.js";

/**
 * 3D model. Plan +x (east) is Three.js +X, plan +y (north) is Three.js −Z,
 * and height is Three.js +Y. The default camera sits south of the house
 * so the rammed-earth wall is in front.
 *
 * Build mode can edit this view with the same plan gestures. Orbit mode
 * looks around. Cutaway caps the walls so the rooms stay visible.
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
  scene.fog = new THREE.Fog(0xd5e3ea, 180, 900);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2500);
  camera.position.set(-24, 28, 46);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(34, 6, -14);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 12;
  controls.maxDistance = 1400;
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
  let cutaway = false;
  let editing = false;
  let buildHooks = null;
  let selection = null;
  const ghostGroup = new THREE.Group();
  ghostGroup.name = "ghosts";
  scene.add(ghostGroup);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  canvas.style.touchAction = "none";
  buildHouse(house, buckets, futureBuckets, materials, wood, { cutaway });
  fitGround(house, ground, scene, camera, controls);

  let state = null;
  let onChange = () => {};
  let onPick = null;
  let selectedId = null;
  let appliedSavedCamera = false;
  let frameId = 0;

  const labelPoint = new THREE.Vector3();
  function layoutSprites() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const items = [];
    scene.traverse((obj) => {
      if (!obj.isSprite || !obj.userData.screenLabel) return;
      let node = obj.parent;
      let shown = true;
      while (node) {
        if (!node.visible) shown = false;
        node = node.parent;
      }
      if (!shown || (state?.building && obj.userData.roofLabel)) {
        obj.visible = false;
        return;
      }
      obj.getWorldPosition(labelPoint);
      const dist = Math.max(6, camera.position.distanceTo(labelPoint));
      const worldPerPx = (2 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist) / height;
      const spec = obj.userData.screenLabel;
      const pxH = spec.px;
      const pxW = pxH * spec.aspect;
      obj.scale.set(pxW * worldPerPx, pxH * worldPerPx, 1);
      labelPoint.project(camera);
      const sx = (labelPoint.x * 0.5 + 0.5) * width;
      const sy = (-labelPoint.y * 0.5 + 0.5) * height;
      const onScreen = labelPoint.z < 1 && sx > -pxW && sx < width + pxW && sy > -pxH && sy < height + pxH;
      if (!onScreen) {
        obj.visible = false;
        return;
      }
      items.push({ obj, sx, sy, pxW, pxH, priority: spec.priority, dist });
    });
    items.sort((a, b) => b.priority - a.priority || a.dist - b.dist);
    const kept = [];
    for (const item of items) {
      const box = {
        x: item.sx - item.pxW / 2,
        y: item.sy - item.pxH / 2,
        w: item.pxW,
        h: item.pxH,
      };
      const hit = kept.some((other) => (
        box.x < other.x + other.w + 6
        && box.x + box.w + 6 > other.x
        && box.y < other.y + other.h + 6
        && box.y + box.h + 6 > other.y
      ));
      item.obj.visible = !hit;
      if (!hit) kept.push(box);
    }
  }

  function tick() {
    frameId = requestAnimationFrame(tick);
    controls.update();
    layoutSprites();
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
    buildHouse(house, buckets, futureBuckets, materials, wood, { cutaway });
    fitGround(house, ground, scene, camera, controls);
    if (state) applyVisibility(state);
    applyRoof();
    paintSelection();
  }

  function paintSelection() {
    scene.traverse((object) => {
      if (!object.material?.emissive) return;
      const wallOn = object.userData?.wallId && object.userData.wallId === selectedId;
      const pick = object.userData?.pick;
      const pickOn = pick && selection && pick.type === selection.type && pick.id === selection.id;
      if (!object.userData?.wallId && !pick) return;
      const on = !!(wallOn || pickOn);
      object.material.emissive.set(on ? 0x1f6b45 : 0x000000);
      object.material.emissiveIntensity = on ? 0.55 : 0;
    });
  }

  function applyRoof() {
    const show = state?.roof !== false && !cutaway;
    const ghost = show && !!state?.building;
    roofPivot.visible = show;
    roofPivot.traverse((obj) => {
      if (obj.isSprite) {
        obj.userData.roofLabel = true;
        obj.visible = !ghost;
        return;
      }
      if (!obj.isMesh || !obj.material) return;
      obj.material.transparent = ghost;
      obj.material.opacity = ghost ? 0.22 : 1;
      obj.material.depthWrite = !ghost;
      obj.material.needsUpdate = true;
    });
  }

  function planFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const groundHit = new THREE.Vector3();
    const hitGround = raycaster.ray.intersectPlane(groundPlane, groundHit);
    const ground = hitGround ? sceneToPlan(groundHit.x, groundHit.y, groundHit.z) : null;
    const hits = raycaster.intersectObjects(scene.children, true);
    const meshHit = hits.find((item) => item.object.userData?.pickSurface || item.object.userData?.wallId);
    const surface = meshHit ? sceneToPlan(meshHit.point.x, meshHit.point.y, meshHit.point.z) : null;
    return { ground, surface, pick: meshHit?.object.userData?.pick || null };
  }

  const raycaster = new THREE.Raycaster();
  const activePointers = new Map();
  let pointerDown = null;
  let editingGesture = false;
  let pinch = null;

  canvas.addEventListener("pointerdown", (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerDown = { x: event.clientX, y: event.clientY };
    if (!editing) return;
    if (activePointers.size > 1) {
      buildHooks?.cancel?.();
      editingGesture = false;
      pinch = null;
      return;
    }
    const hit = planFromEvent(event);
    if (!hit?.ground && !hit?.surface) return;
    editingGesture = !!buildHooks?.down?.(event, hit.ground, { surface: hit.surface, pick: hit.pick });
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId) && editing) {
      const hit = planFromEvent(event);
      if (hit) buildHooks?.hover?.(event, hit.ground, { surface: hit.surface, pick: hit.pick });
      return;
    }
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!editing) return;
    if (activePointers.size >= 2) {
      const pts = [...activePointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      camera.updateMatrixWorld();
      if (!pinch) {
        pinch = {
          dist,
          mid,
          offset: camera.position.clone().sub(controls.target),
          target: controls.target.clone(),
        };
      } else {
        const scale = THREE.MathUtils.clamp(pinch.dist / dist, 0.25, 4);
        const offset = pinch.offset.clone().multiplyScalar(scale);
        const panX = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-(mid.x - pinch.mid.x) * 0.05);
        const panY = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar((mid.y - pinch.mid.y) * 0.05);
        controls.target.copy(pinch.target).add(panX).add(panY);
        const length = THREE.MathUtils.clamp(offset.length(), controls.minDistance, controls.maxDistance);
        camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(length));
      }
      return;
    }
    if (!editingGesture) return;
    const hit = planFromEvent(event);
    if (hit) buildHooks?.move?.(event, hit.ground, { surface: hit.surface, pick: hit.pick });
  });
  function endEditPointer(event) {
    const start = pointerDown;
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinch = null;
    if (editing && editingGesture && activePointers.size === 0) {
      const hit = planFromEvent(event);
      buildHooks?.up?.(event, hit?.ground, { surface: hit?.surface, pick: hit?.pick });
      editingGesture = false;
      pointerDown = null;
      return;
    }
    if (editing || !start || activePointers.size) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    pointerDown = null;
    if (moved > 6 || !onPick) return;
    const hit = planFromEvent(event);
    const wallId = hit?.pick?.type === "wall" ? hit.pick.id : null;
    if (wallId) onPick(wallId);
    else if (hit?.surface) {
      const hits = raycaster.intersectObjects(scene.children, true);
      const wall = hits.find((item) => item.object.userData?.wallId);
      onPick(wall?.object.userData.wallId || null);
    }
  }
  canvas.addEventListener("pointerup", endEditPointer);
  canvas.addEventListener("pointercancel", endEditPointer);
  canvas.addEventListener("pointerleave", (event) => {
    if (editing) buildHooks?.hover?.(event, null);
  });
  canvas.addEventListener("wheel", (event) => {
    if (!editing) return;
    event.preventDefault();
    const offset = camera.position.clone().sub(controls.target);
    const next = THREE.MathUtils.clamp(offset.length() * Math.exp(event.deltaY * 0.0012), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(next));
  }, { passive: false });

  function resetCamera() {
    framePlan(true);
  }

  function planBox(includePad) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const add = (point) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    };
    for (const wall of house.walls || []) {
      add(wall.start);
      add(wall.end);
    }
    for (const room of house.rooms || []) {
      for (const point of room.polygon || []) add(point);
    }
    const drawn = Number.isFinite(minX);
    if (includePad || !drawn) {
      const pad = house.footprint || {};
      add({ x: 0, y: 0 });
      add({ x: Number(pad.width) || 36, y: Number(pad.depth) || 24 });
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY };
  }

  function framePlan(whole) {
    const box = planBox(whole);
    if (!box) return;
    const cx = (box.minX + box.maxX) / 2;
    const cz = -((box.minY + box.maxY) / 2);
    const span = Math.max(16, Math.hypot(box.maxX - box.minX, box.maxY - box.minY));
    const aspect = Math.max(0.4, camera.aspect || 1);
    const fit = Math.max(1, 0.9 / aspect);
    const lookDown = !!state?.building;
    controls.target.set(cx, lookDown ? 1.5 : 4, cz);
    if (lookDown) camera.position.set(cx + span * 0.05 * fit, span * 1.35 * fit, cz + span * 0.16 * fit);
    else camera.position.set(cx - span * 0.85 * fit, span * 0.72 * fit, cz + span * 0.95 * fit);
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
      applyRoof();
      applyVisibility(next);
    },
    setEditing(on) {
      editing = !!on;
      controls.enabled = !editing;
      canvas.style.cursor = editing ? "crosshair" : "grab";
      if (!editing) {
        editingGesture = false;
        buildHooks?.cancel?.();
      }
    },
    setCutaway(on) {
      const next = !!on;
      if (next === cutaway) return;
      cutaway = next;
      rebuild(house);
    },
    setBuildHooks(hooks) {
      buildHooks = hooks;
    },
    setOverlay(overlay) {
      syncGhost(ghostGroup, house, overlay);
    },
    setSelection(next) {
      selection = next;
      selectedId = next?.type === "wall" ? next.id : selectedId;
      paintSelection();
    },
    frameHouse() {
      framePlan(false);
    },
    focus(x, y) {
      const span = 22;
      controls.target.set(x, 4, -y);
      camera.position.set(x - span * 0.7, span * 0.55, -y + span * 0.85);
      controls.update();
      onChange(readCamera());
    },
    frameParcel() {
      const ring = house.site?.parcel?.ring;
      if (!ring?.length) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of ring) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      const cx = (minX + maxX) / 2;
      const cz = -((minY + maxY) / 2);
      const radius = Math.max(40, Math.hypot(maxX - minX, maxY - minY) / 2);
      controls.target.set(cx, 2, cz);
      camera.position.set(cx, radius * 0.85, cz + radius * 0.15);
      controls.update();
      onChange(readCamera());
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
    setOnPick() {},
    setHouse() {},
    setSelected() {},
    setEditing() {},
    setCutaway() {},
    setBuildHooks() {},
    setOverlay() {},
    setSelection() {},
    frameHouse() {},
    focus() {},
    frameParcel() {},
    dispose() {},
  };
}

function fitGround(nextHouse, ground, scene, camera, controls) {
  const ring = nextHouse.site?.parcel?.ring;
  if (!ring?.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const radius = Math.hypot(maxX - minX, maxY - minY) / 2 + 30;
  ground.geometry.dispose();
  ground.geometry = new THREE.CircleGeometry(Math.max(180, radius), 64);
  ground.position.set((minX + maxX) / 2, -0.04, -((minY + maxY) / 2));
  const far = Math.max(900, radius * 2.4);
  scene.fog.near = far * 0.28;
  scene.fog.far = far;
  camera.far = far * 2;
  camera.updateProjectionMatrix();
  controls.maxDistance = Math.max(170, radius * 1.6);
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

function marker(x, y, z, geometry, color, opacity = 1) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      transparent: opacity < 1,
      opacity,
    }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = opacity === 1;
  return mesh;
}

function tag(mesh, type, id, x, y) {
  mesh.userData.pick = { type, id };
  mesh.userData.plan = { x, y };
  return mesh;
}

function addPlacedItems(house, buckets) {
  for (const device of house.electrical?.devices || []) {
    const at = planToScene(device, device.mount === "ceiling" ? 9.2 : (device.height || 1.5));
    const mesh = marker(
      at.x,
      at.y,
      at.z,
      new THREE.SphereGeometry(device.ghost ? 0.7 : 0.45, 16, 12),
      device.volts === 240 ? 0xc4654a : 0x2f5d45,
      device.ghost ? 0.55 : 1,
    );
    buckets.electrical.add(tag(mesh, "device", device.id, device.x, device.y));
    if (device.ghost) {
      const label = makeSprite(plainPlaceLabel(device.kind) || device.name || "Outlet", false, { priority: 4, px: 28 });
      const labelAt = planToScene(device, 3.2);
      label.position.set(labelAt.x, labelAt.y, labelAt.z);
      buckets.electrical.add(label);
    }
  }
  if (house.electrical?.panel) {
    const panel = house.electrical.panel;
    const at = planToScene(panel, panel.height || 5);
    const mesh = marker(at.x, at.y, at.z, new THREE.BoxGeometry(0.7, 1.4, 0.25), 0x243024);
    buckets.electrical.add(tag(mesh, "panel", "panel", panel.x, panel.y));
  }
  for (const fixture of house.plumbing?.fixtures || []) {
    const at = planToScene(fixture, 0.7);
    const mesh = marker(
      at.x,
      at.y,
      at.z,
      new THREE.BoxGeometry(1.5, 1.2, 1.3),
      0x1f6f8b,
      fixture.ghost ? 0.55 : 1,
    );
    buckets.plumbing.add(tag(mesh, "fixture", fixture.id, fixture.x, fixture.y));
    if (fixture.ghost) {
      const label = makeSprite(fixture.name || "Fixture", false, { priority: 4, px: 28 });
      const labelAt = planToScene(fixture, 2.6);
      label.position.set(labelAt.x, labelAt.y, labelAt.z);
      buckets.plumbing.add(label);
    }
  }
  if (house.plumbing?.entry) {
    const entry = house.plumbing.entry;
    const at = planToScene(entry, 0.4);
    const mesh = marker(at.x, at.y, at.z, new THREE.CylinderGeometry(0.28, 0.28, 0.8, 12), 0x1f6f8b);
    buckets.plumbing.add(tag(mesh, "entry", "entry", entry.x, entry.y));
  }
  const well = house.site?.well;
  if (well) {
    const wellAt = planToScene(well, 0.8);
    const mesh = marker(wellAt.x, wellAt.y, wellAt.z, new THREE.CylinderGeometry(0.7, 0.7, 1.6, 16), 0x1f6f8b);
    const label = makeSprite("Well", false, { priority: 3, px: 32 });
    label.position.set(well.x, 3.2, -well.y);
    buckets.site.add(label);
    buckets.site.add(tag(mesh, "well", well.id || "well", well.x, well.y));
    buckets.site.add(setbackLoop(well.x, -well.y, SETBACKS.well.drainfieldFt));
  }
  const tank = house.site?.septic?.tank;
  if (tank) {
    const tankAt = planToScene(tank, 1.1);
    const mesh = marker(tankAt.x, tankAt.y, tankAt.z, new THREE.BoxGeometry(5, 2.2, 8), 0x2f5d45);
    const label = makeSprite("Tank", false, { priority: 3, px: 32 });
    label.position.set(tank.x, 3.4, -tank.y);
    buckets.site.add(label);
    buckets.site.add(tag(mesh, "septic", "tank", tank.x, tank.y));
  }
  for (const [type, rect] of [["drainfield", house.site?.septic?.drainfield], ["reserve", house.site?.septic?.reserve]]) {
    if (!rect) continue;
    const mesh = marker(
      rect.x + rect.width / 2,
      0.08,
      -(rect.y + rect.depth / 2),
      new THREE.BoxGeometry(rect.width, 0.16, rect.depth),
      type === "reserve" ? 0x8a9a72 : 0x5a7a46,
      0.8,
    );
    buckets.site.add(tag(mesh, type, type, rect.x + rect.width / 2, rect.y + rect.depth / 2));
  }
}

function clearGroup(group) {
  for (const child of [...group.children]) {
    child.geometry?.dispose();
    if (child.material?.map) child.material.map.dispose();
    child.material?.dispose?.();
    group.remove(child);
  }
}

function syncGhost(group, house, overlay) {
  clearGroup(group);
  if (!overlay) return;
  if (overlay.draft?.start && overlay.draft?.end) {
    const a = overlay.draft.start;
    const b = overlay.draft.end;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0.2) {
      const mesh = marker((a.x + b.x) / 2, 5, -((a.y + b.y) / 2), new THREE.BoxGeometry(length, 10, 0.4), 0x2f5d45, 0.45);
      mesh.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
      group.add(mesh);
    }
  }
  if (overlay.rect) {
    const { x0, y0, x1, y1 } = overlay.rect;
    const mesh = marker((x0 + x1) / 2, 0.1, -((y0 + y1) / 2), new THREE.BoxGeometry(Math.abs(x1 - x0), 0.12, Math.abs(y1 - y0)), 0x2f5d45, 0.28);
    group.add(mesh);
  }
  if (overlay.ghostOpening) {
    const wall = house.walls.find((item) => item.id === overlay.ghostOpening.wallId);
    if (wall) {
      const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
      const ux = (wall.end.x - wall.start.x) / len;
      const uy = (wall.end.y - wall.start.y) / len;
      const mid = overlay.ghostOpening.offset + overlay.ghostOpening.width / 2;
      const mesh = marker(
        wall.start.x + ux * mid,
        4,
        -(wall.start.y + uy * mid),
        new THREE.BoxGeometry(overlay.ghostOpening.width, 6.5, wall.thickness + 0.2),
        overlay.ghostOpening.ok ? 0x2f5d45 : 0xc44536,
        0.45,
      );
      mesh.rotation.y = Math.atan2(uy, ux);
      group.add(mesh);
    }
  }
  const ghosts = [overlay.placeGhost, ...(overlay.siteGhosts || []), ...(overlay.suggestMarks || [])].filter(Boolean);
  for (const ghost of ghosts) {
    const mesh = itemGhost(house, ghost);
    group.add(mesh);
    if (ghost.kind === "well") group.add(setbackLoop(mesh.position.x, mesh.position.z, SETBACKS.well.drainfieldFt));
    const label = makeSprite(ghost.reason || ghost.label || "Place", ghost.ok === false, { priority: 4, px: 32 });
    label.position.set(mesh.position.x, mesh.position.y + 2.2, mesh.position.z);
    group.add(label);
  }
}

function wallFrame(house, ghost) {
  const wall = ghost.wallId ? (house.walls || []).find((item) => item.id === ghost.wallId) : null;
  if (!wall) return null;
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
  const ux = (wall.end.x - wall.start.x) / len;
  const uy = (wall.end.y - wall.start.y) / len;
  const off = ghost.offset || 0;
  const nx = -uy;
  const ny = ux;
  return {
    x: wall.start.x + ux * off,
    z: -(wall.start.y + uy * off),
    rot: Math.atan2(uy, ux),
    nx,
    nz: -ny,
  };
}

function itemGhost(house, ghost) {
  const bad = ghost.ok === false;
  const color = bad ? 0xc44536 : 0x1f6f8b;
  const kind = ghost.kind || "";
  const frame = wallFrame(house, ghost);
  const x = ghost.x;
  const z = -ghost.y;
  let geometry;
  let y = 1.2;
  if (kind === "panel") {
    geometry = new THREE.BoxGeometry(1.5, 3.2, 0.35);
    y = 4.2;
  } else if (kind === "receptacle" || kind === "gfci" || kind === "wr-receptacle") {
    geometry = new THREE.BoxGeometry(1.15, 1.7, 0.28);
    y = ghost.height || 1.6;
  } else if (kind === "switch" || kind === "switch-3way") {
    geometry = new THREE.BoxGeometry(0.9, 1.7, 0.28);
    y = 4;
  } else if (kind === "light" || kind === "fan" || kind === "smoke") {
    geometry = new THREE.CylinderGeometry(0.7, 0.7, 0.15, 16);
    y = 9.2;
  } else if (kind === "wall-light") {
    geometry = new THREE.BoxGeometry(0.4, 0.7, 0.2);
    y = 5;
  } else if (/sink|lavatory/.test(kind)) {
    geometry = new THREE.BoxGeometry(2, 0.7, 1.5);
    y = 3;
  } else if (kind === "toilet") {
    geometry = new THREE.BoxGeometry(1.3, 1.6, 2);
    y = 0.9;
  } else if (kind === "shower") {
    geometry = new THREE.BoxGeometry(3, 7, 3);
    y = 3.5;
  } else if (kind === "washer" || kind === "dishwasher") {
    geometry = new THREE.BoxGeometry(2, 3, 2);
    y = 1.5;
  } else if (kind === "well") {
    geometry = new THREE.CylinderGeometry(1.1, 1.3, 2.4, 18);
    y = 1.2;
  } else if (kind === "tank") {
    geometry = new THREE.BoxGeometry(4, 2.2, 7);
    y = 1.1;
  } else if (kind === "drainfield" || kind === "reserve" || (ghost.width && ghost.depth)) {
    geometry = new THREE.BoxGeometry(ghost.width || 12, 0.18, ghost.depth || 8);
    y = 0.12;
  } else {
    geometry = new THREE.BoxGeometry(1.1, 1.4, 0.8);
  }
  const mesh = marker(x, y, z, geometry, color, bad ? 0.72 : 0.48);
  if (frame && kind !== "drainfield" && kind !== "reserve" && kind !== "well") {
    mesh.rotation.y = frame.rot;
    mesh.position.x += frame.nx * 0.9;
    mesh.position.z += frame.nz * 0.9;
  }
  mesh.material.depthWrite = false;
  mesh.material.emissive = new THREE.Color(color);
  mesh.material.emissiveIntensity = bad ? 0.45 : 0.28;
  return mesh;
}

function setbackLoop(x, z, radius) {
  const points = [];
  for (let i = 0; i <= 72; i += 1) {
    const angle = (i / 72) * Math.PI * 2;
    points.push(new THREE.Vector3(x + Math.cos(angle) * radius, 0.25, z + Math.sin(angle) * radius));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x1f6f8b }));
}

function buildHouse(house, buckets, futureBuckets, materials, wood, options = {}) {
  const cap = options.cutaway ? 4 : Infinity;
  for (const room of house.rooms) {
    const parent = room.phase === "future" ? futureBuckets.finishes : buckets.finishes;
    parent.add(roomFloor(room, materials));
    const labels = room.phase === "future" ? futureBuckets.labels : buckets.labels;
    const label = roomLabel(room);
    if (label) labels.add(label);
  }
  for (const wall of house.walls) {
    const layer = wallLayerId(wall);
    const parent = wall.phase === "future" ? futureBuckets[layer] : buckets[layer];
    const mats = wall.phase === "future" ? materials.ghost : materials.solid;
    addWallMeshes(wall, openingsFor(house, wall), parent, mats, cap);
    const frameParent = wall.phase === "future" ? futureBuckets.framing : buckets.framing;
    addOpeningFrames(wall, openingsFor(house, wall), frameParent, wood, wall.phase === "future", cap);
  }
  addDimensions(house, false, buckets.dimensions);
  addDimensions(house, true, futureBuckets.dimensions);
  addPlacedItems(house, buckets);
  addAnnotations(house, buckets.labels);
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
  mesh.userData.pickSurface = true;
  return mesh;
}

function roomLabel(room) {
  if (areaKind(room) !== "heated") return null;
  const at = room.labelAt || centroid(room.polygon);
  const ground = roomGroundLine(room);
  const sprite = makeSprite(ground ? `${room.name}\n${ground}` : room.name, room.phase === "future", {
    priority: room.phase === "future" ? 2 : 4,
    px: ground ? 48 : 34,
  });
  sprite.position.set(at.x, 8.4, -at.y);
  return sprite;
}

function addAnnotations(house, parent) {
  const furnMaterial = new THREE.MeshStandardMaterial({ color: 0xd9cfc2, roughness: 0.8, transparent: true, opacity: 0.85 });
  for (const item of house.furniture || []) {
    const width = item.width || 2;
    const depth = item.depth || 2;
    const height = item.kind === "car" ? 4.5 : item.kind === "counter" ? 3 : 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), furnMaterial.clone());
    const color = item.kind === "bed" ? 0xb7d4ea : item.kind === "appliance" ? 0xf0b7c4 : item.kind === "counter" ? 0xf3e2b8 : 0xd9cfc2;
    mesh.material.color.setHex(color);
    mesh.position.set(item.x, height / 2, -item.y);
    mesh.rotation.y = ((item.rotation || 0) * Math.PI) / 180;
    mesh.castShadow = true;
    parent.add(mesh);
  }
  for (const feature of house.siteFeatures || []) {
    let mesh;
    if (feature.kind === "tree") {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry((feature.size || 6) * 0.25, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x2f5d45, roughness: 0.9 }),
      );
      mesh.position.set(feature.x, 4, -feature.y);
    } else if (feature.kind === "pond") {
      mesh = new THREE.Mesh(
        new THREE.CircleGeometry((feature.size || 8) * 0.45, 20),
        new THREE.MeshStandardMaterial({ color: 0x2f6f8b, roughness: 0.4, transparent: true, opacity: 0.7 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(feature.x, 0.08, -feature.y);
    } else if (feature.kind === "pavilion") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(8, 7, 8),
        new THREE.MeshStandardMaterial({ color: 0xa85b3c, roughness: 0.85, transparent: true, opacity: 0.45 }),
      );
      mesh.position.set(feature.x, 3.5, -feature.y);
    } else {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 12, 8),
        new THREE.MeshStandardMaterial({ color: feature.kind === "wind" ? 0x1f6f8b : 0x6e5c48 }),
      );
      mesh.position.set(feature.x, 1.2, -feature.y);
    }
    parent.add(mesh);
    if (feature.kind === "tree" || feature.kind === "garden" || feature.kind === "other") continue;
    const label = makeSprite(feature.name, false, { priority: 1, px: 30 });
    label.position.set(feature.x, feature.kind === "pavilion" ? 8 : 4, -feature.y);
    parent.add(label);
  }
  for (const label of house.planLabels || []) {
    if (!keptPlanLabel(label.text)) continue;
    const sprite = makeSprite(label.text, false, { priority: 2, px: 32 });
    sprite.position.set(label.x, 5.2, -label.y);
    parent.add(sprite);
  }
}

function keptPlanLabel(text) {
  const line = String(text || "");
  return line === "ERV" || line.includes("天井") || /north facing/i.test(line);
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

function addWallMeshes(wall, openings, parent, mats, cap = Infinity) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = wallLength(wall) || 1;
  const angle = Math.atan2(dy, dx);
  const ux = dx / len;
  const uy = dy / len;

  function place(s0, s1, z0, z1, thickness, material) {
    const top = Math.min(z1, cap);
    if (top - z0 < 0.05) return;
    const length = Math.max(0.02, s1 - s0);
    const height = Math.max(0.02, top - z0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), material.clone());
    const s = (s0 + s1) / 2;
    mesh.position.set(wall.start.x + ux * s, (z0 + top) / 2, -(wall.start.y + uy * s));
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

function addOpeningFrames(wall, openings, parent, wood, future, cap = Infinity) {
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
    const top = Math.min(z1, cap);
    if (top - z0 < 0.04) return;
    const span = Math.max(0.04, s1 - s0);
    const height = Math.max(0.04, top - z0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(span, height, thickness), material);
    const s = (s0 + s1) / 2;
    mesh.position.set(wall.start.x + ux * s, (z0 + top) / 2, -(wall.start.y + uy * s));
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
  const dims = planDimensions(house, futureShown);
  for (const dim of dims) {
    const seg = offsetSegment(dim);
    const y = 0.25;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(seg.x0, y, -seg.y0),
      new THREE.Vector3(seg.x1, y, -seg.y1),
    ]);
    parent.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x2a241b })));
    const estimated = String(house.disclaimer || "").toLowerCase().includes("scale estimated");
    const feet = `${estimated ? "est. " : ""}${formatFeet(seg.len)}`;
    const text = dim.face ? `${feet} ${dim.face}` : feet;
    const label = makeSprite(text, false, { priority: 0, px: 26 });
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
  const group = new THREE.Group();
  const footprints = roofFootprints(house, futureShown);
  let largest = null;
  for (const footprint of footprints) {
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
    group.add(mesh);
    const span = (footprint.x1 - footprint.x0) * (footprint.y1 - footprint.y0);
    if (!largest || span > largest.span) largest = { footprint, span };
  }
  if (largest) {
    const footprint = largest.footprint;
    const label = makeSprite("Placeholder roof", false, { priority: 1, px: 30 });
    const midX = (footprint.x0 + footprint.x1) / 2;
    const midY = (footprint.y0 + footprint.y1) / 2;
    const rise = ((footprint.y1 - footprint.y0) / 2) * house.roof.pitchRiseOverRun;
    label.position.set(midX, house.roof.plateHeight + rise + 3.2, -midY);
    group.add(label);
  }
  return group;
}

function makeSprite(text, muted = false, options = {}) {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  const fontPx = 64;
  const lines = String(text || "").split("\n").filter((line) => line.length).slice(0, 3);
  const shown = lines.length ? lines : [""];
  g.font = `600 ${fontPx}px Georgia, serif`;
  const textW = Math.max(...shown.map((line) => Math.ceil(g.measureText(line).width)), 40);
  canvas.width = Math.max(160, textW + 72);
  canvas.height = fontPx * shown.length + 48;
  g.font = `600 ${fontPx}px Georgia, serif`;
  g.clearRect(0, 0, canvas.width, canvas.height);
  roundRect(g, 4, 4, canvas.width - 8, canvas.height - 8, 28);
  g.fillStyle = muted ? "rgba(247, 243, 235, 0.78)" : "rgba(247, 243, 235, 0.94)";
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = muted ? "#6F6458" : "#2A241B";
  g.stroke();
  g.fillStyle = muted ? "#6F6458" : "#2A241B";
  g.textAlign = "center";
  g.textBaseline = "middle";
  shown.forEach((line, index) => {
    g.fillText(line, canvas.width / 2, 24 + fontPx * (index + 0.5));
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  const spec = typeof options === "number"
    ? { priority: options >= 10 ? 1 : 0, px: 28 }
    : { priority: options.priority ?? 2, px: options.px ?? 32 };
  sprite.userData.screenLabel = { ...spec, aspect: canvas.width / canvas.height };
  sprite.scale.set(6, 1.5, 1);
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
