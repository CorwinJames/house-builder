/**
 * Window awnings as plan pieces: a fixed horizontal shade on the outside face
 * of the wall, `depth` out from the face, `gap` above the window head, running
 * `extend` past each side. No DOM. Used by the plan, the 3D view, and the sun.
 */
import { wallFacing } from "../sun/passive.js";

export function awningPieces(house) {
  const pieces = [];
  for (const opening of house.openings || []) {
    if (!(opening.awning?.depth > 0)) continue;
    const wall = (house.walls || []).find((item) => item.id === opening.wallId);
    if (!wall) continue;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const u = { x: dx / len, y: dy / len };
    const facing = wallFacing(house, wall, wall.phase === "future");
    const half = (Number(wall.thickness) || 0.5) / 2;
    const extend = Number(opening.awning.extend) || 0;
    const a = opening.offset - extend;
    const b = opening.offset + opening.width + extend;
    const depth = opening.awning.depth;
    const at = (s, out) => ({
      x: wall.start.x + u.x * s + facing.out.x * (half + out),
      y: wall.start.y + u.y * s + facing.out.y * (half + out),
    });
    const polygon = [at(a, 0), at(b, 0), at(b, depth), at(a, depth)];
    const mid = (a + b) / 2;
    pieces.push({
      opening,
      wall,
      polygon,
      length: b - a,
      depth,
      height: (Number(opening.sill) || 0) + (Number(opening.height) || 0) + (Number(opening.awning.gap) || 0),
      center: at(mid, depth / 2),
      angle: Math.atan2(dy, dx),
    });
  }
  return pieces;
}
