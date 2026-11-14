import { wallLength } from "../lib/geom.js";
import { cloneHouse, translateWall } from "./walls.js";
import { findRatio, ratioValue, roomBox, roomProportion } from "./ratios.js";
import { syncRooms } from "./rooms.js";

export const FOOTPRINT_WIDTH = "footprint:width";
export const FOOTPRINT_DEPTH = "footprint:depth";

export function lengthOf(house, id) {
  if (id === FOOTPRINT_WIDTH) return house.footprint.width;
  if (id === FOOTPRINT_DEPTH) return house.footprint.depth;
  const wall = house.walls.find((item) => item.id === id);
  return wall ? wallLength(wall) : null;
}

export function factorOf(constraint, custom = []) {
  if (constraint.ratioId === "custom") return constraint.customValue || null;
  const ratio = findRatio(constraint.ratioId, custom);
  return ratio ? ratioValue(ratio) : constraint.customValue || null;
}

export function desiredLength(house, constraint, custom = []) {
  const reference = lengthOf(house, constraint.referenceId);
  const factor = factorOf(constraint, custom);
  if (reference == null || !factor) return null;
  return constraint.operation === "divide" ? reference / factor : reference * factor;
}

export function constraintReadout(house, constraint, custom = []) {
  const actual = lengthOf(house, constraint.targetId);
  const desired = desiredLength(house, constraint, custom);
  if (actual == null || desired == null) return null;
  const deviation = (actual - desired) / desired;
  const ratio = findRatio(constraint.ratioId, custom);
  const symbol = constraint.ratioId === "custom" ? `${constraint.customValue}` : (ratio?.symbol || constraint.ratioId);
  const op = constraint.operation === "divide" ? "÷" : "×";
  return {
    actual,
    desired,
    deviation,
    exact: Math.abs(deviation) < 0.0005,
    badge: `${symbol} ${op} ${shortName(constraint.referenceId)}`,
    symbol,
  };
}

function shortName(id) {
  if (id === FOOTPRINT_WIDTH) return "width";
  if (id === FOOTPRINT_DEPTH) return "depth";
  return id.replace(/^wall-/, "");
}

function setLength(house, id, length) {
  if (id === FOOTPRINT_WIDTH) {
    house.footprint.width = length;
    return;
  }
  if (id === FOOTPRINT_DEPTH) {
    house.footprint.depth = length;
    return;
  }
  const wall = house.walls.find((item) => item.id === id);
  if (!wall) return;
  const current = wallLength(wall);
  if (current < 1e-6) return;
  const ux = (wall.end.x - wall.start.x) / current;
  const uy = (wall.end.y - wall.start.y) / current;
  wall.end = { x: wall.start.x + ux * length, y: wall.start.y + uy * length };
}

/**
 * Apply constraints whose reference is already settled.
 * Cycles and two constraints on one target are reported and skipped.
 * Footprint targets are included only when `includeFootprint` is true,
 * so opening the sample does not silently resize 76 ft.
 */
export function solveConstraints(house, { includeFootprint = false, custom = null } = {}) {
  const customRatios = custom || house.customRatios || [];
  const warnings = [];
  const byTarget = new Map();
  for (const constraint of house.constraints || []) {
    if (!includeFootprint && String(constraint.targetId).startsWith("footprint:")) continue;
    if (byTarget.has(constraint.targetId)) {
      warnings.push({
        id: `conflict-${constraint.id}`,
        severity: "warn",
        code: "proportion.conflict",
        message: "Two proportions try to set the same length.",
        target: { type: "constraint", id: constraint.id },
      });
      continue;
    }
    byTarget.set(constraint.targetId, constraint);
  }

  const cyclic = new Set();
  const visit = (id, stack) => {
    if (stack.includes(id)) {
      const loop = stack.slice(stack.indexOf(id));
      loop.forEach((item) => cyclic.add(item));
      warnings.push({
        id: `cycle-${loop.join("-")}`,
        severity: "warn",
        code: "proportion.cycle",
        message: `Proportion loop (${loop.map(shortName).join(" → ")}). Nothing in the loop was moved.`,
        target: { type: "constraint", id: byTarget.get(id)?.id },
      });
      return;
    }
    const constraint = byTarget.get(id);
    if (!constraint || cyclic.has(constraint.referenceId)) return;
    visit(constraint.referenceId, [...stack, id]);
  };
  for (const id of byTarget.keys()) visit(id, []);

  const pending = new Set([...byTarget.keys()].filter((id) => !cyclic.has(id)));
  const next = cloneHouse(house);
  let guard = 0;
  while (pending.size && guard < 40) {
    guard += 1;
    let progressed = false;
    for (const id of [...pending]) {
      const constraint = byTarget.get(id);
      if (pending.has(constraint.referenceId)) continue;
      const desired = desiredLength(next, constraint, customRatios);
      if (desired == null) {
        warnings.push({
          id: `missing-${constraint.id}`,
          severity: "warn",
          code: "proportion.missing",
          message: "A proportion is missing its reference.",
          target: { type: "constraint", id: constraint.id },
        });
      } else {
        setLength(next, id, desired);
      }
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) break;
  }
  return { house: next, warnings };
}

export function linkWall(house, targetId, referenceId, ratioId, operation, customValue) {
  const next = cloneHouse(house);
  next.constraints = next.constraints || [];
  next.constraints = next.constraints.filter((item) => item.targetId !== targetId);
  next.constraints.push({
    id: `proportion-${targetId}`,
    targetId,
    referenceId,
    ratioId,
    operation,
    ...(ratioId === "custom" ? { customValue } : {}),
  });
  return solveConstraints(next).house;
}

