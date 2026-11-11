/** Dimension strings shared by the plan and the 3D view. Distances are feet. */

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

function sameBox(a, b) {
  return Math.abs(a.x0 - b.x0) < 0.25
    && Math.abs(a.y0 - b.y0) < 0.25
    && Math.abs(a.x1 - b.x1) < 0.25
    && Math.abs(a.y1 - b.y1) < 0.25;
}

function horizontal(id, box, dist, future) {
  return { id, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y0, dist, future };
}

function vertical(id, box, dist, future) {
  return { id, x0: box.x0, y0: box.y0, x1: box.x0, y1: box.y1, dist, future };
}

/**
 * One width and one depth for the rooms on screen.
 * The footprint is added only when it is a different rectangle.
 */
export function planDimensions(house, futureShown) {
  const points = [];
  for (const room of house.rooms || []) {
    if (room.outdoor) continue;
    if (!futureShown && room.phase === "future") continue;
    for (const point of room.polygon || []) points.push(point);
  }
  if (!points.length) {
    for (const wall of house.walls || []) {
      if (!futureShown && wall.phase === "future") continue;
      points.push(wall.start, wall.end);
    }
  }
  const built = boxOf(points);
  const foot = house.footprint?.width && house.footprint?.depth
    ? { x0: 0, y0: 0, x1: house.footprint.width, y1: house.footprint.depth }
    : null;
  const dims = [];
  if (built) {
    dims.push(horizontal("room-width", built, 3.6, false));
    dims.push(vertical("room-depth", built, -3.6, false));
  }
  if (futureShown && foot && (!built || !sameBox(built, foot))) {
    dims.push(horizontal("all-width", foot, built ? 7.4 : 3.6, true));
    dims.push(vertical("all-depth", foot, built ? -7.4 : -3.6, true));
  }
  return dims;
}

/** Positive dist is to the right of start → end. */
export function offsetSegment(dim) {
  const len = Math.hypot(dim.x1 - dim.x0, dim.y1 - dim.y0) || 1;
  const tx = (dim.x1 - dim.x0) / len;
  const ty = (dim.y1 - dim.y0) / len;
  const rx = ty;
  const ry = -tx;
  return {
    x0: dim.x0 + rx * dim.dist,
    y0: dim.y0 + ry * dim.dist,
    x1: dim.x1 + rx * dim.dist,
    y1: dim.y1 + ry * dim.dist,
    len,
    tx,
    ty,
    rx,
    ry,
  };
}
