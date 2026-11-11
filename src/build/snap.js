/** Grid, magnet, and 45-degree snapping. Distances are feet. */

export function snapToGrid(value, grid) {
  if (!grid) return value;
  const snapped = Math.round(value / grid) * grid;
  return snapped === 0 ? 0 : snapped;
}

export function snapPointToGrid(point, grid) {
  return { x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid) };
}

function normAngle(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * Pull `point` onto the nearest 0/45/90 ray from `origin`, then onto the grid.
 * Returns the snapped point plus the length in feet.
 */
export function snapAngle(origin, point, grid) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: origin.x, y: origin.y, length: 0, angle: 0 };
  const deg = normAngle((Math.atan2(dy, dx) * 180) / Math.PI);
  const stops = [0, 45, 90, 135, 180, 225, 270, 315];
  let best = 0;
  let bestDiff = 999;
  for (const stop of stops) {
    let diff = Math.abs(deg - stop);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = stop;
    }
  }
  const rad = (best * Math.PI) / 180;
  const snappedLen = Math.max(grid || 0.5, snapToGrid(len, grid || 0.5));
  return {
    x: origin.x + Math.cos(rad) * snappedLen,
    y: origin.y + Math.sin(rad) * snappedLen,
    length: snappedLen,
    angle: best,
  };
}

export function wallMagnets(walls) {
  const magnets = [];
  for (const wall of walls) {
    magnets.push({ x: wall.start.x, y: wall.start.y, kind: "end", wallId: wall.id });
    magnets.push({ x: wall.end.x, y: wall.end.y, kind: "end", wallId: wall.id });
    magnets.push({
      x: (wall.start.x + wall.end.x) / 2,
      y: (wall.start.y + wall.end.y) / 2,
      kind: "mid",
      wallId: wall.id,
    });
  }
  return magnets;
}

export function nearestMagnet(point, magnets, radius) {
  let best = null;
  let bestDist = radius;
  for (const magnet of magnets) {
    const dist = Math.hypot(magnet.x - point.x, magnet.y - point.y);
    if (dist <= bestDist) {
      bestDist = dist;
      best = magnet;
    }
  }
  return best;
}

/** Projection of a point onto a wall centerline, if it lands on the segment. */
export function projectOntoWall(point, wall) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return null;
  let t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = wall.start.x + dx * t;
  const y = wall.start.y + dy * t;
  return {
    x,
    y,
    t,
    distance: Math.hypot(point.x - x, point.y - y),
    offset: Math.sqrt(len2) * t,
  };
}

/**
 * Snap a drawing point. Magnets win, then an angle lock when `origin` is set,
 * then the grid. `magnetRadius` is feet.
 */
export function snapDrawingPoint(point, { grid = 0.5, walls = [], origin = null, magnetRadius = 0.75 } = {}) {
  const magnet = nearestMagnet(point, wallMagnets(walls), magnetRadius);
  if (magnet) return { x: magnet.x, y: magnet.y, snapped: magnet.kind, length: origin ? Math.hypot(magnet.x - origin.x, magnet.y - origin.y) : 0 };
  if (origin) {
    const angled = snapAngle(origin, point, grid);
    return { ...angled, snapped: "angle" };
  }
  const gridded = snapPointToGrid(point, grid);
  return { ...gridded, snapped: "grid", length: 0 };
}
