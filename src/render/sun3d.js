/**
 * Sun lighting for the 3D view. When the Sun and shade layer is on, the main
 * light moves to the real (or hand-set) sun, gets warmer and dimmer when it is
 * low, and the sky fill drops so rooms read darker where no sun reaches.
 *
 * Shadow-only stand-ins (full-height walls with their glass left open, a
 * ceiling over every roofed room, and a copy of the real roof) keep the light
 * honest when the roof is off or the view is cut away. The roof copy is the
 * same shape the view draws (eaves, gable rakes, hips, ridge, curves), with
 * the skylights cut out of its shadow, so shadows on the ground and the sun
 * through windows match the roof you see. They draw nothing on screen and can't be clicked.
 * Each room that gets sun on its floor also gets a soft warm bounce light,
 * stronger the more of the room is sunlit.
 */
import * as THREE from "three";
import { isFutureShown, isPhaseVisible } from "./visibility.js";
import { glazing, roofed, roomSun, sunPatches } from "../sun/light.js";
import { boundsOf } from "../build/areas.js";
import { ceilingHeight, skylightBuild, skylightFootprint } from "../build/skylights.js";
import { roofFootprints } from "../build/roofShape.js";
import { clerestoryBox, clerestoryGeometry, upperHeight } from "../build/clerestory.js";
import { awningPieces } from "../build/awnings.js";
import { pointInPolygon } from "../lib/geom.js";

const BOUNCE_LIGHTS = 6;

const MAX_SKYLIGHTS = 24;

/**
 * Depth material for the roof copy: the same as three's shadow depth, but
 * skylight openings (plan quads) are left out, so the sun comes through them.
 */
