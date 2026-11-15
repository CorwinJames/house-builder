/**
 * Passive solar design helper. No DOM.
 *
 * What it does, for the place the house is (the real lot, or a reference place):
 * - Noon sun height on the design days: Dec 21, Mar 20, Jun 21
 *   (altitude = 90° − |latitude − declination|).
 * - For each window: which way it faces, what shades it (the roof eave above
 *   it, and its own awning), and how much of the glass is in sun at noon on
 *   each design day. A horizontal shade at height Zo sticking out P past the
 *   wall throws a shadow line at Zo − P·tan(profile angle), where
 *   tan(profile) = tan(altitude) / cos(sun azimuth − wall azimuth).
 * - The sizing rule, by climate (heating and cooling degree days):
 *     cold   (more than 6,000 HDD at 65 °F): shadow line at mid-window on Jun 21
 *     moderate                              : shadow line at the sill on Jun 21
 *     hot    (more than 2,600 CDD at 75 °F): shadow line at the sill on Mar 20
 *   and in every climate the whole window in sun at noon on Dec 21 (the
 *   shadow line stays at or above the head).
 * - From that: the range of eave depths that works for every window on a wall,
 *   and for any window the awning (height above the head and depth) that hits
 *   both targets exactly.
 * - House checks from common passive-solar rules of thumb: equator-facing glass
 *   7–12% of the heated floor (more needs thermal mass), each other side under
 *   4%, the long wall within 15° of true south (30° still works), daylight
 *   reaching 1.5–2× the window head height into a room, and solar collector
 *   tilt = latitude for hot water or latitude + 15° for space heating.
 *
 * Plan north is taken as true north. Sources are listed in SOLAR_SOURCES.
 */
import { lotLocation } from "./solar.js";
import { roofAt, roofFootprints } from "../build/roofShape.js";
import { clerestoryBox, clerestoryGeometry } from "../build/clerestory.js";
import { pointInPolygon, polygonArea } from "../lib/geom.js";

export const DESIGN_DAYS = [
  { id: "winter", label: "Dec 21", declination: -23.44 },
  { id: "equinox", label: "Mar 20", declination: 0 },
  { id: "summer", label: "Jun 21", declination: 23.44 },
];

export const SOLAR_SOURCES = {
  overhangRule: { name: "David Darling, Encyclopedia of Alternative Energy: roof overhang", url: "https://www.daviddarling.info/encyclopedia/R/AE_roof_overhang.html" },
  glazing: { name: "Green Building Advisor: Cost-effective passive solar design", url: "https://greenbuildingadvisor.com/article/cost-effective-passive-solar-design" },
  otherGlass: { name: "JLC: Practical passive solar", url: "https://www.jlconline.com/how-to/interiors/practical-passive-solar_o/" },
  orientation: { name: "NCMA TEK 06-05A: passive solar rules of thumb", url: "https://www.cmha.org/resource/tek-06-05a/" },
  orientation30: { name: "U.S. DOE: Passive solar homes", url: "https://www.energy.gov/node/1265816" },
  collectors: { name: "PM Engineer: Tilting at collectors", url: "https://www.pmmag.com/articles/94751-tilting-at-collectors" },
  daylight: { name: "ARE study guide: daylight depth and head height", url: "https://open-exam-prep.com/study-guides/are-pa/ch01-overview-environmental/natural-features-daylight" },
  climate: { name: "Open-Meteo historical weather (ERA5)", url: "https://open-meteo.com/en/docs/historical-weather-api" },
};

const COLD_HDD = 6000;
const HOT_CDD = 2600;

/** Where the sun numbers come from: the lot, else the reference place, else null. */
export function designPlace(house) {
  const lot = lotLocation(house);
  if (lot) return { lat: lot.lat, lon: lot.lon, name: "The lot", source: "lot" };
  const place = house?.solar?.place;
  if (place && Number.isFinite(place.lat) && Number.isFinite(place.lon)) return { ...place, source: "place" };
  return null;
}

/** Sun height at solar noon, degrees. */
export function noonAltitude(lat, declination) {
  return 90 - Math.abs(lat - declination);
}

/** Where the noon sun is: 180 (south) north of the tropic, 0 (north) south of it. */
export function noonAzimuth(lat, declination) {
  return lat >= declination ? 180 : 0;
}

export function noonSun(place) {
  return DESIGN_DAYS.map((day) => ({
    ...day,
    altitude: noonAltitude(place.lat, day.declination),
    azimuth: noonAzimuth(place.lat, day.declination),
  }));
}

