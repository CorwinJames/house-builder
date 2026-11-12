import * as THREE from "three";
import { countsAsHeated, separatesSite } from "../build/areas.js";

/**
 * Placeholder Chinese hip-and-gable massing.
 * Plan x/y in, Three.js Y-up out (plan y → −Z).
 * This is a shape, not a framing model.
 */
export function createHipAndGableGeometry({ x0, y0, x1, y1, plate, pitch }) {
  const positions = [];
  const push = (x, planY, height) => positions.push(x, height, -planY);

  function tri(a, b, c) {
    push(a[0], a[1], a[2]);
    push(b[0], b[1], b[2]);
    push(c[0], c[1], c[2]);
  }

  function quad(a, b, c, d) {
    tri(a, b, c);
    tri(a, c, d);
  }

  const depth = y1 - y0;
  const run = depth / 2;
  const rise = run * pitch;
  const midY = (y0 + y1) / 2;
  // A pure hip would inset the ridge by `run`. A hip-and-gable keeps a longer
  // ridge and stands a small gable on each end.
  const hip = run * 0.62;
  const rx0 = x0 + hip;
  const rx1 = x1 - hip;
  const ridge = plate + rise;

  const sw = [x0, y0, plate];
  const se = [x1, y0, plate];
  const ne = [x1, y1, plate];
  const nw = [x0, y1, plate];
  const r0 = [rx0, midY, ridge];
  const r1 = [rx1, midY, ridge];

  quad(sw, se, r1, r0);
  quad(ne, nw, r0, r1);
  tri(sw, r0, nw);
  tri(se, ne, r1);

  const gableRise = rise * 0.42;
  const half = depth * 0.18;
  const top = ridge + gableRise;
  const gws = [rx0, midY - half, ridge];
  const gwn = [rx0, midY + half, ridge];
  const gwt = [rx0, midY, top];
  const ges = [rx1, midY - half, ridge];
  const gen = [rx1, midY + half, ridge];
  const get = [rx1, midY, top];

  tri(gws, gwn, gwt);
  tri(ges, get, gen);
  quad(gws, ges, get, gwt);
  quad(gwn, gwt, get, gen);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function boxOf(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const point of points) {
    x0 = Math.min(x0, point.x);
    y0 = Math.min(y0, point.y);
    x1 = Math.max(x1, point.x);
    y1 = Math.max(y1, point.y);
  }
  if (!Number.isFinite(x0) || x1 - x0 < 0.2 || y1 - y0 < 0.2) return null;
  return { x0, y0, x1, y1 };
}

/**
 * One roof over each heated building. Courtyards, gardens, and studies are left out.
 * A plan that does not separate those areas keeps the single roof over its walls.
 */
export function roofFootprints(house, futureShown) {
  if (!separatesSite(house)) return [roofFootprint(house, futureShown)];
  const groups = new Map();
  for (const room of house.rooms || []) {
    if (!countsAsHeated(room)) continue;
    if (!futureShown && room.phase === "future") continue;
    const id = room.building || "main";
    if (!groups.has(id)) groups.set(id, []);
    for (const point of room.polygon || []) groups.get(id).push(point);
  }
  const overhang = futureShown ? (house.roof?.overhang ?? 2) : 1.5;
  const boxes = [];
  for (const points of groups.values()) {
    const box = boxOf(points);
    if (!box) continue;
    boxes.push({
      x0: box.x0 - overhang,
      y0: box.y0 - overhang,
      x1: box.x1 + overhang,
      y1: box.y1 + overhang,
    });
  }
  return boxes.length ? boxes : [roofFootprint(house, futureShown)];
}

export function roofFootprint(house, futureShown) {
  const overhang = futureShown ? house.roof.overhang : 1.5;
  const base = futureShown
    ? { x0: 0, y0: 0, x1: house.footprint.width, y1: house.footprint.depth }
    : { ...house.phases.phase1.bounds };
  for (const wall of house.walls || []) {
    if (!futureShown && wall.phase === "future") continue;
    base.x0 = Math.min(base.x0, wall.start.x, wall.end.x);
    base.y0 = Math.min(base.y0, wall.start.y, wall.end.y);
    base.x1 = Math.max(base.x1, wall.start.x, wall.end.x);
    base.y1 = Math.max(base.y1, wall.start.y, wall.end.y);
  }
  return {
    x0: base.x0 - overhang,
    y0: base.y0 - overhang,
    x1: base.x1 + overhang,
    y1: base.y1 + overhang,
  };
}
