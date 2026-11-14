/**
 * How wall ends meet, for drawing only. No DOM.
 *
 * Walls are stored as centerlines that meet at a point. Drawn as plain
 * rectangles, two walls that meet at a corner leave a notch on the outside
 * and overlap on the inside. This works out where each face line of a wall
 * should stop, so walls that touch read as one continuous wall:
 * an L corner gets a mitered corner, a T stops at the face of the wall it
 * runs into, and a straight run stays straight.
 *
 * Quantities and cost do not use this. They still read the centerlines.
 */

const NODE_TOL = 0.05;
const MITER_LIMIT = 4;

function unit(dx, dy) {
  const len = Math.hypot(dx, dy);
  return len > 1e-9 ? { x: dx / len, y: dy / len } : null;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function near(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= NODE_TOL;
}

/** Walls (and wall runs) that leave point `p`, as directions away from it. */
function incidentAt(p, walls, selfId) {
  const out = [];
  for (const wall of walls) {
    if (!wall?.start || !wall?.end) continue;
    const half = (Number(wall.thickness) || 0.5) / 2;
    const dir = unit(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (!dir) continue;
    if (near(wall.start, p)) {
      out.push({ id: wall.id, end: "start", dir, half });
      continue;
    }
    if (near(wall.end, p)) {
      out.push({ id: wall.id, end: "end", dir: { x: -dir.x, y: -dir.y }, half });
      continue;
    }
    if (wall.id === selfId) continue;
    // A wall end that lands partway along another wall: that wall runs both ways.
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len2 = dx * dx + dy * dy;
    const t = ((p.x - wall.start.x) * dx + (p.y - wall.start.y) * dy) / len2;
    if (t <= 0 || t >= 1) continue;
    const px = wall.start.x + dx * t;
    const py = wall.start.y + dy * t;
    if (Math.hypot(p.x - px, p.y - py) > NODE_TOL) continue;
    out.push({ id: wall.id, end: "through", dir, half });
    out.push({ id: wall.id, end: "through", dir: { x: -dir.x, y: -dir.y }, half });
  }
  return out;
}

/**
 * Where one face of wall `a` meets one face of wall `b` at point `p`.
 * `sa` and `sb` are +1 for the counterclockwise face, -1 for the clockwise one.
 * Returns null when the faces are parallel or the corner would spike too far.
 */
function faceMeet(p, a, sa, b, sb) {
  const na = { x: -a.dir.y * sa * a.half, y: a.dir.x * sa * a.half };
  const nb = { x: -b.dir.y * sb * b.half, y: b.dir.x * sb * b.half };
  const denom = cross(a.dir, b.dir);
  if (Math.abs(denom) < 1e-3) return null;
  // p + na + t·da = p + nb + u·db
  const w = { x: nb.x - na.x, y: nb.y - na.y };
  const t = cross(w, b.dir) / denom;
  if (Math.abs(t) > MITER_LIMIT * Math.max(a.half, b.half) * 2) return null;
  return { x: p.x + na.x + a.dir.x * t, y: p.y + na.y + a.dir.y * t };
}

function endFaces(wall, endName, walls) {
  const p = endName === "start" ? wall.start : wall.end;
  const list = incidentAt(p, walls, wall.id);
  const self = list.find((item) => item.id === wall.id && item.end === endName);
  const half = (Number(wall.thickness) || 0.5) / 2;
  const dir = unit(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const awayDir = endName === "start" ? dir : { x: -dir.x, y: -dir.y };
  const me = self || { id: wall.id, end: endName, dir: awayDir, half };
  const ccwFace = { x: p.x - me.dir.y * half, y: p.y + me.dir.x * half };
  const cwFace = { x: p.x + me.dir.y * half, y: p.y - me.dir.x * half };
  let ccw = ccwFace;
  let cw = cwFace;
  if (list.length > 1) {
    const angle = (item) => Math.atan2(item.dir.y, item.dir.x);
    const sorted = [...list].sort((x, y) => angle(x) - angle(y));
    const index = sorted.indexOf(me) >= 0 ? sorted.indexOf(me) : sorted.findIndex((item) => item.id === me.id && item.end === me.end);
    const next = sorted[(index + 1) % sorted.length];
    const prev = sorted[(index - 1 + sorted.length) % sorted.length];
    if (next && next !== me) ccw = faceMeet(p, me, 1, next, -1) || ccwFace;
    if (prev && prev !== me) cw = faceMeet(p, me, -1, prev, 1) || cwFace;
  }
  // Facing away from `p` at the start end, counterclockwise is the wall's left (+n).
  // At the far end the wall points back toward its start, so the sides swap.
  return endName === "start" ? { left: ccw, right: cw } : { left: cw, right: ccw };
}

/**
 * For each wall id, the four face points at its two ends.
 * `left` is the +n side used by segmentQuad (n = (-dy, dx) / length).
 */
export function wallJoints(walls) {
  const joints = new Map();
  const list = (walls || []).filter((wall) => wall?.start && wall?.end && unit(wall.end.x - wall.start.x, wall.end.y - wall.start.y));
  for (const wall of list) {
    joints.set(wall.id, {
      start: endFaces(wall, "start", list),
      end: endFaces(wall, "end", list),
    });
  }
  return joints;
}

/**
 * Outline of the stretch of `wall` from s0 to s1 feet along its centerline.
 * A stretch that reaches a wall end uses that end's joint, so corners close up.
 * Same point order as segmentQuad: start+n, end+n, end−n, start−n.
 */
export function pieceOutline(wall, s0, s1, joint) {
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
  const ux = (wall.end.x - wall.start.x) / len;
  const uy = (wall.end.y - wall.start.y) / len;
  const half = (Number(wall.thickness) || 0.5) / 2;
  const nx = -uy * half;
  const ny = ux * half;
  const at = (s) => ({ x: wall.start.x + ux * s, y: wall.start.y + uy * s });
  const a = at(s0);
  const b = at(s1);
  const startLeft = joint && s0 <= 1e-3 ? joint.start.left : { x: a.x + nx, y: a.y + ny };
  const startRight = joint && s0 <= 1e-3 ? joint.start.right : { x: a.x - nx, y: a.y - ny };
  const endLeft = joint && s1 >= len - 1e-3 ? joint.end.left : { x: b.x + nx, y: b.y + ny };
  const endRight = joint && s1 >= len - 1e-3 ? joint.end.right : { x: b.x - nx, y: b.y - ny };
  return [startLeft, endLeft, endRight, startRight];
}
