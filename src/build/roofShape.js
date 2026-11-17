/**
 * The placeholder roof as numbers, with no Three.js: where each roof sits on
 * the plan, and how high the roof surface is at any plan point. The 3D view
 * draws the same shape (createRoofGeometry in src/render/roof.js); skylights,
 * their shafts through the attic, and the sun model read it here.
 *
 * Each roof covers a rectangle and has one of four forms (house.roof.style,
 * or house.buildings[name].style for one building):
 *  - hip-and-gable: two long faces to a ridge, short hip ends, and a small
 *    gable standing on each end of the ridge (Chinese xieshan, Japanese
 *    irimoya, Korean paljak). The default.
 *  - hip: four faces, all at the same pitch (wudian, yosemune, ujingak).
 *  - gable: two faces; the roof runs past the end walls (xuanshan, kirizuma,
 *    Korean matbae).
 *  - flush-gable: two faces cut off at the end walls (yingshan).
 * The ridge runs east-west unless ridge says north-south (or auto: along the
 * longer side). curve (0 to 1) sags the slopes and turns the eave corners up.
 * The plate (eave) height is house.roof.plateHeight at the rectangle's edge,
 * which includes the overhang. The small gable at the top of a hip-and-gable
 * is left out of roofAt (it sits above the ridge, never over a skylight).
 */
import { areaKind, countsAsHeated, separatesSite } from "./areas.js";
import { clerestoryBox, clerestoryGeometry, clerestoryRoofAt } from "./clerestory.js";

export const ROOF_STYLES = [
  ["hip-and-gable", "Hip and gable"],
  ["hip", "Hip"],
  ["gable", "Gable"],
  ["flush-gable", "Flush gable"],
];

/** The roof form for one building: its own settings, else the house roof's. */
export function roofSpec(house, buildingId = null) {
  const base = house?.roof || {};
  const own = (buildingId && house?.buildings?.[buildingId]) || {};
  const style = own.style || base.style || "hip-and-gable";
  const ridge = own.ridge || base.ridge || "east-west";
  const curveOwn = Number(own.curve);
  const curve = Number.isFinite(curveOwn) ? curveOwn : (Number(base.curve) || 0);
  const platform = Math.max(0, Number(own.platform) || 0);
  const pitch = Number(own.pitch) > 0 ? Number(own.pitch) : null;
  return { style, ridge, curve: Math.max(0, Math.min(1, curve)), platform, pitch };
}

/** Rooms grouped into buildings: whenever the plan separates site areas, or any room names a building other than main. */
export function groupsBuildings(house) {
  if (separatesSite(house)) return true;
  return (house?.rooms || []).some((room) => room.building && room.building !== "main");
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
  if (!groupsBuildings(house)) return [shaped(house, roofFootprint(house, futureShown), "main")];
  const site = separatesSite(house);
  const groups = new Map();
  const shown = (room) => futureShown || room.phase !== "future";
  for (const room of house.rooms || []) {
    if (!countsAsHeated(room) || !shown(room)) continue;
    const id = room.building || "main";
    if (!groups.has(id)) groups.set(id, []);
    for (const point of room.polygon || []) groups.get(id).push(point);
  }
  // A covered room goes under the roof of the building it names, when that
  // building has heated rooms (a veranda or an engawa under the eaves). When
  // only named buildings (not site drawings) split the plan, an unnamed
  // covered room stays under the main roof, as before.
  for (const room of house.rooms || []) {
    if (areaKind(room) !== "covered" || !shown(room)) continue;
    const id = room.building || (site ? null : "main");
    if (!id || !groups.has(id)) continue;
    for (const point of room.polygon || []) groups.get(id).push(point);
  }
  const overhang = futureShown ? (house.roof?.overhang ?? 2) : 1.5;
  const boxes = [];
  for (const [id, points] of groups) {
    const box = boxOf(points);
    if (!box) continue;
    const spec = roofSpec(house, id);
    const ridge = ridgeAxis(spec.ridge, box);
    boxes.push(shaped(house, withEaves(house, box, overhang, futureShown, spec.style === "flush-gable" ? ridge : null), id, box, futureShown));
  }
  if (!boxes.length) return [shaped(house, roofFootprint(house, futureShown), "main")];
  return boxes;
}