export function unlink(house, targetId) {
  const next = cloneHouse(house);
  next.constraints = (next.constraints || []).filter((item) => item.targetId !== targetId);
  return next;
}

/**
 * Reshape a room to a named ratio (long side : short side, inside the walls)
 * by moving one of its walls.
 *
 * It tries each side of the room and each way to reach the ratio (stretch or
 * shrink the width, or the depth), keeps only results where the room really
 * ends up at the ratio and no rooms were merged or lost, and picks the
 * smallest move. Walls that touch the moved wall stretch with it, so the room
 * stays closed. Clips are kept as they were.
 */
export function snapRoomToRatio(house, roomId, ratioId, custom = []) {
  const room = house.rooms.find((item) => item.id === roomId);
  const ratio = findRatio(ratioId, custom);
  if (!room || !ratio) return { house, warnings: [] };
  const factor = ratioValue(ratio);
  const target = factor >= 1 ? factor : 1 / factor;
  const box = roomBox(room);
  const wantWidths = [box.depth * target, box.depth / target];
  const wantDepths = [box.width * target, box.width / target];
  const options = [];
  wantWidths.forEach((width, index) => {
    const delta = width - box.width;
    const long = index === 0;
    options.push({ side: "x1", delta, long }, { side: "x0", delta: -delta, long });
  });
  wantDepths.forEach((depth, index) => {
    const delta = depth - box.depth;
    const long = index === 0;
    options.push({ side: "y1", delta, long }, { side: "y0", delta: -delta, long });
  });
  options.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  const center = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  const roomCount = (house.rooms || []).length;
  for (const option of options) {
    if (Math.abs(option.delta) < 1e-4) return { house, warnings: [] };
    const axis = option.side[0];
    const wall = wallOnSide(house, box, option.side);
    if (!wall) continue;
    const loose = { ...house, joins: undefined };
    const outward = option.side.endsWith("1") ? 1 : -1;
    let delta = option.delta;
    // The room outline is worked out again after the move, and its corners can
    // land a little differently. Measure, correct the move, and try again.
    for (let pass = 0; pass < 5; pass += 1) {
      const moved = translateWall(loose, wall.id, axis === "x" ? delta : 0, axis === "y" ? delta : 0);
      if (Array.isArray(house.joins)) moved.joins = JSON.parse(JSON.stringify(house.joins));
      const synced = syncRooms(moved);
      if ((synced.rooms || []).length < roomCount) break;
      const after = synced.rooms.find((item) => item.id === roomId) || nearestRoom(synced.rooms, center);
      if (!after) break;
      const shape = roomBox(after);
      const current = axis === "x" ? shape.width : shape.depth;
      const other = axis === "x" ? shape.depth : shape.width;
      const long = Math.max(shape.width, shape.depth);
      const short = Math.min(shape.width, shape.depth);
      if (short < 2) break;
      if (Math.abs(long / short / target - 1) <= 0.003) return { house: synced, warnings: [] };
      const wanted = option.long ? other * target : other / target;
      delta += outward * (wanted - current);
    }
  }
  return {
    house,
    warnings: [{
      id: "proportion-room",
      severity: "warn",
      code: "proportion.room",
      message: "No single wall of that room can move to reach that shape without running into another room.",
      target: { type: "room", id: roomId },
    }],
  };
}

function nearestRoom(rooms, point) {
  let best = null;
  let bestDist = Infinity;
  for (const room of rooms || []) {
    const box = roomBox(room);
    const dist = Math.hypot((box.x0 + box.x1) / 2 - point.x, (box.y0 + box.y1) / 2 - point.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = room;
    }
  }
  return best;
}

/** The wall along one side of a room's inside box ("x0", "x1", "y0", or "y1") that covers that side. */
function wallOnSide(house, box, side) {
  const axis = side[0];
  const edge = box[side];
  const [lo, hi] = axis === "x" ? [box.y0, box.y1] : [box.x0, box.x1];
  let best = null;
  let bestScore = -Infinity;
  for (const wall of house.walls) {
    const dx = Math.abs(wall.end.x - wall.start.x);
    const dy = Math.abs(wall.end.y - wall.start.y);
    const along = axis === "x" ? dy >= dx * 4 : dx >= dy * 4;
    if (!along) continue;
    const mid = axis === "x" ? (wall.start.x + wall.end.x) / 2 : (wall.start.y + wall.end.y) / 2;
    if (Math.abs(mid - edge) > (Number(wall.thickness) || 0.5) / 2 + 0.25) continue;
    const a = axis === "x" ? Math.min(wall.start.y, wall.end.y) : Math.min(wall.start.x, wall.end.x);
    const b = axis === "x" ? Math.max(wall.start.y, wall.end.y) : Math.max(wall.start.x, wall.end.x);
    const overlap = Math.min(b, hi) - Math.max(a, lo);
    if (overlap < (hi - lo) * 0.6) continue;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = wall;
    }
  }
  return best;
}

export function footprintMatch(house, custom = []) {
  const width = Number(house?.footprint?.width);
  const depth = Number(house?.footprint?.depth);
  if (!(width > 0) || !(depth > 0)) return null;
  const constraint = (house.constraints || []).find((item) => item.targetId === FOOTPRINT_WIDTH || item.targetId === FOOTPRINT_DEPTH);
  if (constraint) return constraintReadout(house, constraint, custom);
  const match = roomProportion({ polygon: [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ] }, custom);
  return { phrase: match.phrase, match: match.match };
}
