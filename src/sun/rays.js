/**
 * What stands between a point on a wall and the sun. No DOM.
 *
 * A straight line from the point toward the sun is blocked by:
 * - a roof: the line rises at tan(sun height) per foot it runs; if it reaches
 *   the roof surface before it leaves that roof's footprint, it is blocked.
 *   (The roof is the same surface the 3D view draws: plate height at the eave
 *   edge, rising to the ridge, with gable rakes, hips, and curves.)
 * - another building: under its roof the line runs into walls.
 * - a wall it crosses lower than that wall's top.
 * - an awning plate it meets from below.
 *
 * `litRange(ray, point, dir, z0, z1)` gives the part of a vertical span on the
 * wall face, [lo, hi], that sees the sun, or null when none of it does.
 */
import { clerestoryBox, clerestoryGeometry, clerestoryRoofAt } from "../build/clerestory.js";
import { roofFootprints, roofSurfaceAt } from "../build/roofShape.js";
import { awningPieces } from "../build/awnings.js";

const STEP = 0.2;
const MAX_RUN = 400;

export function sunObstacles(house, sun, { full = false, wallVisible = () => true } = {}) {
  const plate = Number(house?.roof?.plateHeight) || 10;
  const pitch = Number(house?.roof?.pitchRiseOverRun) || 0.5;
  const boxes = roofFootprints(house, full).filter(Boolean);
  const stepped = house?.roof?.clerestory ? clerestoryBox(boxes) : null;
  const roofs = boxes.map((box) => {
    if (box === stepped) {
      const g = clerestoryGeometry(house, box, full);
      return { box, top: (p) => clerestoryRoofAt(g, p).height };
    }
    return { box, top: (p) => roofSurfaceAt(box, p, plate, pitch).height };
  });
  const walls = (house.walls || []).filter((wall) => wallVisible(wall)).map((wall) => ({
    wall,
    a: wall.start,
    b: wall.end,
    height: Number(wall.height) || plate,
  }));
  const awnings = awningPieces(house).filter((piece) => wallVisible(piece.wall));
  const horizontal = Math.hypot(sun.vector.x, sun.vector.y);
  return {
    roofs,
    walls,
    awnings,
    tan: sun.vector.z / Math.max(1e-6, horizontal),
    dir: { x: sun.vector.x / Math.max(1e-6, horizontal), y: sun.vector.y / Math.max(1e-6, horizontal) },
  };
}

/** Where a ray (from p along unit dir) is inside an axis box: [s0, s1] with s1 > 0, or null. */
function boxInterval(box, p, dir) {
  let s0 = -Infinity;
  let s1 = Infinity;
  for (const [o, d, lo, hi] of [[p.x, dir.x, box.x0, box.x1], [p.y, dir.y, box.y0, box.y1]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    s0 = Math.max(s0, a);
    s1 = Math.min(s1, b);
  }
  if (s1 <= Math.max(0, s0)) return null;
  return [Math.max(0, s0), Math.min(s1, MAX_RUN)];
}

/** Where a ray crosses segment ab: distance s > 0, or null. */
function segmentCross(a, b, p, dir) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = dir.x * ey - dir.y * ex;
  if (Math.abs(den) < 1e-9) return null;
  const wx = a.x - p.x;
  const wy = a.y - p.y;
  const s = (wx * ey - wy * ex) / den;
  const t = (wx * dir.y - wy * dir.x) / den;
  if (s <= 1e-3 || t < 0 || t > 1) return null;
  return s;
}

/** Where a ray is inside a convex polygon: [s0, s1], or null. */
function polygonInterval(polygon, p, dir) {
  let s0 = 0;
  let s1 = MAX_RUN;
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    // Inside: cross((b - a), (q - a)) * sign >= 0, with q = p + s dir.
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const c0 = (ex * (p.y - a.y) - ey * (p.x - a.x)) * sign;
    const c1 = (ex * dir.y - ey * dir.x) * sign;
    if (Math.abs(c1) < 1e-12) {
      if (c0 < -1e-9) return null;
      continue;
    }
    const s = -c0 / c1;
    if (c1 > 0) s0 = Math.max(s0, s);
    else s1 = Math.min(s1, s);
  }
  return s1 > s0 ? [s0, s1] : null;
}

/**
 * The part of the span [z0, z1] (heights on the wall face at plan point p)
 * that sees the sun. `skipWall` is the wall the point is on.
 */
export function litRange(obstacles, p, z0, z1, skipWall = null) {
  const { tan, dir } = obstacles;
  let lo = z0;
  let hi = z1;
  for (const roof of obstacles.roofs) {
    const span = boxInterval(roof.box, p, dir);
    if (!span) continue;
    const [s0, s1] = span;
    const own = s0 <= 1e-6;
    // Own roof (the point is under its eave): the line must clear the surface
    // until it leaves the footprint. Another building: the line must pass over it.
    let cap = Infinity;
    let floor = -Infinity;
    const count = Math.max(1, Math.ceil((s1 - s0) / STEP));
    for (let i = 0; i <= count; i += 1) {
      const s = s0 + ((s1 - s0) * i) / count;
      const q = { x: p.x + dir.x * s, y: p.y + dir.y * s };
      const limit = roof.top(q) - s * tan;
      if (own) cap = Math.min(cap, limit);
      else floor = Math.max(floor, limit);
    }
    hi = Math.min(hi, cap);
    lo = Math.max(lo, floor);
  }
  for (const item of obstacles.walls) {
    if (item.wall === skipWall) continue;
    const s = segmentCross(item.a, item.b, p, dir);
    if (s === null) continue;
    lo = Math.max(lo, item.height - s * tan);
  }
  for (const piece of obstacles.awnings) {
    const span = polygonInterval(piece.polygon, p, dir);
    if (!span) continue;
    // Lines leaving p between these heights meet the awning's underside.
    const bandLo = piece.height - span[1] * tan;
    const bandHi = piece.height - span[0] * tan;
    if (bandHi <= lo || bandLo >= hi) continue;
    if (bandLo <= lo) lo = Math.max(lo, bandHi);
    else hi = Math.min(hi, bandLo);
  }
  return hi > lo + 1e-3 ? [lo, hi] : null;
}

/** Clip polygon `subject` by convex polygon `clip` (Sutherland–Hodgman). */
export function clipConvex(subject, clip) {
  let area = 0;
  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (q) => ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) * sign;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j += 1) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

/** Convex hull of plan points (monotone chain), counter-clockwise. */
export function convexHull(points) {
  const list = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (list.length < 3) return list;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of list) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of list.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