function ridgeAxis(ridge, box) {
  if (ridge === "north-south") return "y";
  if (ridge === "auto") return (box.x1 - box.x0) >= (box.y1 - box.y0) ? "x" : "y";
  return "x";
}

/** Tag an eave box with its building's roof form, and the outer faces of its walls (inner). */
function shaped(house, box, building, walls = null, futureShown = true) {
  const spec = roofSpec(house, building);
  const ridge = ridgeAxis(spec.ridge, walls || box);
  const inner = walls
    ? {
      x0: walls.x0 - edgeHalfThickness(house, walls, "west", futureShown),
      y0: walls.y0 - edgeHalfThickness(house, walls, "south", futureShown),
      x1: walls.x1 + edgeHalfThickness(house, walls, "east", futureShown),
      y1: walls.y1 + edgeHalfThickness(house, walls, "north", futureShown),
    }
    : null;
  return { ...box, building, style: spec.style, ridge, curve: spec.curve, platform: spec.platform, pitch: spec.pitch, inner };
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
function withEaves(house, box, overhang, futureShown, flushAlong = null) {
  const eaves = house.roof?.eaves;
  const half = (side) => edgeHalfThickness(house, box, side, futureShown);
  if (flushAlong) {
    // A flush gable stops at the outer face of its end walls.
    const grown = withEaves(house, box, overhang, futureShown, null);
    if (flushAlong === "x") return { ...grown, x0: box.x0 - half("west"), x1: box.x1 + half("east") };
    return { ...grown, y0: box.y0 - half("south"), y1: box.y1 + half("north") };
  }
  if (!eaves) {
    return { x0: box.x0 - overhang, y0: box.y0 - overhang, x1: box.x1 + overhang, y1: box.y1 + overhang };
  }
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
  const boxes = roofFootprints(house, full);
  const stepped = house?.roof?.clerestory ? clerestoryBox(boxes) : null;
  for (const box of boxes) {
    if (point.x < box.x0 || point.x > box.x1 || point.y < box.y0 || point.y > box.y1) continue;
    if (box === stepped) {
      const at = clerestoryRoofAt(clerestoryGeometry(house, box, full), point);
      if (!best || at.height > best.height) best = at;
      continue;
    }
    const at = roofSurfaceAt(box, point, plate, pitch);
    if (!best || at.height > best.height) best = { ...at, box };
  }
  return best;
}

/**
 * One roof box in its own frame: u runs along the ridge, v across it.
 * endRun is how far the end faces reach in from the ends (Infinity for gables).
 */
export function roofFrame(box, plate, housePitch) {
  const pitch = Number(box.pitch) > 0 ? Number(box.pitch) : housePitch;
  const alongX = box.ridge !== "y";
  const u0 = alongX ? box.x0 : box.y0;
  const u1 = alongX ? box.x1 : box.y1;
  const v0 = alongX ? box.y0 : box.x0;
  const v1 = alongX ? box.y1 : box.x1;
  const length = u1 - u0;
  const run = (v1 - v0) / 2;
  const rise = run * pitch;
  const style = box.style || "hip-and-gable";
  let endRun = Infinity;
  if (style === "hip") endRun = Math.min(run, length / 2);
  if (style === "hip-and-gable") endRun = Math.min(run * 0.62, length * 0.45);
  const endSlope = Number.isFinite(endRun) ? rise / endRun : 0;
  const toPlan = (u, v) => (alongX ? { x: u, y: v } : { x: v, y: u });
  const toLocal = (point) => (alongX ? { u: point.x, v: point.y } : { u: point.y, v: point.x });
  return { alongX, u0, u1, v0, v1, length, run, rise, style, endRun, endSlope, plate, pitch, curve: Number(box.curve) || 0, toPlan, toLocal };
}

/**
 * How much a curved roof moves off its flat planes at (u, v): the slope sags
 * toward its middle, and the eaves turn up toward the corners. Zero along the
 * ridge, zero with curve 0. planarRise is the flat roof's height over the plate.
 */
export function curveLift(frame, u, v, planarRise) {
  const c = frame.curve;
  if (!(c > 0) || !(frame.rise > 0)) return 0;
  const s = Math.max(0, Math.min(1, planarRise / frame.rise));
  const sag = -c * 0.15 * frame.rise * 4 * s * (1 - s);
  const ax = Math.min(1, Math.abs(u - (frame.u0 + frame.u1) / 2) / Math.max(0.01, frame.length / 2));
  const ay = Math.min(1, Math.abs(v - (frame.v0 + frame.v1) / 2) / Math.max(0.01, frame.run));
  const up = c * Math.min(2.5, 0.12 * frame.run * 2) * (ax ** 3) * (ay ** 3);
  return sag + up;
}

/** The flat roof's height over the plate at (u, v), and which face it is on. */
export function planarRise(frame, u, v) {
  const dv = Math.min(v - frame.v0, frame.v1 - v);
  const du = Math.min(u - frame.u0, frame.u1 - u);
  const side = dv * frame.pitch;
  const end = Number.isFinite(frame.endRun) ? du * frame.endSlope : Infinity;
  if (end < side && end < frame.rise) return { rise: end, on: "end", lowEnd: u - frame.u0 < frame.u1 - u };
  return { rise: Math.min(side, frame.rise), on: "side", lowSide: v - frame.v0 < frame.v1 - v };
}

/** The roof surface over a plan point inside one box (see roofAt). */
export function roofSurfaceAt(box, point, plate, pitch) {
  const frame = roofFrame(box, plate, pitch);
  const { u, v } = frame.toLocal(point);
  const flat = planarRise(frame, u, v);
  const height = plate + flat.rise + curveLift(frame, u, v, flat.rise);
  if (flat.on === "end") {
    const low = flat.lowEnd;
    const face = frame.alongX ? (low ? "west" : "east") : (low ? "south" : "north");
    const sign = low ? -1 : 1;
    return {
      height,
      downhill: frame.alongX ? { x: sign, y: 0 } : { x: 0, y: sign },
      slope: frame.endSlope,
      angle: Math.atan(frame.endSlope),
      face,
      run: frame.endRun,
    };
  }
  const low = flat.lowSide;
  const face = frame.alongX ? (low ? "south" : "north") : (low ? "west" : "east");
  const sign = low ? -1 : 1;
  return {
    height,
    downhill: frame.alongX ? { x: 0, y: sign } : { x: sign, y: 0 },
    slope: frame.pitch,
    angle: Math.atan(frame.pitch),
    face,
    run: frame.run,
  };
}

/** Ridge and hip lines of one roof box, for the plan: [{a, b}] in plan feet. */
export function roofLines(box) {
  const frame = roofFrame(box, 0, 1);
  const vc = (frame.v0 + frame.v1) / 2;
  const P = frame.toPlan;
  const lines = [];
  if (!Number.isFinite(frame.endRun)) {
    lines.push({ a: P(frame.u0, vc), b: P(frame.u1, vc) });
    return lines;
  }
  const r0 = frame.u0 + frame.endRun;
  const r1 = frame.u1 - frame.endRun;
  lines.push({ a: P(r0, vc), b: P(r1, vc) });
  for (const [u, r] of [[frame.u0, r0], [frame.u1, r1]]) {
    lines.push({ a: P(u, frame.v0), b: P(r, vc) });
    lines.push({ a: P(u, frame.v1), b: P(r, vc) });
  }
  return lines;
}

/** A building platform's outline: out past the walls, about halfway to the eave line. */
export function platformRect(box) {
  const inner = box.inner || { x0: box.x0 + 2, y0: box.y0 + 2, x1: box.x1 - 2, y1: box.y1 - 2 };
  const grow = (a, b) => a + (b - a) * 0.55;
  return { x0: grow(inner.x0, box.x0), y0: grow(inner.y0, box.y0), x1: grow(inner.x1, box.x1), y1: grow(inner.y1, box.y1) };
}
