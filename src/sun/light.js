/**
 * Sunlight on the plan, worked out from the walls, the windows, and where the
 * sun is. No DOM. Used by the 2D plan (bright patches and shadows) and by the
 * 3D view (how much sun each room gets, for its soft bounce light).
 *
 * It is a simple model, meant to show where light lands, not to rate a design:
 * - Rooms with a roof over them are in shade, except where sun comes in.
 * - Sun comes in through glass (windows and sliding doors) and open cased
 *   openings, on walls where outside is on the sunny side and a room is on the other.
 * - The patch on the floor is the opening, from its sill to its head, pushed
 *   along the sun's direction down to the floor, then trimmed to that room.
 * - Skylights let sun in when the sun is in front of their roof face. The light
 *   comes down a straight shaft from the roof to the ceiling, so each of the
 *   shaft's four walls trims the patch twice: at its top (where it meets the
 *   roof) and at the ceiling. What gets through lands on the floor below.
 * - Walls cast shadows outside: each wall's top edge, pushed along the sun to the ground.
 * It does not follow light through a second window, bounce it, or account
 * for the roof overhang, trees, or the slope of the ground.
 */

import { pointInPolygon, polygonArea } from "../lib/geom.js";
import { skylightBuild } from "../build/skylights.js";

const DEFAULT_HEIGHT = 10;

/** Is this room under a roof? Outdoor drawing areas (site, study) are not. */
export function roofed(room) {
  return room?.areaKind !== "site" && room?.areaKind !== "study";
}

/** Can sun pass through this opening, and between which heights? */
export function glazing(opening) {
  if (!opening) return null;
  const sill = Number(opening.sill) || 0;
  const height = Number(opening.height) || 0;
  if (opening.type === "window") return { z0: sill, z1: sill + height };
  if (opening.type === "door" && (opening.style === "sliding" || opening.style === "cased")) return { z0: 0, z1: height };
  return null;
}

function roomAt(rooms, point) {
  return rooms.find((room) => room.polygon?.length >= 3 && pointInPolygon(point, room.polygon)) || null;
}

/**
 * Sun patches on the floor: one per opening that lets the sun in.
 * Each is { openingId, wallId, roomId, polygon, area } where `polygon` is the
 * untrimmed patch (the plan clips it to the room) and `area` is the part
 * inside the room, in square feet (approximate).
 */
export function sunPatches(house, sun, { wallVisible = () => true, roomVisible = () => true, full = false } = {}) {
  if (!sun?.up) return [];
  const v = sun.vector;
  const rooms = (house.rooms || []).filter((room) => roofed(room) && roomVisible(room));
  const patches = [];
  for (const opening of house.openings || []) {
    const glass = glazing(opening);
    if (!glass || glass.z1 <= glass.z0) continue;
    const wall = (house.walls || []).find((item) => item.id === opening.wallId);
    if (!wall || !wallVisible(wall)) continue;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const facing = nx * v.x + ny * v.y;
    if (Math.abs(facing) < 0.02) continue;
    const sunSide = facing > 0 ? 1 : -1;
    const half = (Number(wall.thickness) || 0.5) / 2;
    const midAlong = opening.offset + opening.width / 2;
    const mid = { x: wall.start.x + ux * midAlong, y: wall.start.y + uy * midAlong };
    const probe = half + 0.6;
    const outside = { x: mid.x + nx * sunSide * probe, y: mid.y + ny * sunSide * probe };
    const inside = { x: mid.x - nx * sunSide * probe, y: mid.y - ny * sunSide * probe };
    if (roomAt(rooms, outside)) continue;
    const room = roomAt(rooms, inside);
    if (!room) continue;
    // The light leaves the inside face of the wall.
    const face = { x: -nx * sunSide * half, y: -ny * sunSide * half };
    const drop = (z) => ({ x: (-v.x / v.z) * z, y: (-v.y / v.z) * z });
    const corner = (s, z) => {
      const d = drop(z);
      return { x: wall.start.x + ux * s + face.x + d.x, y: wall.start.y + uy * s + face.y + d.y };
    };
    const a = opening.offset;
    const b = opening.offset + opening.width;
    const polygon = [corner(a, glass.z0), corner(b, glass.z0), corner(b, glass.z1), corner(a, glass.z1)];
    patches.push({
      openingId: opening.id,
      wallId: wall.id,
      roomId: room.id,
      polygon,
      area: clippedArea(polygon, room.polygon),
    });
  }
  for (const skylight of house.skylights || []) {
    const patch = skylightPatch(house, skylight, sun, rooms, full);
    if (patch) patches.push(patch);
  }
  return patches;
}

