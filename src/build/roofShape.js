/**
 * The placeholder roof as numbers, with no Three.js: where each roof sits on
 * the plan, and how high the roof surface is at any plan point. The 3D view
 * draws the same shape (createHipAndGableGeometry in src/render/roof.js);
 * skylights, their shafts through the attic, and the sun model read it here.
 *
 * Each roof is a hip-and-gable over a rectangle: two long faces rising from
 * the south and north eaves to a ridge along x, and two hip ends rising from
 * the west and east eaves. The plate (eave) height is house.roof.plateHeight
 * at the rectangle's edge, which includes the overhang. The small gable at the
 * top of each hip is left out (it sits above the ridge, never over a skylight).
 */
import { countsAsHeated, separatesSite } from "./areas.js";

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
    boxes.push(withEaves(house, box, overhang, futureShown));
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
  return withEaves(house, base, overhang, futureShown);
}

/**
 * Grow the walls' box by the eaves. With house.roof.eaves set, each side's
 * eave is measured past the outer face of the walls on that edge; otherwise
 * the old single overhang is measured from the wall centerlines.
 */
function withEaves(house, box, overhang, futureShown) {
  const eaves = house.roof?.eaves;
  if (!eaves) {
    return { x0: box.x0 - overhang, y0: box.y0 - overhang, x1: box.x1 + overhang, y1: box.y1 + overhang };
  }
  const half = (side) => edgeHalfThickness(house, box, side, futureShown);
  const pick = (side) => (Number.isFinite(eaves[side]) ? eaves[side] : overhang);
  return {
    x0: box.x0 - pick("west") - half("west"),
    y0: box.y0 - pick("south") - half("south"),
    x1: box.x1 + pick("east") + half("east"),
    y1: box.y1 + pick("north") + half("north"),
  };
}

/**
 * How far the outer face of the walls along one edge of the box sits past that
 * edge: half a wall when the box runs through wall centerlines, nothing when
 * it already runs along the outer faces. 0.5 ft when no wall lies on the edge.
 */
export function edgeHalfThickness(house, box, side, futureShown = true) {
  const near = (a, b) => Math.abs(a - b) < 0.05;
  let best = null;
  for (const wall of house.walls || []) {
    if (!futureShown && wall.phase === "future") continue;
    const half = (Number(wall.thickness) || 0) / 2;
    const horizontal = near(wall.start.y, wall.end.y);
    const vertical = near(wall.start.x, wall.end.x);
    let c = null;
    let edge = null;
    let outward = 1;
    if (side === "south" && horizontal) { c = wall.start.y; edge = box.y0; outward = -1; }
    if (side === "north" && horizontal) { c = wall.start.y; edge = box.y1; outward = 1; }
    if (side === "west" && vertical) { c = wall.start.x; edge = box.x0; outward = -1; }
    if (side === "east" && vertical) { c = wall.start.x; edge = box.x1; outward = 1; }
    if (c === null) continue;
    const face = c + outward * half;
    if (near(c, edge) || near(face, edge)) {
      const past = (face - edge) * outward;
      if (best === null || past > best) best = past;
    }
  }
  return best === null ? 0.5 : best;
}

/**
 * The roof surface at a plan point: { height, downhill: {x, y}, slope (rise per
 * run), angle (radians), face: "south" | "north" | "west" | "east", run (ft of
 * plan distance from that face's eave to the ridge) }, or null when no roof is
 * over the point. `full` uses the full-house roof (true) or phase 1 (false).
 */
export function roofAt(house, point, full = false) {
  const plate = Number(house?.roof?.plateHeight) || 10;
  const pitch = Number(house?.roof?.pitchRiseOverRun) || 0.5;
  let best = null;
  for (const box of roofFootprints(house, full)) {
    if (point.x < box.x0 || point.x > box.x1 || point.y < box.y0 || point.y > box.y1) continue;
    const depth = box.y1 - box.y0;
    const run = depth / 2;
    const rise = run * pitch;
    const hip = run * 0.62;
    const hipSlope = rise / hip;
    const faces = [
      { face: "south", rise: (point.y - box.y0) * pitch, downhill: { x: 0, y: -1 }, slope: pitch, run },
      { face: "north", rise: (box.y1 - point.y) * pitch, downhill: { x: 0, y: 1 }, slope: pitch, run },
      { face: "west", rise: (point.x - box.x0) * hipSlope, downhill: { x: -1, y: 0 }, slope: hipSlope, run: hip },
      { face: "east", rise: (box.x1 - point.x) * hipSlope, downhill: { x: 1, y: 0 }, slope: hipSlope, run: hip },
    ];
    const low = faces.reduce((a, b) => (b.rise < a.rise ? b : a));
    const height = plate + Math.min(low.rise, rise);
    if (!best || height > best.height) {
      best = {
        height,
        downhill: low.downhill,
        slope: low.slope,
        angle: Math.atan(low.slope),
        face: low.face,
        run: low.run,
        box,
      };
    }
  }
  return best;
}
