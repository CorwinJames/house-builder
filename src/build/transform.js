/**
 * Design-software moves for a selection: rotate, flip, nudge, and duplicate.
 * No DOM.
 *
 * A selection is the editor's list of picks ({ type, id }). It is expanded
 * into everything that should travel together (`selectionSet`):
 * - a room brings the walls around it and what sits inside it: furniture and
 *   scale figures, skylights, labels, site marks, and the outlets, lights,
 *   and fixtures on its walls or inside it;
 * - a wall brings its doors and windows (they are stored by offset along the
 *   wall, so they follow without changes) and anything mounted on it;
 * - loose pieces (furniture, skylights, labels, site marks, columns,
 *   fixtures, devices) come on their own. Columns on a chosen room's edge
 *   (a veranda's posts) come with the room.
 *
 * Angles are degrees, counter-clockwise, with plan +y north, so a positive
 * angle turns things counter-clockwise on the north-up plan.
 */
import { cloneHouse, splitWall } from "./walls.js";
import { wallsTouchingRoom } from "./tidy.js";
import { pointInPolygon, wallLength } from "../lib/geom.js";
import { furnitureFootprint } from "./annotations.js";
import { detachWalls, withJoins } from "./clips.js";
import { refreshSkylight } from "./skylights.js";
import { areaKind } from "./areas.js";

const PIECE_KEYS = { furniture: "furniture", siteFeature: "siteFeatures", planLabel: "planLabels", skylight: "skylights", column: "columns" };

/**
 * The walls around a room: the old rule (the wall's middle sits by the room
 * outline), plus any wall that runs along one of the room's edges, so a long
 * outside wall shared by several rooms is found from each of them.
 */
export function roomWallIds(house, room) {
  const ids = new Set(wallsTouchingRoom(house, room));
  const polygon = room?.polygon || [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const elen = Math.hypot(ex, ey) || 1;
    for (const wall of house.walls || []) {
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const len = Math.hypot(dx, dy) || 1;
      if (Math.abs((ex * dy - ey * dx) / (elen * len)) > 0.05) continue;
      const t = ((mid.x - wall.start.x) * dx + (mid.y - wall.start.y) * dy) / (len * len);
      if (t < 0 || t > 1) continue;
      const off = Math.abs((mid.x - wall.start.x) * dy - (mid.y - wall.start.y) * dx) / len;
      if (off <= (Number(wall.thickness) || 0.5) / 2 + 0.6) ids.add(wall.id);
    }
  }
  return [...ids];
}

/** Rooms that are pieces of their own (a study outline, a garden): moved by their polygon, not walls. */
function looseRoom(room) {
  const kind = areaKind(room || {});
  return kind === "study" || kind === "site";
}

