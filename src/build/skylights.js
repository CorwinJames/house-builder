/**
 * Skylights: glass in the roof over a room. Stored in `house.skylights` as
 * { id, x, y, width, depth, rotation?, roomId? }: the middle of the opening on
 * the plan, its size in feet (width across, depth along), and a turn in degrees.
 * No DOM.
 */
import { furnitureFootprint } from "./annotations.js";
import { pointInPolygon } from "../lib/geom.js";

/** Common rough openings, rounded to the foot (a "2 × 4" is about 22½ × 46½ in). */
export const SKYLIGHT_SIZES = [
  { id: "2x2", label: "2 × 2 ft", width: 2, depth: 2 },
  { id: "2x4", label: "2 × 4 ft", width: 2, depth: 4 },
  { id: "4x4", label: "4 × 4 ft", width: 4, depth: 4 },
  { id: "4x6", label: "4 × 6 ft", width: 4, depth: 6 },
];

export function skylightSize(id) {
  return SKYLIGHT_SIZES.find((item) => item.id === id) || SKYLIGHT_SIZES[1];
}

/** The four corners of the opening on the plan. */
export function skylightFootprint(item) {
  return furnitureFootprint(item);
}

/** The room under a point, if any (roofed rooms first). */
export function roomUnder(house, point) {
  const rooms = (house.rooms || []).filter((room) => room.polygon?.length >= 3 && pointInPolygon(point, room.polygon));
  return rooms.find((room) => room.areaKind !== "site" && room.areaKind !== "study") || null;
}

export function makeSkylight(house, point, sizeId, id) {
  const size = skylightSize(sizeId);
  const room = roomUnder(house, point);
  return {
    id,
    x: Math.round(point.x * 4) / 4,
    y: Math.round(point.y * 4) / 4,
    width: size.width,
    depth: size.depth,
    rotation: 0,
    ...(room ? { roomId: room.id } : {}),
  };
}

/** Height of the ceiling the skylights sit in (the roof plate height). */
export function ceilingHeight(house) {
  return Number(house?.roof?.plateHeight) || Number(house?.levels?.[0]?.plateHeight) || 10;
}