/** cold / moderate / hot, from the stored degree days or the person's choice. */
export function climateClass(house) {
  const choice = house?.solar?.climateChoice;
  if (choice && choice !== "auto") return { kind: choice, from: "choice" };
  const climate = house?.solar?.climate;
  if (!climate || !Number.isFinite(climate.hdd65)) return { kind: "moderate", from: "default" };
  if (climate.hdd65 > COLD_HDD) return { kind: "cold", from: "data" };
  if (Number.isFinite(climate.cdd75) && climate.cdd75 > HOT_CDD) return { kind: "hot", from: "data" };
  return { kind: "moderate", from: "data" };
}

export const CLIMATE_RULES = {
  cold: { label: "Cold", summerDay: "summer", target: "middle", text: "Jun 21 noon shadow line at mid-window" },
  moderate: { label: "Moderate", summerDay: "summer", target: "sill", text: "Jun 21 noon shadow line at the sill" },
  hot: { label: "Hot", summerDay: "equinox", target: "sill", text: "Mar 20 noon shadow line at the sill" },
};

/** Degree days from daily mean temperatures in °C (heating base 65 °F, cooling base 75 °F), averaged per year. */
export function degreeDays(dailyMeansC, years) {
  let hdd = 0;
  let cdd = 0;
  for (const c of dailyMeansC) {
    if (!Number.isFinite(c)) continue;
    const f = c * 1.8 + 32;
    if (f < 65) hdd += 65 - f;
    if (f > 75) cdd += f - 75;
  }
  return { hdd65: Math.round(hdd / years), cdd75: Math.round(cdd / years) };
}

/** Which way a wall's outside faces: unit normal pointing outdoors, and its compass azimuth. */
export function wallFacing(house, wall, full = true) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / len, y: dx / len };
  const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  const probe = (Number(wall.thickness) || 0.5) / 2 + 0.6;
  // Heated rooms only: a covered patio or a garden is outdoors for the sun.
  const rooms = (house.rooms || []).filter((room) => room.polygon?.length >= 3
    && (room.areaKind || "heated") === "heated"
    && (full || room.phase !== "future"));
  const inRoom = (point) => rooms.some((room) => pointInPolygon(point, room.polygon));
  const left = inRoom({ x: mid.x + n.x * probe, y: mid.y + n.y * probe });
  const right = inRoom({ x: mid.x - n.x * probe, y: mid.y - n.y * probe });
  let sign = 1;
  if (left && !right) sign = -1;
  else if (left === right) {
    // Both or neither: the outside is the side away from the middle of the rooms.
    const c = centroidOf(rooms);
    if (c && (c.x - mid.x) * n.x + (c.y - mid.y) * n.y > 0) sign = -1;
  }
  const out = { x: n.x * sign, y: n.y * sign };
  let azimuth = (Math.atan2(out.x, out.y) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return { out, azimuth, exterior: left !== right };
}

function centroidOf(rooms) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const room of rooms) for (const p of room.polygon) { x += p.x; y += p.y; n += 1; }
  return n ? { x: x / n, y: y / n } : null;
}

/** "south", "east", "west", or "north" side for an azimuth (or the equator side for the hemisphere). */
export function sideOf(azimuth, lat = 45) {
  const equator = lat >= 0 ? 180 : 0;
  const off = Math.abs((((azimuth - equator) % 360) + 540) % 360 - 180);
  if (off <= 45) return "sun";
  if (off >= 135) return "away";
  const east = lat >= 0 ? azimuth < 180 : azimuth > 180;
  return east ? "east" : "west";
}

export function compassName(azimuth) {
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return names[Math.round(azimuth / 45) % 8];
}

/** The eave over a point on a wall: how far the roof edge sticks out past the wall face, and its height. */
export function eaveAt(house, wall, along, facing, full = false) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const half = (Number(wall.thickness) || 0.5) / 2;
  const base = { x: wall.start.x + (dx / len) * along + facing.out.x * half, y: wall.start.y + (dy / len) * along + facing.out.y * half };
  if (!roofAt(house, { x: base.x - facing.out.x * 0.01, y: base.y - facing.out.y * 0.01 }, full)) return null;
  // Step out to find the edge, then halve the step to pin it down.
  const under = (d) => !!roofAt(house, { x: base.x + facing.out.x * d, y: base.y + facing.out.y * d }, full);
  let depth = 0;
  const step = 0.25;
  while (depth < 12 && under(depth + step)) depth += step;
  let lo = depth;
  let hi = depth + step;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (under(mid)) lo = mid;
    else hi = mid;
  }
  depth = lo;
  if (depth < 0.01) return null;
  return { depth, height: Number(house.roof?.plateHeight) || 10 };
}