/** Ground shadows of the walls: one four-sided shape per wall. */
export function wallShadows(house, sun, { wallVisible = () => true } = {}) {
  if (!sun?.up) return [];
  const v = sun.vector;
  const out = [];
  for (const wall of house.walls || []) {
    if (!wallVisible(wall)) continue;
    const h = Number(wall.height) || DEFAULT_HEIGHT;
    const sx = (-v.x / v.z) * h;
    const sy = (-v.y / v.z) * h;
    out.push([
      { x: wall.start.x, y: wall.start.y },
      { x: wall.end.x, y: wall.end.y },
      { x: wall.end.x + sx, y: wall.end.y + sy },
      { x: wall.start.x + sx, y: wall.start.y + sy },
    ]);
  }
  return out;
}

/** How sunny each roofed room is: sunlit floor area and its share of the room. */
export function roomSun(house, patches) {
  const byRoom = new Map();
  for (const patch of patches) byRoom.set(patch.roomId, (byRoom.get(patch.roomId) || 0) + patch.area);
  return (house.rooms || []).filter(roofed).map((room) => {
    const area = Math.abs(polygonArea(room.polygon || []));
    const lit = byRoom.get(room.id) || 0;
    return { roomId: room.id, area, lit, share: area > 0 ? Math.min(1, lit / area) : 0 };
  });
}

/**
 * Area of polygon `a` inside polygon `b`, by sampling a grid. Rooms can be any
 * shape, so this stays simple; a 0.25 ft grid is plenty for a sun patch.
 */
export function clippedArea(a, b, step = 0.25) {
  if (!a?.length || !b?.length) return 0;
  const xs = a.map((point) => point.x);
  const ys = a.map((point) => point.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if ((x1 - x0) * (y1 - y0) > 40000) return 0;
  let count = 0;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      const point = { x, y };
      if (pointInPolygon(point, a) && pointInPolygon(point, b)) count += 1;
    }
  }
  return count * step * step;
}

/**
 * The floor patch under one skylight, or null when no sun gets down its shaft.
 * Worked in the skylight's own axes: u across the slope, w down it.
 */
export function skylightPatch(house, skylight, sun, rooms = (house.rooms || []).filter(roofed), full = false) {
  if (!sun?.up) return null;
  const build = skylightBuild(house, skylight, full);
  const room = roomAt(rooms, skylight);
  if (!room || !build.roof) return null;
  const v = sun.vector;
  // The sun has to be in front of the roof face to shine on the glass.
  const d = build.roof.downhill;
  const s = build.roof.slope;
  if (v.x * d.x * s + v.y * d.y * s + v.z <= 0.001) return null;
  const corners = build.footprint;
  const u = unit(corners[0], corners[1]);
  const w = unit(corners[0], corners[3]);
  const halfU = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) / 2;
  const halfW = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y) / 2;
  const k = { x: -v.x / v.z, y: -v.y / v.z };
  const ku = k.x * u.x + k.y * u.y;
  const kw = k.x * w.x + k.y * w.y;
  const H = build.ceiling;
  // Wall tops (as heights above the floor): sides are c0→c1 (−w), c1→c2 (+u), c2→c3 (+w), c3→c0 (−u).
  const top = build.shaft.sides.map((side) => H + (side.heightA + side.heightB) / 2);
  const range = (half, kk, topLow, topHigh) => ({
    lo: Math.max(-half + kk * H, -half + kk * topLow),
    hi: Math.min(half + kk * H, half + kk * topHigh),
  });
  const across = range(halfU, ku, top[3], top[1]);
  const down = range(halfW, kw, top[0], top[2]);
  if (across.hi - across.lo < 0.01 || down.hi - down.lo < 0.01) return null;
  const at = (a, b) => ({ x: skylight.x + u.x * a + w.x * b, y: skylight.y + u.y * a + w.y * b });
  const polygon = [at(across.lo, down.lo), at(across.hi, down.lo), at(across.hi, down.hi), at(across.lo, down.hi)];
  return {
    openingId: skylight.id,
    skylightId: skylight.id,
    wallId: null,
    roomId: room.id,
    polygon,
    area: clippedArea(polygon, room.polygon),
  };
}

function unit(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}
