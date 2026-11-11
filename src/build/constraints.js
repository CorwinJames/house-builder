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

/** Move the far side of a room so its long:short box matches a named ratio. */
export function snapRoomToRatio(house, roomId, ratioId, custom = []) {
  const room = house.rooms.find((item) => item.id === roomId);
  const ratio = findRatio(ratioId, custom);
  if (!room || !ratio) return { house, warnings: [] };
  const box = roomBox(room);
  const factor = ratioValue(ratio);
  const target = factor >= 1 ? factor : 1 / factor;
  const widthLonger = box.width >= box.depth;
  const desired = (widthLonger ? box.depth : box.width) * target;
  const delta = desired - (widthLonger ? box.width : box.depth);
  const wall = widthLonger
    ? wallOnSide(house, box.x1, "x")
    : wallOnSide(house, box.y1, "y");
  if (!wall) {
    return {
      house,
      warnings: [{
        id: "proportion-room",
        severity: "warn",
        code: "proportion.room",
        message: "No wall on the far side of that room to move.",
        target: { type: "room", id: roomId },
      }],
    };
  }
  const moved = translateWall(house, wall.id, widthLonger ? delta : 0, widthLonger ? 0 : delta);
  return { house: syncRooms(moved), warnings: [] };
}

function wallOnSide(house, edge, axis) {
  let best = null;
  let bestDist = 1.25;
  for (const wall of house.walls) {
    const dx = Math.abs(wall.end.x - wall.start.x);
    const dy = Math.abs(wall.end.y - wall.start.y);
    const along = axis === "x" ? dy >= dx : dx >= dy;
    if (!along) continue;
    const mid = axis === "x" ? (wall.start.x + wall.end.x) / 2 : (wall.start.y + wall.end.y) / 2;
    const dist = Math.abs(mid - edge);
    if (dist < bestDist) {
      bestDist = dist;
      best = wall;
    }
  }
  return best;
}

export function footprintMatch(house, custom = []) {
  const constraint = (house.constraints || []).find((item) => item.targetId === FOOTPRINT_WIDTH || item.targetId === FOOTPRINT_DEPTH);
  if (constraint) return constraintReadout(house, constraint, custom);
  const aspect = Math.max(house.footprint.width, house.footprint.depth) / Math.min(house.footprint.width, house.footprint.depth);
  const match = roomProportion({ polygon: [
    { x: 0, y: 0 },
    { x: house.footprint.width, y: 0 },
    { x: house.footprint.width, y: house.footprint.depth },
    { x: 0, y: house.footprint.depth },
  ] }, custom);
  return { phrase: match.phrase, match: match.match };
}