/** The horizontal shades over a window: its eave and its awning, as { kind, height (underside), depth }. */
export function windowShades(house, opening, wall, facing, full = false) {
  const head = (Number(opening.sill) || 0) + (Number(opening.height) || 0);
  const shades = [];
  const eave = eaveAt(house, wall, opening.offset + opening.width / 2, facing, full);
  if (eave) shades.push({ kind: "eave", height: eave.height, depth: eave.depth });
  if (opening.awning?.depth > 0) {
    shades.push({ kind: "awning", height: head + (Number(opening.awning.gap) || 0), depth: opening.awning.depth, extend: opening.awning.extend || 0 });
  }
  return shades;
}

/** Shadow line height on the wall for a profile angle (tan), from a set of shades. Infinity when none. */
export function shadowLine(shades, tanProfile) {
  let line = Infinity;
  for (const shade of shades) line = Math.min(line, shade.height - shade.depth * tanProfile);
  return line;
}

function tanProfile(day, wallAzimuth) {
  const cos = Math.cos(((day.azimuth - wallAzimuth) * Math.PI) / 180);
  if (cos <= 0.02) return null;
  return Math.tan((day.altitude * Math.PI) / 180) / cos;
}

/** Glass height for a window or a glazed door, or null for a solid door. */
function glassOf(opening) {
  if (opening.type === "window") return { sill: Number(opening.sill) || 0, height: Number(opening.height) || 0 };
  if (opening.type === "door" && (opening.style === "sliding" || opening.style === "cased" || opening.style === "folding")) return { sill: 0, height: Number(opening.height) || 0 };
  return null;
}

/**
 * One window through the year at noon: facing, shades, sun on the glass on
 * each design day, the targets, and what would meet them.
 */
export function windowSolar(house, opening, place, { full = false, climate = climateClass(house) } = {}) {
  const wall = (house.walls || []).find((item) => item.id === opening.wallId);
  const glass = glassOf(opening);
  if (!wall || !glass || !place) return null;
  const facing = wallFacing(house, wall, full);
  if (!facing.exterior) return null;
  const side = sideOf(facing.azimuth, place.lat);
  const head = glass.sill + glass.height;
  const shades = windowShades(house, opening, wall, facing, full);
  const days = noonSun(place).map((day) => {
    const tan = tanProfile(day, facing.azimuth);
    if (tan === null) return { ...day, tan: null, litShare: 0, line: null, direct: false };
    const line = shadowLine(shades, tan);
    const top = Math.min(head, line);
    const litShare = Math.max(0, Math.min(1, (top - glass.sill) / glass.height));
    return { ...day, tan, line, litShare, direct: true };
  });
  const byId = Object.fromEntries(days.map((day) => [day.id, day]));
  const rule = CLIMATE_RULES[climate.kind] || CLIMATE_RULES.moderate;
  const target = rule.target === "middle" ? glass.sill + glass.height / 2 : glass.sill;
  const summer = byId[rule.summerDay];
  const winter = byId.winter;
  const result = {
    opening,
    wall,
    facing,
    side,
    glass,
    head,
    shades,
    days,
    rule,
    target,
    winterShare: winter.litShare,
    summerShadedShare: summer.direct ? 1 - Math.max(0, Math.min(1, (Math.min(head, summer.line) - target) / (head - target || 1))) : 1,
    // Within an inch either way counts: suggestions are rounded to the inch.
    meetsWinter: !winter.direct || winter.line >= head - 1 / 12,
    meetsSummer: !summer.direct || summer.line <= target + 1 / 12,
    suggestion: null,
  };
  if (side === "sun" && summer.direct && winter.direct) {
    result.suggestion = awningFor(head, target, summer.tan, winter.tan, maxShadeHeight(house, wall));
  }
  return result;
}

/** The highest an awning's underside can go on this wall (just under the eave, at the wall top). */
function maxShadeHeight(house, wall) {
  return Number(wall.height) || Number(house.roof?.plateHeight) || 10;
}

