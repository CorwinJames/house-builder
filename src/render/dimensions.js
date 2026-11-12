/** Dimension strings shared by the plan and the 3D view. Distances are feet. */

const SAME_FT = 0.15;
const GAP_FT = 2.4;
const STEP_FT = 2.6;

function boxOf(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const point of points) {
    if (!point) continue;
    x0 = Math.min(x0, point.x);
    y0 = Math.min(y0, point.y);
    x1 = Math.max(x1, point.x);
    y1 = Math.max(y1, point.y);
  }
  if (!Number.isFinite(x0) || x1 - x0 < 0.2 || y1 - y0 < 0.2) return null;
  return { x0, y0, x1, y1 };
}

function span(box) {
  return { width: box.x1 - box.x0, depth: box.y1 - box.y0 };
}

function differentSize(a, b) {
  const left = span(a);
  const right = span(b);
  return Math.abs(left.width - right.width) > SAME_FT || Math.abs(left.depth - right.depth) > SAME_FT;
}

function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function centroid(points) {
  const box = boxOf(points);
  if (!box) return { x: 0, y: 0 };
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}

/** Outside faces of the walls on screen. The stored footprint is not used. */
export function exteriorFaceBox(walls) {
  const list = walls || [];
  const exterior = list.filter((wall) => wall.role === "exterior");
  const used = exterior.length ? exterior : list;
  if (!used.length) return null;
  const ends = used.flatMap((wall) => [wall.start, wall.end]);
  const center = centroid(ends);
  const points = [];
  for (const wall of used) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.2) continue;
    let nx = -dy / len;
    let ny = dx / len;
    const midX = (wall.start.x + wall.end.x) / 2;
    const midY = (wall.start.y + wall.end.y) / 2;
    if (nx * (center.x - midX) + ny * (center.y - midY) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = (wall.thickness || 0) / 2;
    points.push(
      { x: wall.start.x + nx * off, y: wall.start.y + ny * off },
      { x: wall.end.x + nx * off, y: wall.end.y + ny * off },
    );
  }
  return boxOf(points);
}

function insideBox(house, futureShown) {
  const points = [];
  for (const room of house.rooms || []) {
    if (room.outdoor) continue;
    if (!futureShown && room.phase === "future") continue;
    for (const point of room.polygon || []) points.push(point);
  }
  return boxOf(points);
}

function visibleWalls(house, futureShown) {
  return (house.walls || []).filter((wall) => futureShown || wall.phase !== "future");
}

function horizontal(id, box, dist, face) {
  return { id, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y0, dist, future: false, face: face || "" };
}

function vertical(id, box, dist, face) {
  return { id, x0: box.x0, y0: box.y0, x1: box.x0, y1: box.y1, dist, future: false, face: face || "" };
}

/**
 * One width and one depth of the rooms on screen.
 * When the exterior wall faces are a different size, both are returned,
 * labeled "inside" and "outside". The stored footprint is never measured.
 */
export function planDimensions(house, futureShown) {
  const walls = visibleWalls(house, futureShown);
  const inside = insideBox(house, futureShown);
  const outside = exteriorFaceBox(walls);
  if (!inside && !outside) return [];
  const shell = unionBox(outside, inside);
  const labeled = inside && outside && differentSize(inside, outside);
  const dims = [];
  if (labeled) {
    const southIn = (inside.y0 - shell.y0) + GAP_FT;
    const southOut = (outside.y0 - shell.y0) + GAP_FT + STEP_FT;
    const westIn = -((inside.x0 - shell.x0) + GAP_FT);
    const westOut = -((outside.x0 - shell.x0) + GAP_FT + STEP_FT);
    dims.push(horizontal("inside-width", inside, southIn, "inside"));
    dims.push(horizontal("outside-width", outside, southOut, "outside"));
    dims.push(vertical("inside-depth", inside, westIn, "inside"));
    dims.push(vertical("outside-depth", outside, westOut, "outside"));
  } else {
    const box = inside || outside;
    dims.push(horizontal("room-width", box, GAP_FT, ""));
    dims.push(vertical("room-depth", box, -GAP_FT, ""));
  }
  if (futureShown && house.footprint?.width) {
    const width = [...dims].reverse().find((dim) => dim.y0 === dim.y1);
    if (width && Math.abs(Math.abs(width.x1 - width.x0) - house.footprint.width) < 0.3) width.caption = true;
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