export function selectionSet(house, picks) {
  const walls = new Set();
  const rooms = new Set();
  const pieces = new Map(); // "type:id" -> { type, id }
  const devices = new Set();
  const fixtures = new Set();
  const polygons = [];
  const addPiece = (type, id) => pieces.set(`${type}:${id}`, { type, id });
  for (const pick of picks || []) {
    if (pick.type === "wall") walls.add(pick.id);
    else if (pick.type === "room") {
      const room = (house.rooms || []).find((item) => item.id === pick.id);
      if (!room) continue;
      rooms.add(room.id);
      if (!looseRoom(room)) for (const id of roomWallIds(house, room)) walls.add(id);
      if (room.polygon?.length >= 3) polygons.push(room.polygon);
    } else if (PIECE_KEYS[pick.type]) addPiece(pick.type, pick.id);
    else if (pick.type === "device") devices.add(pick.id);
    else if (pick.type === "fixture") fixtures.add(pick.id);
  }
  const inside = (point) => point && polygons.some((polygon) => pointInPolygon(point, polygon));
  const onEdge = (point, tol) => point && polygons.some((polygon) => polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)) <= tol;
  }));
  // What sits inside the chosen rooms.
  for (const [type, key] of Object.entries(PIECE_KEYS)) {
    for (const item of house[key] || []) {
      if (inside(item) || (type === "column" && onEdge(item, (Number(item.size) || 0.75) / 2 + 0.75))) addPiece(type, item.id);
    }
  }
  // Rooms drawn inside a chosen room (a closet outline, a rug) come along too.
  for (const room of house.rooms || []) {
    if (rooms.has(room.id) || !room.polygon?.length) continue;
    if (room.polygon.every((point) => polygons.some((polygon) => pointInPolygon(point, polygon)))) rooms.add(room.id);
  }
  // Outlets and fixtures that belong to a chosen room (or sit on a chosen wall with no room).
  // Ones on a shared wall's far face still ride along with that wall; they just aren't counted here.
  const belongs = (item) => (item.roomId ? rooms.has(item.roomId) || (!rooms.size && walls.has(item.wallId)) : true);
  for (const device of house.electrical?.devices || []) {
    if (((device.wallId && walls.has(device.wallId)) || (!device.wallId && inside(device))) && belongs(device)) devices.add(device.id);
  }
  for (const fixture of house.plumbing?.fixtures || []) {
    if (((fixture.wallId && walls.has(fixture.wallId)) || (!fixture.wallId && inside(fixture))) && belongs(fixture)) fixtures.add(fixture.id);
  }
  return { walls, rooms, pieces: [...pieces.values()], devices, fixtures };
}

export function isEmptySet(set) {
  return !set || (!set.walls.size && !set.rooms.size && !set.pieces.length && !set.devices.size && !set.fixtures.size);
}

/** Every point the selection is drawn with, for its bounding box. */
function setPoints(house, set) {
  const points = [];
  for (const wall of house.walls || []) {
    if (!set.walls.has(wall.id)) continue;
    const half = (Number(wall.thickness) || 0) / 2;
    for (const p of [wall.start, wall.end]) {
      points.push({ x: p.x - half, y: p.y - half }, { x: p.x + half, y: p.y + half });
    }
  }
  for (const room of house.rooms || []) if (set.rooms.has(room.id)) points.push(...(room.polygon || []));
  for (const piece of set.pieces) {
    const item = (house[PIECE_KEYS[piece.type]] || []).find((entry) => entry.id === piece.id);
    if (!item) continue;
    if (piece.type === "furniture" || piece.type === "skylight") points.push(...furnitureFootprint(item));
    else points.push({ x: item.x, y: item.y });
  }
  for (const device of house.electrical?.devices || []) if (set.devices.has(device.id)) points.push({ x: device.x, y: device.y });
  for (const fixture of house.plumbing?.fixtures || []) if (set.fixtures.has(fixture.id)) points.push({ x: fixture.x, y: fixture.y });
  return points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
}

export function selectionBounds(house, set) {
  const points = setPoints(house, set);
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  return { ...box, cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, width: box.x1 - box.x0, depth: box.y1 - box.y0 };
}

const clean = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Move every point of the selection through `map(point) -> point`. `turn` is
 * how a stored angle changes (degrees in -> degrees out). `mirror` flips door
 * swings, since a mirror image swings the other way.
 */
