/**
 * Sun lighting for the 3D view. When the Sun and shade layer is on, the main
 * light moves to the real (or hand-set) sun, gets warmer and dimmer when it is
 * low, and the sky fill drops so rooms read darker where no sun reaches.
 *
 * Shadow-only stand-ins (full-height walls with their glass left open, and a
 * ceiling over every roofed room) keep the light honest when the roof is off
 * or the view is cut away. They draw nothing on screen and can't be clicked.
 * Each room that gets sun on its floor also gets a soft warm bounce light,
 * stronger the more of the room is sunlit.
 */
import * as THREE from "three";
import { isPhaseVisible } from "./visibility.js";
import { glazing, roofed, roomSun, sunPatches } from "../sun/light.js";
import { boundsOf } from "../build/areas.js";

const BOUNCE_LIGHTS = 6;
const DEFAULT_HEIGHT = 10;

export function createSunRig({ scene, ambient, hemisphere, light }) {
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
  const bounces = Array.from({ length: BOUNCE_LIGHTS }, () => {
    const point = new THREE.PointLight(0xffd9a8, 0, 20, 1.2);
    point.castShadow = false;
    scene.add(point);
    return point;
  });
  let casterKey = "";
  let casterHouse = null;

  function pick(cam) {
    return { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, far: cam.far };
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
    const top = Math.max(DEFAULT_HEIGHT, ...walls.map((wall) => Number(wall.height) || 0));
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
    for (const room of house?.rooms || []) {
      if (!roofed(room) || !(room.polygon?.length >= 3) || !isPhaseVisible(room.phase, state || {})) continue;
      const shape = new THREE.Shape(room.polygon.map((point) => new THREE.Vector2(point.x, point.y)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      add(geometry, new THREE.Vector3(0, top, 0));
    }
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
    for (const bounce of bounces) bounce.intensity = 0;
  }

  return {
    /** sun: from currentSun, or null to go back to the everyday light. */
    apply(sun, house, state) {
      if (!sun) {
        restore();
        return;
      }
      rebuildCasters(house, state);
      casters.visible = true;
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
      const reach = radius + 80;
      light.visible = true;
      light.target.position.set(cx, 0, -cy);
      light.position.set(cx + v.x * reach, v.z * reach, -cy - v.y * reach);
      const extent = radius + 30 + Math.min(80, DEFAULT_HEIGHT / Math.max(0.12, Math.tan((sun.elevation * Math.PI) / 180)));
      Object.assign(light.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: reach * 2 + 40 });
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
        wallVisible: (wall) => isPhaseVisible(wall.phase, state || {}),
        roomVisible: (room) => isPhaseVisible(room.phase, state || {}),
      });
      const lit = roomSun(house, patches).filter((item) => item.lit > 0.5).sort((p, q) => q.lit - p.lit);
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
        bounce.color.setRGB(1, 0.9 - 0.1 * warm, 0.75 - 0.15 * warm);
        bounce.intensity = Math.min(6, 1 + item.lit * 0.12) * (0.5 + strength * 0.5);
      });
    },
  };
}