function skylightDepthMaterial() {
  const quads = Array.from({ length: MAX_SKYLIGHTS * 4 }, () => new THREE.Vector2());
  const uniforms = { skyCount: { value: 0 }, skyQuads: { value: quads } };
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.skyCount = uniforms.skyCount;
    shader.uniforms.skyQuads = uniforms.skyQuads;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSkyWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvSkyWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vSkyWorld;
uniform int skyCount;
uniform vec2 skyQuads[${MAX_SKYLIGHTS * 4}];
float skyEdge(vec2 a, vec2 b, vec2 p) { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }`)
      .replace("void main() {", `void main() {
  vec2 plan = vec2(vSkyWorld.x, -vSkyWorld.z);
  for (int i = 0; i < ${MAX_SKYLIGHTS}; i++) {
    if (i >= skyCount) break;
    vec2 a = skyQuads[i * 4]; vec2 b = skyQuads[i * 4 + 1]; vec2 c = skyQuads[i * 4 + 2]; vec2 d = skyQuads[i * 4 + 3];
    float e0 = skyEdge(a, b, plan); float e1 = skyEdge(b, c, plan); float e2 = skyEdge(c, d, plan); float e3 = skyEdge(d, a, plan);
    if ((e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0 && e3 >= 0.0) || (e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0 && e3 <= 0.0)) discard;
  }`);
  };
  material.customProgramCacheKey = () => `skylight-depth-${MAX_SKYLIGHTS}`;
  return { material, uniforms };
}

export function createSunRig({ scene, ambient, hemisphere, light, renderer = null }) {
  const defaults = {
    ambient: ambient.intensity,
    hemisphere: hemisphere.intensity,
    hemiSky: hemisphere.color.clone(),
    light: light.intensity,
    color: light.color.clone(),
    position: light.position.clone(),
    target: light.target.position.clone(),
    shadow: { ...pick(light.shadow.camera) },
  };
  const casters = new THREE.Group();
  casters.name = "sun-casters";
  casters.visible = false;
  scene.add(casters);
  const casterMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  // The roof copy lives in its own group, rebuilt when the roof is rebuilt.
  const roofCasters = new THREE.Group();
  roofCasters.name = "sun-roof-casters";
  roofCasters.visible = false;
  scene.add(roofCasters);
  const roofDepth = skylightDepthMaterial();
  // The roof is a single sheet, so its copy casts from both sides.
  const roofCopyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  let roofSource = null;
  // Sharper shadows while the sun layer is on, as far as the graphics card allows.
  const maxTexture = renderer?.capabilities?.maxTextureSize || 2048;
  const sunMapSize = Math.min(4096, maxTexture);
  const defaultMapSize = light.shadow.mapSize.x;
  const defaultBias = { bias: light.shadow.bias, normalBias: light.shadow.normalBias };
  const bounces = Array.from({ length: BOUNCE_LIGHTS }, () => {
    const point = new THREE.PointLight(0xffd9a8, 0, 20, 1.2);
    point.castShadow = false;
    scene.add(point);
    return point;
  });
  let casterKey = "";
  let casterHouse = null;
  let lids = [];

  function pick(cam) {
    return { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far };
  }

  function rebuildCasters(house, state) {
    const key = `${state?.phase}|${state?.layers?.future}`;
    if (house === casterHouse && key === casterKey) return;
    casterHouse = house;
    casterKey = key;
    for (const child of [...casters.children]) {
      child.geometry?.dispose();
      casters.remove(child);
    }
    const walls = (house?.walls || []).filter((wall) => isPhaseVisible(wall.phase, state || {}));
    const top = Math.max(ceilingHeight(house), ...walls.map((wall) => Number(wall.height) || 0));
    const add = (geometry, at, rotationY = 0) => {
      const mesh = new THREE.Mesh(geometry, casterMaterial);
      mesh.position.copy(at);
      mesh.rotation.y = rotationY;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.raycast = () => {};
      mesh.userData.sunCaster = true;
      casters.add(mesh);
    };
    for (const wall of walls) {
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const ux = dx / len;
      const uy = dy / len;
      const angle = Math.atan2(uy, ux);
      const thick = Math.max(0.3, Number(wall.thickness) || 0.5);
      const holes = (house.openings || [])
        .filter((opening) => opening.wallId === wall.id)
        .map((opening) => ({ a: Math.max(0, opening.offset), b: Math.min(len, opening.offset + opening.width), glass: glazing(opening) }))
        .filter((hole) => hole.glass && hole.b > hole.a)
        .sort((p, q) => p.a - q.a);
      const box = (s0, s1, z0, z1) => {
        if (s1 - s0 < 0.02 || z1 - z0 < 0.02) return;
        const mid = (s0 + s1) / 2;
        const px = wall.start.x + ux * mid;
        const py = wall.start.y + uy * mid;
        add(new THREE.BoxGeometry(s1 - s0, z1 - z0, thick), new THREE.Vector3(px, (z0 + z1) / 2, -py), angle);
      };
      let cursor = 0;
      for (const hole of holes) {
        box(cursor, hole.a, 0, top);
        box(hole.a, hole.b, 0, Math.max(0, hole.glass.z0));
        box(hole.a, hole.b, Math.min(top, hole.glass.z1), top);
        cursor = Math.max(cursor, hole.b);
      }
      box(cursor, len, 0, top);
    }
    const full = !!state?.layers && isFutureShown(state);
    const stepBox = house?.roof?.clerestory ? clerestoryBox(roofFootprints(house, full)) : null;
    const step = stepBox ? clerestoryGeometry(house, stepBox, full) : null;
    for (const room of house?.rooms || []) {
      if (!roofed(room) || !(room.polygon?.length >= 3) || !isPhaseVisible(room.phase, state || {})) continue;
      // Under a clerestory's high roof the ceiling is open to the roof: keep only the low side's ceiling.
      const polygon = step ? clipToFront(room.polygon, step) : room.polygon;
      if (polygon.length < 3) continue;
      const shape = new THREE.Shape(polygon.map((point) => new THREE.Vector2(point.x, point.y)));
      // Skylights over this room are holes in its ceiling, so the sun comes through.
      for (const skylight of house.skylights || []) {
        if (!isPhaseVisible(skylight.phase, state || {})) continue;
        if (!pointInPolygon(skylight, room.polygon)) continue;
        shape.holes.push(new THREE.Path(skylightFootprint(skylight, house, (!!state?.layers && isFutureShown(state))).map((point) => new THREE.Vector2(point.x, point.y))));
      }
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      add(geometry, new THREE.Vector3(0, top, 0));
    }
    if (step) addClerestoryCasters(step);
    // Skylight openings for the roof copy's shadow.
    const quads = roofDepth.uniforms.skyQuads.value;
    let count = 0;
    for (const skylight of house?.skylights || []) {
      if (count >= MAX_SKYLIGHTS || !isPhaseVisible(skylight.phase, state || {})) continue;
      const corners = skylightFootprint(skylight, house, full);
      if (corners.length !== 4) continue;
      corners.forEach((point, i) => quads[count * 4 + i].set(point.x, point.y));
      count += 1;
    }
    roofDepth.uniforms.skyCount.value = count;
    // Each window's awning. (The roof itself is copied from the drawn roof: see syncRoof.)
    for (const piece of awningPieces(house)) {
      if (!isPhaseVisible(piece.wall.phase, state || {})) continue;
      add(new THREE.BoxGeometry(piece.length, 0.15, piece.depth), new THREE.Vector3(piece.center.x, piece.height + 0.075, -piece.center.y), piece.angle);
    }
    // Each skylight's shaft through the attic: four walls from the ceiling up to
    // the roof, and a lid that closes the shaft when the sun is behind its roof face.
    lids = [];
    for (const skylight of house?.skylights || []) {
      if (!isPhaseVisible(skylight.phase, state || {})) continue;
      const build = skylightBuild(house, skylight, full);
      if (!build.roof) continue;
      const corners = build.footprint;
      const cx = corners.reduce((sum, p) => sum + p.x, 0) / 4;
      const cy = corners.reduce((sum, p) => sum + p.y, 0) / 4;
      for (const side of build.shaft.sides) {
        const height = (side.heightA + side.heightB) / 2;
        if (side.length < 0.05 || height < 0.05) continue;
        const mx = (side.a.x + side.b.x) / 2;
        const my = (side.a.y + side.b.y) / 2;
        // Push the wall out by half its thickness so the opening stays the full size.
        const out = Math.hypot(mx - cx, my - cy) || 1;
        const px = mx + ((mx - cx) / out) * 0.15;
        const py = my + ((my - cy) / out) * 0.15;
        const angle = Math.atan2(side.b.y - side.a.y, side.b.x - side.a.x);
        add(new THREE.BoxGeometry(side.length + 0.3, height, 0.3), new THREE.Vector3(px, top + height / 2, -py), angle);
      }
      const lidShape = new THREE.Shape(corners.map((point) => new THREE.Vector2(point.x, point.y)));
      const lidGeometry = new THREE.ExtrudeGeometry(lidShape, { depth: 0.2, bevelEnabled: false });
      lidGeometry.rotateX(-Math.PI / 2);
      add(lidGeometry, new THREE.Vector3(0, top + build.shaft.tallest + 0.05, 0));
      const lid = casters.children[casters.children.length - 1];
      lid.userData.roof = build.roof;
      lids.push(lid);
    }
  }

  /** The clerestory's solid parts and its high roof, for the sun only. */
  function addClerestoryCasters(g) {
    const solid = (geometry, position) => {
      const mesh = new THREE.Mesh(geometry, casterMaterial);
      if (position) mesh.position.copy(position);
      mesh.castShadow = true;
      mesh.raycast = () => {};
      casters.add(mesh);
    };
    const width = g.glassX1 - g.glassX0;
    const mid = (g.glassX0 + g.glassX1) / 2;
    // Wall from the ceiling up to the glass, and the header above it.
    solid(new THREE.BoxGeometry(width, g.sill - g.plate, 0.3), new THREE.Vector3(mid, (g.plate + g.sill) / 2, -g.stepY));
    solid(new THREE.BoxGeometry(width, g.top - g.glassTop, 0.3), new THREE.Vector3(mid, (g.glassTop + g.top) / 2, -g.stepY));
    // The high roof, with holes for skylights in it.
    const shape = new THREE.Shape([
      new THREE.Vector2(g.box.x0, g.upperEdgeY), new THREE.Vector2(g.box.x1, g.upperEdgeY),
      new THREE.Vector2(g.box.x1, g.backY), new THREE.Vector2(g.box.x0, g.backY),
    ]);
    for (const skylight of casterHouse?.skylights || []) {
      const inside = g.sign > 0 ? skylight.y > g.stepY : skylight.y < g.stepY;
      if (!inside) continue;
      shape.holes.push(new THREE.Path(skylightFootprint(skylight, casterHouse).map((p) => new THREE.Vector2(p.x, p.y))));
    }
    const roofGeometry = new THREE.ShapeGeometry(shape);
    const position = roofGeometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const planY = position.getY(i);
      position.setXYZ(i, position.getX(i), upperHeight(g, planY) + 0.05, -planY);
    }
    roofGeometry.computeVertexNormals();
    solid(roofGeometry);
    // Gable ends.
    for (const x of [g.faces.x0, g.faces.x1]) {
      const profile = [
        [g.frontFace, g.plate], [g.stepY, g.plate], [g.stepY, g.top],
        [g.backFace, upperHeight(g, g.backFace)], [g.backFace, g.plate],
      ];
      const end = new THREE.ShapeGeometry(new THREE.Shape(profile.map(([py, h]) => new THREE.Vector2(-py, h))));
      end.rotateY(-Math.PI / 2);
      const mesh = new THREE.Mesh(end, casterMaterial);
      mesh.position.x = x;
      mesh.castShadow = true;
      mesh.raycast = () => {};
      casters.add(mesh);
    }
  }

  /**
   * Copy the roof that is drawn (phase 1 or full house) into shadow-only meshes.
   * They share its geometry, so this is cheap, and they cast whether or not the
   * roof itself is shown.
   */
  function syncRoof(roofGroup) {
    if (roofGroup === roofSource && roofCasters.children.length) return;
    roofSource = roofGroup;
    for (const child of [...roofCasters.children]) roofCasters.remove(child);
    if (!roofGroup) return;
    roofGroup.updateMatrixWorld(true);
    roofGroup.traverse((obj) => {
      if (!obj.isMesh || obj.isSprite || !obj.geometry) return;
      // Glass (clerestory band, skylight panes) lets the sun through.
      if (obj.userData?.castsSun === false) return;
      const copy = new THREE.Mesh(obj.geometry, roofCopyMaterial);
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(obj.matrixWorld);
      copy.matrixWorld.copy(obj.matrixWorld);
      copy.castShadow = true;
      copy.receiveShadow = false;
      copy.customDepthMaterial = roofDepth.material;
      copy.raycast = () => {};
      copy.userData.sunCaster = true;
      roofCasters.add(copy);
    });
  }

  function restore() {
    ambient.intensity = defaults.ambient;
    hemisphere.intensity = defaults.hemisphere;
    hemisphere.color.copy(defaults.hemiSky);
    light.visible = true;
    light.intensity = defaults.light;
    light.color.copy(defaults.color);
    light.position.copy(defaults.position);
    light.target.position.copy(defaults.target);
    Object.assign(light.shadow.camera, defaults.shadow);
    light.shadow.camera.updateProjectionMatrix();
    casters.visible = false;
    roofCasters.visible = false;
    setMapSize(defaultMapSize);
    light.shadow.bias = defaultBias.bias;
    light.shadow.normalBias = defaultBias.normalBias;
    for (const bounce of bounces) bounce.intensity = 0;
  }

  function setMapSize(size) {
    if (light.shadow.mapSize.x === size) return;
    light.shadow.mapSize.set(size, size);
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }

  return {
    syncRoof,
    /** sun: from currentSun, or null to go back to the everyday light. */
    apply(sun, house, state, roofGroup = null) {
      if (!sun) {
        restore();
        return;
      }
      rebuildCasters(house, state);
      if (roofGroup) syncRoof(roofGroup);
      casters.visible = true;
      roofCasters.visible = true;
      const rooms = (house?.rooms || []).filter((room) => room.polygon?.length >= 3);
      const box = boundsOf(rooms);
      const cx = Number.isFinite(box?.x0) ? (box.x0 + box.x1) / 2 : 38;
      const cy = Number.isFinite(box?.y0) ? (box.y0 + box.y1) / 2 : 23.5;
      const radius = Number.isFinite(box?.x0) ? Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 : 40;
      if (!sun.up) {
        light.visible = false;
        ambient.intensity = 0.1;
        hemisphere.intensity = 0.28;
        hemisphere.color.set(0x9fb2cc);
        for (const bounce of bounces) bounce.intensity = 0;
        return;
      }
      const v = sun.vector;
      for (const lid of lids) {
        const roof = lid.userData.roof;
        lid.visible = v.x * roof.downhill.x * roof.slope + v.y * roof.downhill.y * roof.slope + v.z <= 0.001;
      }
      // Fit the shadow camera to everything that casts. Seen from the sun, a
      // shadow on flat ground is never farther from the house than the house
      // is tall, so a box just round the casters covers every shadow, and the
      // whole shadow map goes to them (about a third of an inch per pixel on a
      // 100 ft site with a 4096 map).
      const bounds = new THREE.Box3();
      for (const group of [casters, roofCasters]) {
        for (const child of group.children) {
          if (!child.geometry) continue;
          if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
          child.updateMatrixWorld();
          bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
        }
      }
      const sphere = bounds.isEmpty() ? new THREE.Sphere(new THREE.Vector3(cx, 0, -cy), radius + 10) : bounds.getBoundingSphere(new THREE.Sphere());
      const extent = sphere.radius + 2;
      const reach = sphere.radius + 20;
      light.visible = true;
      light.target.position.copy(sphere.center);
      light.position.set(sphere.center.x + v.x * reach, sphere.center.y + v.z * reach, sphere.center.z - v.y * reach);
      setMapSize(sunMapSize);
      // Small offsets so surfaces don't shade themselves, without lifting shadows off thin eaves.
      light.shadow.bias = -0.0001;
      light.shadow.normalBias = 0.04;
      Object.assign(light.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: reach + extent + 10 });
      light.shadow.camera.updateProjectionMatrix();
      // Low sun is weaker (more air to pass through) and warmer.
      const strength = Math.min(1, Math.sin((sun.elevation * Math.PI) / 180) * 1.8);
      const warm = Math.max(0, Math.min(1, 1 - sun.elevation / 30));
      light.intensity = 0.9 + 1.5 * strength;
      light.color.setRGB(1, 0.95 - 0.2 * warm, 0.87 - 0.38 * warm);
      ambient.intensity = 0.1 + 0.08 * strength;
      hemisphere.intensity = 0.3 + 0.18 * strength;
      hemisphere.color.copy(defaults.hemiSky);
      // Bounce: sunlit floors light up the rest of the room a little.
      const patches = sunPatches(house, sun, {
        full: (!!state?.layers && isFutureShown(state)),
        wallVisible: (wall) => isPhaseVisible(wall.phase, state || {}),
        roomVisible: (room) => isPhaseVisible(room.phase, state || {}),
      });
      // Skylight glass also lets in daylight from the whole sky, sun or not.
      const skyGlass = new Map();
      for (const skylight of house.skylights || []) {
        if (!isPhaseVisible(skylight.phase, state || {})) continue;
        const room = rooms.find((r) => roofed(r) && pointInPolygon(skylight, r.polygon));
        if (room) skyGlass.set(room.id, (skyGlass.get(room.id) || 0) + skylight.width * skylight.depth);
      }
      const lit = roomSun(house, patches)
        .map((item) => ({ ...item, sky: skyGlass.get(item.roomId) || 0 }))
        .filter((item) => item.lit > 0.5 || item.sky > 0)
        .sort((p, q) => (q.lit + q.sky * 3) - (p.lit + p.sky * 3));
      bounces.forEach((bounce, index) => {
        const item = lit[index];
        const room = item && rooms.find((r) => r.id === item.roomId);
        if (!room) {
          bounce.intensity = 0;
          return;
        }
        const rb = boundsOf([room]);
        const size = Math.hypot(rb.x1 - rb.x0, rb.y1 - rb.y0);
        bounce.position.set((rb.x0 + rb.x1) / 2, 7.5, -(rb.y0 + rb.y1) / 2);
        bounce.distance = size * 1.3;
        // Mostly warm floor bounce; a cooler tint when skylight daylight is most of it.
        const skyShare = item.sky * 3 / (item.sky * 3 + item.lit + 1e-6);
        bounce.color.setRGB(1 - 0.12 * skyShare, 0.9 - 0.1 * warm * (1 - skyShare), 0.75 - 0.15 * warm + 0.17 * skyShare);
        const sunPart = item.lit * 0.12 * (0.5 + strength * 0.5);
        const skyPart = item.sky * 0.11 * (0.6 + strength * 0.4);
        bounce.intensity = Math.min(6, (item.lit > 0.5 ? 1 : 0.4) + sunPart + skyPart);
      });
    },
  };
}


/** The part of a room on the low (front) side of a clerestory's glass line. */
function clipToFront(polygon, g) {
  const keep = (p) => (g.sign > 0 ? p.y <= g.stepY : p.y >= g.stepY);
  const out = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ka = keep(a);
    const kb = keep(b);
    if (ka) out.push(a);
    if (ka !== kb) {
      const t = (g.stepY - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: g.stepY });
    }
  }
  return out;
}