export function mapSelection(house, set, map, { turn = (deg) => deg, mirror = false, detach = true } = {}) {
  const next = cloneHouse(house);
  withJoins(next);
  // Pull the selection off walls it doesn't include, so neighbours don't get dragged askew.
  const detached = detach ? detachWalls(next, [...set.walls]) : 0;
  const move = (p) => {
    const q = map(p);
    return { x: clean(q.x), y: clean(q.y) };
  };
  for (const wall of next.walls) {
    if (!set.walls.has(wall.id)) continue;
    wall.start = move(wall.start);
    wall.end = move(wall.end);
  }
  if (mirror) {
    for (const opening of next.openings || []) {
      if (!set.walls.has(opening.wallId) || !opening.swingSide) continue;
      opening.swingSide = opening.swingSide === "left" ? "right" : "left";
    }
  }
  for (const room of next.rooms || []) {
    if (!set.rooms.has(room.id)) continue;
    room.polygon = (room.polygon || []).map(move);
    if (mirror) room.polygon.reverse();
    if (room.labelAt) room.labelAt = move(room.labelAt);
  }
  for (const piece of set.pieces) {
    const item = (next[PIECE_KEYS[piece.type]] || []).find((entry) => entry.id === piece.id);
    if (!item) continue;
    Object.assign(item, move(item));
    if (piece.type === "furniture") item.rotation = clean(((turn(item.rotation || 0) % 360) + 360) % 360);
  }
  for (const device of next.electrical?.devices || []) {
    if (set.devices.has(device.id) && Number.isFinite(device.x)) Object.assign(device, move(device));
  }
  for (const fixture of next.plumbing?.fixtures || []) {
    if (set.fixtures.has(fixture.id) && Number.isFinite(fixture.x)) Object.assign(fixture, move(fixture));
  }
  // A quarter turn swings each moved building's ridge the other way.
  const quarter = Math.abs(Math.sin((turn(0) * Math.PI) / 180)) > 0.99 && !mirror;
  if (quarter && next.buildings) {
    const moved = new Set((next.rooms || []).filter((room) => set.rooms.has(room.id) && room.building).map((room) => room.building));
    for (const id of moved) {
      const entry = next.buildings[id];
      if (!entry?.ridge || entry.ridge === "auto") continue;
      entry.ridge = entry.ridge === "north-south" ? "east-west" : "north-south";
    }
  }
  // Skylights take their size and turn from the roof face they end up under.
  for (const item of next.skylights || []) refreshSkylight(next, item);
  return { house: next, detached };
}

