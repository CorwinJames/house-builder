/**
 * Skylights: real deck-mounted units in the roof, with a straight light shaft
 * down through the attic to an opening in the ceiling. No DOM.
 *
 * Stored in `house.skylights` as
 *   { id, x, y, model, width, depth, rotation, roomId? }
 * x, y is the middle of the ceiling opening on the plan. `model` is a VELUX FS
 * size code. width, depth, and rotation are written from the model and the roof
 * face every time it is placed or moved (so a saved file reads on its own), but
 * the geometry below always works them out again from the model and the roof.
 *
 * How it is built (what `skylightBuild` returns, and what the cost counts):
 * - The rough opening in the roof deck is the model's published size. Its
 *   height runs down the slope, as deck-mount units are installed.
 * - The shaft is straight (vertical), so the ceiling opening is that roof
 *   opening seen from above: the same width, and its height times cos(pitch).
 * - The shaft walls are 2x4 at 16 in. on center (so R-15 batts fit), from the
 *   ceiling plane up to the roof, with R-15 batts and 2 in. R-10 XPS on the
 *   attic side (the 13+10 wood-wall path in 2021 WSEC-R Table R402.1.3, since
 *   the shaft walls are part of the thermal envelope when the attic is
 *   unconditioned) and 1/2 in. drywall inside.
 * - Rafters and ceiling joists are assumed at 24 in. on center, because the
 *   roof is not framed yet. An opening wider than one clear bay (22-1/2 in.)
 *   cuts rafters; IRC R802.9 then needs headers and trimmers. Header spans here
 *   stay under 4 ft, so a single header the size of the rafter is allowed; the
 *   trimmers are doubled full length on both sides (the safe choice when we
 *   don't know how far the header is from the trimmer's bearing).
 *
 * Product data (sizes, U-factor, pitch range) is from VELUX's FS data sheet
 * and installation instructions; see data/prices.json for the links.
 */
import { furnitureFootprint } from "./annotations.js";
import { pointInPolygon } from "../lib/geom.js";
import { roofAt } from "./roofShape.js";

/** VELUX FS (fixed, deck-mounted, laminated Low-E3 "2004" glass) sizes. Rough openings in inches. */
export const SKYLIGHT_MODELS = [
  { id: "C01", roWidth: 21, roHeight: 26.875, flashing: "EDL C06" },
  { id: "C04", roWidth: 21, roHeight: 37.875, flashing: "EDL C06" },
  { id: "C06", roWidth: 21, roHeight: 45.75, flashing: "EDL C06" },
  { id: "M02", roWidth: 30.0625, roHeight: 30, flashing: "EDL M08" },
  { id: "M04", roWidth: 30.0625, roHeight: 37.875, flashing: "EDL M08" },
  { id: "M06", roWidth: 30.0625, roHeight: 45.75, flashing: "EDL M08" },
  { id: "S06", roWidth: 44.25, roHeight: 45.75, flashing: "EDL S06" },
];

/** Published glass performance for the "2004" laminated Low-E3 glazing. */
export const SKYLIGHT_GLASS = { uFactor: 0.44, shgc: 0.26, visibleTransmittance: 0.6 };
/** 2021 WSEC-R Table R402.1.2: the most a skylight's U-factor may be. */
export const SKYLIGHT_MAX_U = 0.5;
/** Deck-mounted FS units are made for roofs between these pitches. */
export const DECK_MOUNT_PITCH = { min: 14, max: 85 };

const FRAMING_SPACING_IN = 24;
const CLEAR_BAY_IN = FRAMING_SPACING_IN - 1.5;
const SHAFT_STUD_SPACING_FT = 16 / 12;

export function skylightModel(id) {
  return SKYLIGHT_MODELS.find((item) => item.id === id) || SKYLIGHT_MODELS[2];
}

/** "C06 · 21 × 45¾ in" */
export function modelLabel(id) {
  const model = skylightModel(id);
  return `${model.id} · ${inches(model.roWidth)} × ${inches(model.roHeight)} in`;
}

/** Older skylights (before models) were plain sizes; pick the nearest model. */
function legacyModel(item) {
  if (item.model) return skylightModel(item.model);
  const w = (item.width || 2) * 12;
  const d = (item.depth || 4) * 12;
  return SKYLIGHT_MODELS.reduce((best, model) => (
    Math.hypot(model.roWidth - w, model.roHeight - d) < Math.hypot(best.roWidth - w, best.roHeight - d) ? model : best
  ));
}

/** Height of the flat ceiling the shafts start from (the roof plate height). */
export function ceilingHeight(house) {
  return Number(house?.roof?.plateHeight) || Number(house?.levels?.[0]?.plateHeight) || 10;
}

