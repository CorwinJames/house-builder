import { wallLength } from "../lib/geom.js";
import { deviceSpec } from "../electrical/design.js";
import { fixtureSpec } from "../plumbing/design.js";
import { pointInRing } from "./space.js";

/** A click this close to a wall snaps onto it. Farther than this, the ghost turns red and the click does not place. */
export const SNAP_FT = 8;

export function nearestWall(house, point, limit = Infinity) {
  let best = null;
  for (const wall of house.walls || []) {
    const length = wallLength(wall);
    if (length < 0.2) continue;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / (length * length);
    const clamped = Math.min(1, Math.max(0, t));
    const x = wall.start.x + dx * clamped;
    const y = wall.start.y + dy * clamped;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance > limit) continue;
    if (!best || distance < best.distance) best = { wall, offset: clamped * length, x, y, distance };
  }
  return best;
}

export function roomAt(house, point) {
  return (house.rooms || []).find((room) => pointInRing(point, room.polygon || [])) || null;
}

export function wallSideName(house, wall) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const item of house.walls || []) {
    for (const point of [item.start, item.end]) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  const dx = Math.abs(wall.end.x - wall.start.x);
  const dy = Math.abs(wall.end.y - wall.start.y);
  if (dx >= dy) return my >= (minY + maxY) / 2 ? "north" : "south";
  return mx >= (minX + maxX) / 2 ? "east" : "west";
}

function pointOnWall(wall, offset, inset, toward) {
  const length = wallLength(wall) || 1;
  const t = Math.min(1, Math.max(0, offset / length));
  const x = wall.start.x + (wall.end.x - wall.start.x) * t;
  const y = wall.start.y + (wall.end.y - wall.start.y) * t;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (toward && (toward.x - x) * nx + (toward.y - y) * ny < 0) {
    nx *= -1;
    ny *= -1;
  }
  return { x: x + nx * inset, y: y + ny * inset };
}

function rejected(point, near, label, reason) {
  return {
    ok: false,
    x: near?.x ?? point.x,
    y: near?.y ?? point.y,
    wallId: near?.wall?.id || null,
    offset: near?.offset ?? null,
    distance: near?.distance ?? null,
    label,
    reason,
    placed: "",
    side: near?.wall ? null : null,
  };
}

/**
 * The ghost and the click both use this. A click places these x/y values
 * and no others. When ok is false, the ghost is red and the click changes nothing.
 */
export function previewPlacement(house, point, { system, kind, supply = "240" } = {}) {
  const walls = house.walls || [];
  if (system === "electrical" && kind === "panel") {
    const label = "Breaker panel";
    if (!walls.length) return rejected(point, null, label, "Draw an exterior wall first.");
    const near = nearestWall(house, point);
    const room = roomAt(house, point);
    if (!near || (!room && near.distance > SNAP_FT)) {
      return {
        ...rejected(point, near, label, "Panel must go on a wall. Move to a wall edge."),
        side: near ? wallSideName(house, near.wall) : null,
      };
    }
    const toward = room ? centroid(room) : point;
    const at = pointOnWall(near.wall, near.offset, near.wall.thickness / 2 + 0.2, toward);
    const side = wallSideName(house, near.wall);
    return {
      ok: true,
      x: at.x,
      y: at.y,
      wallId: near.wall.id,
      offset: near.offset,
      phase: near.wall.phase || "phase1",
      distance: near.distance,
      label,
      reason: "",
      side,
      placed: `Placed breaker panel on the ${side} wall.`,
    };
  }
  if (system === "electrical") {
    const spec = deviceSpec(kind, supply);
    const label = spec.name || "Device";
    if (spec.mount === "ceiling") {
      const room = roomAt(house, point);
      if (!room && !walls.length) return rejected(point, null, label, "Draw a room first.");
      if (!room) {
        const near = nearestWall(house, point);
        if (!near || near.distance > SNAP_FT) return rejected(point, near, label, "Click inside a room to place the light.");
      }
      const roomHit = room || roomAt(house, point);
      return {
        ok: true,
        x: point.x,
        y: point.y,
        wallId: null,
        offset: null,
        phase: roomHit?.phase || "phase1",
        roomId: roomHit?.id || null,
        label,
        reason: "",
        placed: `Placed ${label.toLowerCase()}.`,
      };
    }
    if (!walls.length) return rejected(point, null, label, "Draw an exterior wall first.");
    const near = nearestWall(house, point);
    const room = roomAt(house, point);
    if (!near || (!room && near.distance > SNAP_FT)) {
      return rejected(point, near, label, `${label} must go on a wall. Move to a wall edge.`);
    }
    const side = wallSideName(house, near.wall);
    return {
      ok: true,
      x: near.x,
      y: near.y,
      wallId: near.wall.id,
      offset: near.offset,
      phase: near.wall.phase || "phase1",
      distance: near.distance,
      label,
      reason: "",
      side,
      placed: `Placed ${label.toLowerCase()} on the ${side} wall.`,
    };
  }
  if (system === "plumbing" && kind === "entry") {
    const label = "Water entry";
    if (!walls.length) return rejected(point, null, label, "Draw an exterior wall first.");
    const near = nearestWall(house, point);
    const room = roomAt(house, point);
    if (!near || (!room && near.distance > SNAP_FT)) return rejected(point, near, label, "Water entry must go on a wall. Move to a wall edge.");
    const side = wallSideName(house, near.wall);
    return {
      ok: true,
      x: near.x,
      y: near.y,
      wallId: near.wall.id,
      offset: near.offset,
      phase: near.wall.phase || "phase1",
      label,
      reason: "",
      side,
      placed: `Placed water entry on the ${side} wall.`,
    };
  }
  if (system === "plumbing") {
    const spec = fixtureSpec(kind);
    const label = spec.name || "Fixture";
    if (!walls.length) return rejected(point, null, label, "Draw an exterior wall first.");
    const near = nearestWall(house, point);
    const room = roomAt(house, point);
    if (!near || (!room && near.distance > SNAP_FT)) {
      return rejected(point, near, label, `${label} must go on a wall. Move to a wall edge.`);
    }
    const inside = room || roomAt(house, { x: near.x, y: near.y });
    const toward = inside ? centroid(inside) : point;
    const at = pointOnWall(near.wall, near.offset, near.wall.thickness / 2 + (spec.inset || 0), toward);
    const side = wallSideName(house, near.wall);
    return {
      ok: true,
      x: at.x,
      y: at.y,
      wallId: near.wall.id,
      offset: near.offset,
      phase: near.wall.phase || inside?.phase || "phase1",
      roomId: inside?.id || null,
      inset: spec.inset || 0,
      label,
      reason: "",
      side,
      placed: `Placed ${label.toLowerCase()} on the ${side} wall.`,
    };
  }
  return { ok: true, x: point.x, y: point.y, label: kind || "Item", reason: "", placed: "Placed." };
}

export function suggestionNote(house) {
  if (!(house.walls || []).length) return "Draw an exterior wall first.";
  if (!(house.rooms || []).length) return "Draw a room first. Drag a rectangle with the Room tool.";
  return "";
}

function centroid(room) {
  const poly = room?.polygon || [];
  if (!poly.length) return { x: 0, y: 0 };
  return {
    x: poly.reduce((sum, item) => sum + item.x, 0) / poly.length,
    y: poly.reduce((sum, item) => sum + item.y, 0) / poly.length,
  };
}
