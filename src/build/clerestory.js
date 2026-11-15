/**
 * A clerestory roof: a low roof in front, a band of high glass, and a raised
 * roof behind it (like a "stepped" or monitor roof). No DOM, no Three.js.
 *
 * Stored as house.roof.clerestory = { face, setback, glass, eave, lowPitch }:
 * - face: which way the glass looks, "south" or "north".
 * - setback: feet from the outer face of the front wall back to the glass.
 * - glass: height of the glass band, feet.
 * - eave: how far the upper roof sticks out over the glass, feet.
 * - lowPitch: rise per foot of the low roof (default 0.25, a 3:12).
 *
 * Section, front to back (front = the side the glass faces):
 *   lower shed: from the front eave at plate height, rising at the roof pitch
 *     to the glass line (lowTop);
 *   a 1 ft curb (flashing), the glass band, a 1 ft header (placeholder sizes);
 *   upper shed: from its eave over the glass, falling to the back eave at
 *     plate height. Its pitch follows from those heights.
 * The ends are gables. Applies to the biggest roof (the main building).
 */

export const CURB = 1;
export const HEADER = 1;
export const MIN_BACK = 4;

export function clerestoryDefaults(house, place = null) {
  return { face: place && place.lat < 0 ? "north" : "south", setback: 0, glass: 2.5, eave: 2 };
}

/** The outer faces of the walls inside a roof box. */
export function wallFaces(house, box, full = true) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const wall of house.walls || []) {
    if (!full && wall.phase === "future") continue;
    const half = (Number(wall.thickness) || 0.5) / 2;
    const inside = [wall.start, wall.end].every((p) => p.x >= box.x0 - 1e-6 && p.x <= box.x1 + 1e-6 && p.y >= box.y0 - 1e-6 && p.y <= box.y1 + 1e-6);
    if (!inside) continue;
    for (const p of [wall.start, wall.end]) {
      x0 = Math.min(x0, p.x - half);
      y0 = Math.min(y0, p.y - half);
      x1 = Math.max(x1, p.x + half);
      y1 = Math.max(y1, p.y + half);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { ...box };
}

/** Is this roof box the one that gets the clerestory? (The biggest.) */
export function clerestoryBox(boxes) {
  if (!boxes.length) return null;
  return boxes.reduce((best, box) => ((box.x1 - box.x0) * (box.y1 - box.y0) > (best.x1 - best.x0) * (best.y1 - best.y0) ? box : best));
}

/** Everything about the clerestory over one roof box, or null when the roof has none. */
export function clerestoryGeometry(house, box, full = true) {
  const c = house?.roof?.clerestory;
  if (!c || !box) return null;
  const plate = Number(house.roof?.plateHeight) || 10;
  // The low roof has its own, usually shallow, pitch; the high roof's pitch follows from the heights.
  const pitch = Number(c.lowPitch) > 0 ? Number(c.lowPitch) : 0.25;
  const faces = wallFaces(house, box, full);
  const face = c.face === "north" ? "north" : "south";
  const sign = face === "south" ? 1 : -1; // inward from the front
  const front = face === "south" ? box.y0 : box.y1;
  const back = face === "south" ? box.y1 : box.y0;
  const frontFace = face === "south" ? faces.y0 : faces.y1;
  const backFace = face === "south" ? faces.y1 : faces.y0;
  const depth = Math.abs(backFace - frontFace);
  const wanted = Number.isFinite(c.setback) && c.setback > 0 ? c.setback : depth * 0.4;
  const setback = Math.max(1, Math.min(depth - MIN_BACK, wanted));
  const stepY = frontFace + sign * setback;
  const lowTop = plate + Math.abs(stepY - front) * pitch;
  const glass = Math.max(0.5, Number(c.glass) || 2.5);
  const sill = lowTop + CURB;
  const glassTop = sill + glass;
  const top = glassTop + HEADER;
  const backRun = Math.abs(back - stepY);
  const upperPitch = (top - plate) / backRun;
  const eave = Math.max(0, Number.isFinite(c.eave) ? c.eave : 2);
  const upperEdgeY = stepY - sign * eave;
  return {
    face,
    back: face === "south" ? "north" : "south",
    sign,
    box,
    faces,
    plate,
    pitch,
    front,
    backY: back,
    frontFace,
    backFace,
    setback,
    stepY,
    lowTop,
    sill,
    glass,
    glassTop,
    top,
    upperPitch,
    eave,
    upperEdgeY,
    eaveHeight: top + eave * upperPitch,
    glassX0: faces.x0,
    glassX1: faces.x1,
    glassArea: (faces.x1 - faces.x0) * glass,
  };
}

/** Height of the lower roof at a plan y, and of the upper roof. */
export function lowerHeight(g, y) {
  return g.plate + Math.abs(y - g.front) * g.pitch;
}

export function upperHeight(g, y) {
  return g.plate + Math.abs(g.backY - y) * g.upperPitch;
}

/** The roof surface over a point inside the clerestory box (same shape as roofAt). */
export function clerestoryRoofAt(g, point) {
  const d = Math.abs(point.y - g.front);
  const edge = Math.abs(g.upperEdgeY - g.front);
  if (d >= edge) {
    return {
      height: upperHeight(g, point.y),
      downhill: { x: 0, y: g.sign },
      slope: g.upperPitch,
      angle: Math.atan(g.upperPitch),
      face: g.back,
      run: Math.abs(g.backY - g.upperEdgeY),
      box: g.box,
      clerestory: "upper",
    };
  }
  return {
    height: lowerHeight(g, point.y),
    downhill: { x: 0, y: -g.sign },
    slope: g.pitch,
    angle: Math.atan(g.pitch),
    face: g.face,
    run: Math.abs(g.stepY - g.front),
    box: g.box,
    clerestory: "lower",
  };
}

/**
 * Eave depths over the glass that put the summer noon shadow at or below the
 * target and keep the glass in full sun at winter noon. The eave edge rises
 * with depth (the upper roof slopes up toward it), so: height = top + e·pitch.
 */
export function clerestoryEaveRange(g, target, tanSummer, tanWinter) {
  const p = g.upperPitch;
  let min = 0;
  let max = Infinity;
  if (tanSummer > p) min = Math.max(0, (g.top - target) / (tanSummer - p));
  else min = Infinity;
  if (tanWinter < p) max = HEADER / (p - tanWinter);
  return { min, max, ok: min <= max };
}

/** How far into the house the glass sends noon sun at this altitude (from the glass line). */
export function sunReach(g, tan) {
  return { from: (g.sill - 0) / tan, to: g.glassTop / tan };
}