/** The roofed room under a point, if any. */
export function roomUnder(house, point) {
  const rooms = (house.rooms || []).filter((room) => room.polygon?.length >= 3 && pointInPolygon(point, room.polygon));
  return rooms.find((room) => room.areaKind !== "site" && room.areaKind !== "study") || null;
}

function fullRoofFor(item, full) {
  return full || item?.phase === "future";
}

/**
 * Plan size and turn for a model on the roof face over a point:
 * width across the slope, depth (down the slope) foreshortened by the pitch.
 */
export function skylightPlacement(house, point, modelId, full = false) {
  const model = skylightModel(modelId);
  const roof = roofAt(house, point, full);
  const cos = roof ? Math.cos(roof.angle) : 1;
  const alongX = roof ? Math.abs(roof.downhill.x) > 0.5 : false;
  return {
    model: model.id,
    width: round4(model.roWidth / 12),
    depth: round4((model.roHeight / 12) * cos),
    rotation: alongX ? 90 : 0,
  };
}

export function makeSkylight(house, point, modelId, id) {
  const at = { x: Math.round(point.x * 4) / 4, y: Math.round(point.y * 4) / 4 };
  const room = roomUnder(house, at);
  return {
    id,
    x: at.x,
    y: at.y,
    ...skylightPlacement(house, at, modelId),
    ...(room ? { roomId: room.id } : {}),
  };
}

/** Write model, size, turn, and room again after a move or a roof change. */
export function refreshSkylight(house, item) {
  const room = roomUnder(house, item);
  Object.assign(item, skylightPlacement(house, item, legacyModel(item).id, item.phase === "future"));
  if (room) item.roomId = room.id;
  else delete item.roomId;
  return item;
}

/**
 * The ceiling opening on the plan. With a house, it is worked out from the
 * model and the roof; without one, from the stored width, depth, and turn.
 */
export function skylightFootprint(item, house = null, full = false) {
  if (!house) return furnitureFootprint(item);
  const placed = skylightPlacement(house, item, legacyModel(item).id, fullRoofFor(item, full));
  return furnitureFootprint({ ...item, ...placed });
}

/**
 * Everything about one skylight as built: the roof face, the shaft, and the
 * framing, plus problems that stop it being built as drawn. Lengths in feet.
 */
export function skylightBuild(house, item, full = false) {
  const model = legacyModel(item);
  const useFull = fullRoofFor(item, full);
  const roof = roofAt(house, item, useFull);
  const ceiling = ceilingHeight(house);
  const footprint = skylightFootprint(item, house, full);
  const room = roomUnder(house, item);
  const problems = [];
  if (!room) problems.push({ code: "no-room", text: "It is not over a room with a roof." });
  if (!roof) problems.push({ code: "no-roof", text: "There is no roof over it." });
  const pitchDeg = roof ? (roof.angle * 180) / Math.PI : 0;
  if (roof && (pitchDeg < DECK_MOUNT_PITCH.min || pitchDeg > DECK_MOUNT_PITCH.max)) {
    problems.push({ code: "pitch", text: `The roof here is ${pitchDeg.toFixed(1)}°. Deck-mounted units need ${DECK_MOUNT_PITCH.min}° to ${DECK_MOUNT_PITCH.max}°.` });
  }
  if (roof && footprint.some((corner) => roofAt(house, corner, useFull)?.face !== roof.face)) {
    problems.push({ code: "crosses-roof-line", text: "It crosses a ridge or hip. Move it onto one roof face." });
  }
  if (room && footprint.some((corner) => !pointInPolygon(corner, room.polygon))) {
    problems.push({ code: "crosses-wall", text: "The ceiling opening runs past the room's walls." });
  }

  // The four shaft walls: the uphill and downhill ends, and the two sides.
  const sideOf = (a, b) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const topA = roofAt(house, a, useFull)?.height ?? ceiling;
    const topB = roofAt(house, b, useFull)?.height ?? ceiling;
    const topMid = roofAt(house, mid, useFull)?.height ?? ceiling;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const hA = Math.max(0, topA - ceiling);
    const hB = Math.max(0, topB - ceiling);
    return { a, b, length, heightA: hA, heightB: hB, heightMid: Math.max(0, topMid - ceiling), area: length * (hA + hB) / 2 };
  };
  const sides = footprint.map((corner, index) => sideOf(corner, footprint[(index + 1) % footprint.length]));
  const shaftArea = sides.reduce((sum, side) => sum + side.area, 0);
  const perimeter = sides.reduce((sum, side) => sum + side.length, 0);
  const tallest = Math.max(0, ...sides.map((side) => Math.max(side.heightA, side.heightB)));
  const shortest = Math.min(...sides.map((side) => Math.min(side.heightA, side.heightB)));

  // Shaft wall framing: studs at 16 in. on center, a bottom plate, and a top plate that follows the roof.
  let studFeet = 0;
  let studs = 0;
  for (const side of sides) {
    const count = Math.max(2, Math.ceil(side.length / SHAFT_STUD_SPACING_FT) + 1);
    studs += count;
    studFeet += count * (side.heightA + side.heightB) / 2;
  }
  const plateFeet = perimeter * 2;

  // Roof and ceiling framing around the opening (rafters and joists assumed 24 in. on center).
  const cut = Math.max(0, Math.ceil((model.roWidth - CLEAR_BAY_IN) / FRAMING_SPACING_IN - 1e-9));
  const headerSpanIn = cut ? (cut + 1) * FRAMING_SPACING_IN - 1.5 : model.roWidth;
  const headerPlies = headerSpanIn > 48 ? 2 : 1;
  const trimmerPlies = cut ? (headerSpanIn > 48 ? 2 : 2) : 0;
  const rafterLength = roof ? roof.run / Math.cos(roof.angle) : 0;
  const joistSpan = room ? spanAlong(room.polygon, item, roof?.downhill || { x: 0, y: 1 }) : 0;
  const headerFeet = (headerSpanIn / 12) * headerPlies * 2;
  const roofLumber = headerFeet + (cut ? 2 * rafterLength : 0);
  const ceilingLumber = headerFeet + (cut ? 2 * joistSpan : 0);

  return {
    id: item.id,
    model,
    room,
    roof,
    pitchDeg,
    footprint,
    ceiling,
    roughOpening: { width: model.roWidth, height: model.roHeight },
    ceilingOpening: { width: (model.roWidth) / 12, depth: footprint ? Math.hypot(footprint[3].x - footprint[0].x, footprint[3].y - footprint[0].y) : 0 },
    shaft: { sides, area: shaftArea, perimeter, tallest, shortest, studs, studFeet, plateFeet },
    framing: {
      spacingIn: FRAMING_SPACING_IN,
      raftersCut: cut,
      joistsCut: cut,
      headerSpanIn,
      headerPlies,
      trimmerPlies,
      rafterLength,
      joistSpan,
      roofLumberFeet: roofLumber,
      ceilingLumberFeet: ceilingLumber,
    },
    glass: SKYLIGHT_GLASS,
    problems,
  };
}

