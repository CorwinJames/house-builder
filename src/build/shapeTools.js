/**
 * Proportion helpers for the Room and Wall tools. No DOM.
 *
 * Room tool: the dragged room keeps a chosen width-to-depth ratio, measured
 * inside the walls (the same way the room card and plan labels measure it).
 * Wall tool: a wall started on another wall's end is that wall's length times
 * the ratio, or divided by it, whichever is nearer the cursor.
 */

/** Ratio choices shown in the tool options. `id` matches data/ratios.json when it exists there. */
export const ROOM_SHAPES = [
  { id: "free", label: "Free" },
  { id: "1-1", label: "Square", value: 1 },
  { id: "golden", label: "φ" },
  { id: "sqrt2", label: "√2" },
  { id: "3-2", label: "3:2", value: 1.5 },
  { id: "4-3", label: "4:3", value: 4 / 3 },
  { id: "16-9", label: "16:9", value: 16 / 9 },
];

export const WALL_RATIOS = [
  { id: "free", label: "Free" },
  { id: "1-1", label: "Same", value: 1 },
  { id: "golden", label: "φ" },
  { id: "sqrt2", label: "√2" },
  { id: "3-2", label: "3:2", value: 1.5 },
  { id: "4-3", label: "4:3", value: 4 / 3 },
  { id: "2-1", label: "2:1", value: 2 },
];

/**
 * Far corner of a room rectangle dragged from `start` toward `cursor`, so the
 * inside of the room is `ratio` : 1. The longer side follows the cursor and the
 * shorter side is set from it. `thickness(outward)` gives the wall thickness for
 * the side facing that way ({x:0,y:-1} is south), so the inside size is exact.
 */
export function shapedRoomCorner(start, cursor, ratio, thickness = () => 0) {
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  const r = ratio >= 1 ? ratio : 1 / ratio;
  const offX = (thickness({ x: -1, y: 0 }) + thickness({ x: 1, y: 0 })) / 2;
  const offY = (thickness({ x: 0, y: -1 }) + thickness({ x: 0, y: 1 })) / 2;
  let insideW;
  let insideH;
  if (Math.abs(dx) >= Math.abs(dy)) {
    insideW = Math.max(Math.abs(dx) - offX, 1);
    insideH = insideW / r;
  } else {
    insideH = Math.max(Math.abs(dy) - offY, 1);
    insideW = insideH / r;
  }
  return {
    x: start.x + sx * (insideW + offX),
    y: start.y + sy * (insideH + offY),
    insideWidth: insideW,
    insideDepth: insideH,
  };
}

/**
 * End of a new wall from `start` toward `cursor`, sized against a wall that
 * already ends at `start`. The length is ref × ratio or ref ÷ ratio, whichever
 * is nearer the cursor's distance. `direction` (a unit vector) overrides the
 * cursor's direction, for an angle that has been squared.
 */
export function ratioWallEnd(start, cursor, refLength, ratio, direction = null) {
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  const reach = Math.hypot(dx, dy);
  const dir = direction || (reach > 1e-9 ? { x: dx / reach, y: dy / reach } : { x: 1, y: 0 });
  const r = ratio >= 1 ? ratio : 1 / ratio;
  const longer = refLength * r;
  const shorter = refLength / r;
  const useLonger = r === 1 || Math.abs(reach - longer) <= Math.abs(reach - shorter);
  const length = useLonger ? longer : shorter;
  return {
    x: start.x + dir.x * length,
    y: start.y + dir.y * length,
    length,
    relation: r === 1 ? "same" : (useLonger ? "times" : "over"),
  };
}