export function rotatePoint(p, center, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Turn the selection about `center` (its middle by default). Positive is counter-clockwise. */
export function rotateSelection(house, set, degrees, center = null, options = {}) {
  const box = selectionBounds(house, set);
  const pivot = center || (box ? { x: box.cx, y: box.cy } : { x: 0, y: 0 });
  return mapSelection(house, set, (p) => rotatePoint(p, pivot, degrees), { ...options, turn: (deg) => deg + degrees });
}

/** Flip left-right ("horizontal") or top-bottom ("vertical") about the selection's middle. */
export function flipSelection(house, set, axis, options = {}) {
  const box = selectionBounds(house, set);
  if (!box) return { house, detached: 0 };
  const horizontal = axis === "horizontal";
  const map = (p) => (horizontal ? { x: 2 * box.cx - p.x, y: p.y } : { x: p.x, y: 2 * box.cy - p.y });
  return mapSelection(house, set, map, { ...options, mirror: true, turn: (deg) => (horizontal ? 180 - deg : -deg) });
}

export function nudgeSelection(house, set, dx, dy, options = {}) {
  return mapSelection(house, set, (p) => ({ x: p.x + dx, y: p.y + dy }), options);
}

/**
 * Copy the selection, shifted by (dx, dy): new walls with their doors and
 * windows, rooms (named "… copy"), contents, and the clips between copied
 * walls. Returns the new house and the picks for the copies.
 */
export function duplicateSelection(house, set, dx, dy, makeId) {
  const next = cloneHouse(house);
  withJoins(next);
  const shift = (p) => ({ x: clean(p.x + dx), y: clean(p.y + dy) });
  const wallIds = new Map();
  const picks = [];
  for (const wall of house.walls || []) {
    if (!set.walls.has(wall.id)) continue;
    const id = makeId("wall");
    wallIds.set(wall.id, id);
    next.walls.push({ ...structuredClone(wall), id, start: shift(wall.start), end: shift(wall.end) });
    picks.push({ type: "wall", id });
  }
  for (const opening of house.openings || []) {
    if (!wallIds.has(opening.wallId)) continue;
    next.openings.push({ ...structuredClone(opening), id: makeId(opening.type || "opening"), wallId: wallIds.get(opening.wallId) });
  }
  for (const group of house.joins || []) {
    const ends = group.ends.filter((ref) => wallIds.has(ref.wall));
    if (ends.length < 2) continue;
    next.joins.push({ id: makeId("join"), ends: ends.map((ref) => ({ wall: wallIds.get(ref.wall), end: ref.end })) });
  }
  // Copied rooms of a named building make a new building with the same roof settings.
  const buildingIds = new Map();
  const copyBuilding = (id) => {
    if (!id || id === "main") return id;
    if (!buildingIds.has(id)) {
      const fresh = makeId("building");
      buildingIds.set(id, fresh);
      if (house.buildings?.[id]) next.buildings = { ...(next.buildings || {}), [fresh]: structuredClone(house.buildings[id]) };
    }
    return buildingIds.get(id);
  };
  for (const room of house.rooms || []) {
    if (!set.rooms.has(room.id)) continue;
    const id = makeId("room");
    const copy = { ...structuredClone(room), id, name: `${room.name || "Room"} copy`, polygon: (room.polygon || []).map(shift) };
    if (room.building) copy.building = copyBuilding(room.building);
    if (room.labelAt) copy.labelAt = shift(room.labelAt);
    next.rooms.push(copy);
    picks.push({ type: "room", id });
  }
  for (const piece of set.pieces) {
    const key = PIECE_KEYS[piece.type];
    const item = (house[key] || []).find((entry) => entry.id === piece.id);
    if (!item) continue;
    const copy = { ...structuredClone(item), id: makeId(piece.type === "planLabel" ? "label" : piece.type), ...shift(item) };
    if (piece.type === "column" && item.building && buildingIds.has(item.building)) copy.building = buildingIds.get(item.building);
    next[key] = [...(next[key] || []), copy];
    if (piece.type === "skylight") refreshSkylight(next, copy);
    picks.push({ type: piece.type, id: copy.id });
  }
  const copyMounted = (list, chosen, prefix) => {
    for (const item of list || []) {
      if (!chosen.has(item.id)) continue;
      const copy = { ...structuredClone(item), id: makeId(prefix) };
      if (Number.isFinite(item.x)) Object.assign(copy, shift(item));
      if (item.wallId) {
        if (!wallIds.has(item.wallId)) continue;
        copy.wallId = wallIds.get(item.wallId);
      }
      list.push(copy);
    }
  };
  if (next.electrical?.devices) copyMounted(next.electrical.devices, set.devices, "device");
  if (next.plumbing?.fixtures) copyMounted(next.plumbing.fixtures, set.fixtures, "fixture");
  return { house: next, picks };
}

/**
 * Shift what travels with a set of walls being dragged: the rooms' outlines
 * and labels, the pieces inside, and loose (not wall-mounted) devices and
 * fixtures. The walls themselves are moved by translateWalls.
 */
export function shiftContents(house, set, dx, dy) {
  if (!set || (!dx && !dy)) return house;
  const next = cloneHouse(house);
  const shift = (p) => ({ x: clean(p.x + dx), y: clean(p.y + dy) });
  for (const room of next.rooms || []) {
    if (!set.rooms.has(room.id)) continue;
    room.polygon = (room.polygon || []).map(shift);
    if (room.labelAt) room.labelAt = shift(room.labelAt);
  }
  for (const piece of set.pieces) {
    const item = (next[PIECE_KEYS[piece.type]] || []).find((entry) => entry.id === piece.id);
    if (item) Object.assign(item, shift(item));
  }
  for (const device of next.electrical?.devices || []) {
    if (set.devices.has(device.id) && Number.isFinite(device.x)) Object.assign(device, shift(device));
  }
  for (const fixture of next.plumbing?.fixtures || []) {
    if (set.fixtures.has(fixture.id) && Number.isFinite(fixture.x)) Object.assign(fixture, shift(fixture));
  }
  for (const item of next.skylights || []) refreshSkylight(next, item);
  return next;
}

/**
 * Before moving or turning rooms on their own: a wall the room shares with a
 * neighbour (one long south wall under two rooms) is cut where the
 * neighbour's wall tees into it, so only the room's own stretch goes along
 * and the neighbour keeps the rest. Returns a new house (or the same one when
 * nothing needed cutting) and how many cuts were made. Wall ids that existed
 * stay on the piece that starts where the wall started.
 */
export function separateSelection(house, picks) {
  const rooms = (picks || [])
    .filter((pick) => pick.type === "room")
    .map((pick) => (house.rooms || []).find((room) => room.id === pick.id))
    .filter((room) => room && !looseRoom(room) && room.polygon?.length >= 3);
  if (!rooms.length) return { house, cuts: 0 };
  const polygons = rooms.map((room) => room.polygon);
  // A stretch of wall belongs to a room when its middle lies alongside one of the room's edges.
  const nearRooms = (point, half = 0.5) => polygons.some((polygon) => polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    if (len2 < 1e-8) return false;
    const t = ((point.x - a.x) * ex + (point.y - a.y) * ey) / len2;
    if (t < -0.02 || t > 1.02) return false;
    return Math.abs((point.x - a.x) * ey - (point.y - a.y) * ex) / Math.sqrt(len2) <= half + 0.6;
  }));
  const candidates = new Set(rooms.flatMap((room) => roomWallIds(house, room)));
  let next = null;
  let cuts = 0;
  for (const id of candidates) {
    const doc = next || house;
    const wall = doc.walls.find((item) => item.id === id);
    if (!wall) continue;
    const length = wallLength(wall);
    const ux = (wall.end.x - wall.start.x) / (length || 1);
    const uy = (wall.end.y - wall.start.y) / (length || 1);
    // Where other walls' ends land along this wall's middle.
    const tees = [];
    for (const other of doc.walls) {
      if (other.id === id) continue;
      for (const point of [other.start, other.end]) {
        const along = (point.x - wall.start.x) * ux + (point.y - wall.start.y) * uy;
        const off = Math.abs((point.x - wall.start.x) * -uy + (point.y - wall.start.y) * ux);
        // A wall that tees in usually stops at this wall's face, half its thickness off the middle.
        if (off < (Number(wall.thickness) || 0) / 2 + 0.1 && along > 0.25 && along < length - 0.25) tees.push(along);
      }
    }
    const cutsHere = [...new Set(tees.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
    if (!cutsHere.length) continue;
    // Cut only where a stretch that belongs to the chosen rooms meets one that doesn't.
    const stops = [0, ...cutsHere, length];
    const near = stops.slice(1).map((end, index) => {
      const mid = (stops[index] + end) / 2;
      return nearRooms({ x: wall.start.x + ux * mid, y: wall.start.y + uy * mid }, (Number(wall.thickness) || 0.5) / 2);
    });
    // The short bit where a wall runs past a corner goes with the stretch beside it.
    const lastIndex = near.length - 1;
    if (near.length > 1 && stops[1] - stops[0] < 1.6) near[0] = near[1];
    if (near.length > 1 && stops[lastIndex + 1] - stops[lastIndex] < 1.6) near[lastIndex] = near[lastIndex - 1];
    const boundaries = cutsHere.filter((_, index) => near[index] !== near[index + 1]);
    if (!boundaries.length) continue;
    if (!next) {
      next = cloneHouse(house);
      withJoins(next);
    }
    // Cut from the far end back, so the original id keeps the first stretch.
    for (const distance of [...boundaries].reverse()) {
      const made = splitWall(next, id, distance);
      if (!made) continue;
      cuts += 1;
      for (const item of [...(next.electrical?.devices || []), ...(next.plumbing?.fixtures || [])]) {
        if (item.wallId !== id || !(item.offset >= distance)) continue;
        item.wallId = made.born.id;
        item.offset -= distance;
      }
    }
  }
  return { house: next || house, cuts };
}