/** Plain-language build notes for the skylight card. */
export function skylightNotes(build) {
  const f = build.framing;
  const notes = [];
  notes.push(`VELUX FS ${build.model.id} 2004 (laminated Low-E3, U-${build.glass.uFactor}; WSEC-R allows up to U-${SKYLIGHT_MAX_U}). Rough opening ${inches(build.roughOpening.width)} × ${inches(build.roughOpening.height)} in, the long way down the slope. Flashing kit ${build.model.flashing}, for shingle or slate roofing.`);
  if (build.roof) {
    notes.push(`On the ${build.roof.face} roof face at ${build.pitchDeg.toFixed(1)}°. Shaft ${feetInches(build.shaft.shortest)} to ${feetInches(build.shaft.tallest)} tall from the ceiling to the roof surface (less the rafter depth, which isn't designed yet).`);
  }
  notes.push(f.raftersCut
    ? `Cuts ${f.raftersCut} rafter${f.raftersCut > 1 ? "s" : ""} and ${f.joistsCut} ceiling joist${f.joistsCut > 1 ? "s" : ""} (at ${f.spacingIn} in. on center). Header span ${inches(f.headerSpanIn)} in, so ${f.headerPlies === 1 ? "a single header the size of the rafter" : "doubled headers"} (IRC R802.9), with trimmers doubled full length on both sides.`
    : `Fits between rafters at ${f.spacingIn} in. on center, so no rafter is cut: block across the bay at the top and bottom of the opening, the same at the ceiling.`);
  notes.push("Shaft walls: 2x4 at 16 in. on center, R-15 batts with 2 in. R-10 XPS on the attic side (13+10, WSEC-R), 1/2 in. drywall inside. Air-seal the shaft to the ceiling and dam the attic insulation around it. Foam left exposed in an attic needs an ignition barrier unless it is listed for that use.");
  return notes;
}

/** How far the room reaches through a point along a direction (the joist span, roughly). */
function spanAlong(polygon, point, dir) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((a.x - point.x) * ey - (a.y - point.y) * ex) / denom;
    const u = ((a.x - point.x) * dir.y - (a.y - point.y) * dir.x) / denom;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : 0;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function inches(value) {
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  const sixteenths = Math.round(frac * 16);
  if (!sixteenths) return String(whole);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(sixteenths, 16);
  return `${whole}-${sixteenths / g}/${16 / g}`;
}

function feetInches(feet) {
  const total = Math.round(feet * 12);
  const ft = Math.floor(total / 12);
  const inch = total % 12;
  return inch ? `${ft} ft ${inch} in` : `${ft} ft`;
}