/**
 * The awning that puts the summer shadow line exactly on the target and the
 * winter one exactly on the head: height Zo = (head·tanS − target·tanW) / (tanS − tanW),
 * depth P = (Zo − head) / tanW. If that is above the wall, it goes at the top
 * of the wall with the depth that still meets summer.
 */
export function awningFor(head, target, tanSummer, tanWinter, maxHeight) {
  if (!(tanSummer > tanWinter)) return null;
  let height = (head * tanSummer - target * tanWinter) / (tanSummer - tanWinter);
  let capped = false;
  if (height > maxHeight) {
    height = maxHeight;
    capped = true;
  }
  const depth = (height - target) / tanSummer;
  const winterLine = height - depth * tanWinter;
  return {
    gap: Math.max(0, height - head),
    depth,
    capped,
    winterShareLost: capped ? Math.max(0, head - winterLine) : 0,
  };
}

/**
 * Eave depth range (past the wall face) that keeps every sun-side window on a
 * wall in full winter sun and meets the summer rule: [min, max], or a
 * conflict with the windows that can't both be met.
 */
export function eaveRangeFor(house, place, walls, { full = false, climate = climateClass(house) } = {}) {
  const plate = Number(house.roof?.plateHeight) || 10;
  let min = 0;
  let max = Infinity;
  const limits = [];
  for (const opening of house.openings || []) {
    if (!walls.some((wall) => wall.id === opening.wallId)) continue;
    const info = windowSolar(house, { ...opening, awning: null }, place, { full, climate });
    if (!info || info.side !== "sun") continue;
    const summer = info.days.find((day) => day.id === info.rule.summerDay);
    const winter = info.days.find((day) => day.id === "winter");
    if (!summer.direct || !winter.direct) continue;
    const need = Math.max(0, (plate - info.target) / summer.tan);
    const allow = Math.max(0, (plate - info.head) / winter.tan);
    limits.push({ opening, need, allow });
    min = Math.max(min, need);
    max = Math.min(max, allow);
  }
  if (!limits.length) return null;
  return { min, max, ok: min <= max + 1e-6, limits };
}

/** Area-weighted summary for the house: glass by side, floor area, and checks. */
export function houseSolar(house, place, { full = false, phaseVisible = () => true } = {}) {
  if (!place) return null;
  const floor = (house.rooms || [])
    .filter((room) => (room.areaKind || "heated") === "heated" && phaseVisible(room.phase) && room.polygon?.length >= 3)
    .reduce((sum, room) => sum + Math.abs(polygonArea(room.polygon)), 0);
  const glass = { sun: 0, east: 0, west: 0, away: 0 };
  const windows = [];
  for (const opening of house.openings || []) {
    const wall = (house.walls || []).find((item) => item.id === opening.wallId);
    if (!wall || !phaseVisible(wall.phase)) continue;
    const info = windowSolar(house, opening, place, { full });
    if (!info) continue;
    windows.push(info);
    glass[info.side] += opening.width * info.glass.height;
  }
  // A clerestory band counts as glass on the side it faces.
  let clerestory = null;
  if (house.roof?.clerestory) {
    const g = clerestoryGeometry(house, clerestoryBox(roofFootprints(house, full)), full);
    if (g) {
      const side = sideOf(g.face === "south" ? 180 : 0, place.lat);
      glass[side] += g.glassArea;
      clerestory = { g, side };
    }
  }
  const share = (area) => (floor > 0 ? area / floor : 0);
  // The longest outside wall decides which way the house faces.
  let longest = null;
  for (const wall of house.walls || []) {
    if (!phaseVisible(wall.phase)) continue;
    const facing = wallFacing(house, wall, full);
    if (!facing.exterior) continue;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (sideOf(facing.azimuth, place.lat) !== "sun") continue;
    if (!longest || length > longest.length) longest = { wall, length, facing };
  }
  const equator = place.lat >= 0 ? 180 : 0;
  const offSouth = longest ? Math.abs((((longest.facing.azimuth - equator) % 360) + 540) % 360 - 180) : null;
  const lat = Math.abs(place.lat);
  return {
    floor,
    glass,
    sunShare: share(glass.sun),
    eastShare: share(glass.east),
    westShare: share(glass.west),
    awayShare: share(glass.away),
    windows,
    clerestory,
    offSouth,
    collectors: {
      hotWater: lat,
      spaceHeating: lat + 15,
    },
  };
}

/** Roof pitch in inches of rise per 12 of run for an angle in degrees. */
export function pitchFor(angle) {
  return 12 * Math.tan((angle * Math.PI) / 180);
}
