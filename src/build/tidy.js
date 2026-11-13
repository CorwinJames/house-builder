import { moveEndpointGroup } from "./walls.js";

/** Lengths tidy to this step (3 inches). */
export const TIDY_STEP_FT = 0.25;

/** A corner within this many degrees of square gets squared. */
const SQUARE_TOLERANCE_DEG = 8;

function tidyEnd(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.05) return { x: end.x, y: end.y };
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const stops = [0, 90, 180, -90, -180];
  let best = null;
  let bestDiff = SQUARE_TOLERANCE_DEG;
  for (const stop of stops) {
    let diff = Math.abs(deg - stop);
    if (diff > 180) diff = 360 - diff;
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = stop;
    }
  }
  const snappedLen = Math.max(TIDY_STEP_FT, Math.round(len / TIDY_STEP_FT) * TIDY_STEP_FT);
  if (best == null) {
    const scale = snappedLen / len;
    return { x: start.x + dx * scale, y: start.y + dy * scale };
  }
  const rad = (best * Math.PI) / 180;
  return {
    x: start.x + Math.cos(rad) * snappedLen,
    y: start.y + Math.sin(rad) * snappedLen,
  };
}

/**
 * Square near-right corners and round lengths to 3 inch steps.
 * Shared corners move together so joined walls stay joined.
 */
export function tidyHouse(house, wallIds) {
  const wanted = new Set(wallIds || []);
  let next = house;
  for (let pass = 0; pass < 3; pass += 1) {
    for (const id of wanted) {
      const wall = (next.walls || []).find((item) => item.id === id);
      if (!wall?.start || !wall?.end) continue;
      const end = tidyEnd(wall.start, wall.end);
      if (Math.hypot(end.x - wall.end.x, end.y - wall.end.y) < 0.02) continue;
      next = moveEndpointGroup(next, wall.end, end, 0.35);
    }
  }
  return next;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function distanceToPolygon(point, polygon) {
  if (!polygon || polygon.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

/** Walls whose middle sits on or next to a room outline. */
export function wallsTouchingRoom(house, room) {
  const polygon = room?.polygon || [];
  if (polygon.length < 2) return [];
  const ids = [];
  for (const wall of house.walls || []) {
    if (!wall?.start || !wall?.end) continue;
    const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
    if (distanceToPolygon(mid, polygon) <= 1.6) ids.push(wall.id);
  }
  return ids;
}
