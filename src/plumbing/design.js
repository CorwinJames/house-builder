import { wallLength } from "../lib/geom.js";

/**
 * Drainage fixture units and minimum trap size, private column of UPC Table 702.1.
 * A kitchen sink "with or without" a dishwasher already includes that dishwasher.
 * Confirm the cells against the 2021 UPC adopted by WAC 51-56.
 */
export const FIXTURES = {
  "kitchen-sink": { name: "Kitchen sink", dfu: 2, trap: 1.5, cold: 1, hot: 1, total: 1.5, mount: "wall", inset: 0.2, needs: "both" },
  dishwasher: { name: "Dishwasher", dfu: 2, trap: 1.5, cold: 0, hot: 1.5, total: 1.5, mount: "wall", inset: 0.2, needs: "hot", independent: true },
  toilet: { name: "Toilet", dfu: 3, trap: 3, cold: 2.5, hot: 0, total: 2.5, mount: "floor", inset: 1, needs: "cold", waterCloset: true },
  lavatory: { name: "Bathroom lavatory", dfu: 1, trap: 1.25, cold: 0.5, hot: 0.5, total: 1, mount: "wall", inset: 0.2, needs: "both" },
  shower: { name: "Shower", dfu: 2, trap: 2, cold: 1, hot: 1, total: 2, mount: "floor", inset: 1.5, needs: "both" },
  tub: { name: "Tub", dfu: 2, trap: 1.5, cold: 1, hot: 1, total: 2, mount: "floor", inset: 1.25, needs: "both" },
  washer: { name: "Clothes washer", dfu: 3, trap: 2, cold: 1, hot: 1, total: 2, mount: "wall", inset: 0.2, needs: "both" },
  "laundry-sink": { name: "Laundry sink", dfu: 2, trap: 1.5, cold: 1, hot: 1, total: 1.5, mount: "wall", inset: 0.2, needs: "both" },
  "hose-bibb": { name: "Hose bibb", dfu: 0, trap: 0, cold: 2.5, hot: 0, total: 2.5, mount: "wall", inset: 0, needs: "cold", exterior: true },
  "water-heater": { name: "Water heater", dfu: 0, trap: 0, cold: 0, hot: 0, total: 0, mount: "floor", inset: 0.5, needs: "none", heater: true },
};

/** UPC Table 1002.2 trap-arm lengths, in feet. Confirm the cells in the adopted book. */
export const TRAP_ARM_MAX = { 1.25: 2.5, 1.5: 3.5, 2: 5, 3: 6, 4: 10 };

/** UPC Table 703.2 horizontal drainage DFU, at 1/4 in. per ft. Confirm note 4 on water closets. */
const HORIZONTAL_DFU = [
  { size: 1.25, max: 1 },
  { size: 1.5, max: 1 },
  { size: 2, max: 8 },
  { size: 3, max: 35 },
  { size: 4, max: 216 },
];

/** UPC Table 703.2 vent DFU. An individual vent is also at least half the drain and at least 1-1/4 in. */
const VENT_DFU = [
  { size: 1.25, max: 1 },
  { size: 1.5, max: 8 },
  { size: 2, max: 24 },
  { size: 3, max: 84 },
  { size: 4, max: 256 },
];

export const RULES = {
  dfu: {
    section: "UPC Table 702.1",
    text: "Private drainage fixture units and minimum trap size.",
    url: "https://www.iapmo.org/uniform-codes/upc",
    adoption: "WAC 51-56 adopts the 2021 UPC.",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  },
  drainSize: {
    section: "UPC Table 703.2",
    text: "Maximum fixture units on horizontal drainage. A water closet is not carried on a 2 in. drain.",
    url: "https://www.iapmo.org/uniform-codes/upc",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  },
  slope: {
    section: "UPC 708.1",
    text: "Horizontal drainage at not less than 1/4 in. per ft for pipe smaller than 4 in. Confirm the section number in the adopted book. Pipe 4 in. and larger may be 1/8 in. per ft where approved.",
    url: "https://www.iapmo.org/uniform-codes/upc",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  },
  trapArm: {
    section: "UPC Table 1002.2",
    text: "Maximum horizontal length of a trap arm. Confirm the cells in the adopted book.",
    url: "https://www.iapmo.org/uniform-codes/upc",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  },
  cleanout: {
    section: "UPC 707.4",
    text: "A cleanout at the upper end of a horizontal drain, and another where the run changes direction on its way out.",
    url: "https://www.iapmo.org/uniform-codes/upc",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  },
  clearance: {
    section: "UPC water-closet clearance",
    text: "15 in. from the center of a water closet to a side wall, and 24 in. clear in front. Confirm the section number (often 402.5 or 408.6) in the adopted book. The 12 in. rough-in is the common fixture dimension, not that clearance.",
    url: "https://www.iapmo.org/uniform-codes/upc",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  },
  supply: {
    section: "UPC Table 610.3 and Table 610.4",
    text: "Water supply fixture units, then pipe size from the pressure table. Branch sizes here are an assumption until Table 610.4 is confirmed for the available pressure.",
    url: "https://www.iapmo.org/uniform-codes/upc",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  },
};

export const PLACE_OPTIONS = [
  { id: "kitchen-sink", group: "Kitchen", label: "Kitchen sink" },
  { id: "dishwasher", group: "Kitchen", label: "Dishwasher" },
  { id: "toilet", group: "Bath", label: "Toilet" },
  { id: "lavatory", group: "Bath", label: "Lavatory" },
  { id: "shower", group: "Bath", label: "Shower" },
  { id: "tub", group: "Bath", label: "Tub" },
  { id: "washer", group: "Laundry", label: "Clothes washer" },
  { id: "laundry-sink", group: "Laundry", label: "Laundry sink" },
  { id: "hose-bibb", group: "Outside", label: "Hose bibb" },
  { id: "water-heater", group: "Equipment", label: "Water heater" },
  { id: "entry", group: "Equipment", label: "Water entry" },
];

export function fixtureSpec(kind) {
  return FIXTURES[kind] || FIXTURES.lavatory;
}

export function isMassWall(wall) {
  const id = wall?.assemblyId || "";
  return id.includes("hemp") || id.includes("rammed") || wall?.assembly === "hempcrete" || wall?.assembly === "rammed-earth";
}

export function drainSize(dfu, { waterClosets = 0 } = {}) {
  const row = HORIZONTAL_DFU.find((item) => dfu <= item.max + 1e-6) || HORIZONTAL_DFU[HORIZONTAL_DFU.length - 1];
  let size = row.size;
  if (waterClosets > 0 && size < 3) size = 3;
  return size;
}

export function ventSize(dfu, drain) {
  const row = VENT_DFU.find((item) => dfu <= item.max + 1e-6) || VENT_DFU[VENT_DFU.length - 1];
  const half = Math.max(1.25, drain / 2);
  return Math.max(row.size, half >= 1.5 ? 1.5 : 1.25, half > 2 ? 2 : 0);
}

export function slopeDrop(feet, size = 3) {
  const inchesPerFoot = size >= 4 ? 0.125 : 0.25;
  const inches = feet * inchesPerFoot;
  return { inchesPerFoot, inches: round2(inches), feet: round3(inches / 12) };
}

export function trapArmLimit(trap) {
  return TRAP_ARM_MAX[trap] || TRAP_ARM_MAX[1.5];
}

/**
 * Vertical pipe from the trap down to the building drain, in feet.
 * Assumption: a closet bend and drop for a toilet, and about 2 ft for a sink.
 * This is not the trap arm. The trap arm is only the horizontal run to the vent.
 */
const DRAIN_DROP = {
  toilet: 2,
  lavatory: 1.5,
  "kitchen-sink": 2,
  shower: 1.5,
  tub: 1.5,
  washer: 2.5,
  "laundry-sink": 2,
};

export function fixtureDrainDrop(kind) {
  return DRAIN_DROP[kind] ?? 1.5;
}

/** PEX-a 1/2 in. internal diameter, inches. Uponor publishes about 0.475. Confirm the submittal. */
const PEX_ID = { 0.5: 0.475, 0.75: 0.671, 1: 0.862 };

export function pipeGallons(feet, size = 0.5) {
  const id = PEX_ID[size] || PEX_ID[0.5];
  const cubicInches = Math.PI * (id / 2) ** 2 * feet * 12;
  return round3(cubicInches / 231);
}

function roleFor(room) {
  const name = room?.name || "";
  if (/bath/i.test(name)) return "bath";
  if (/kitchen/i.test(name)) return "kitchen";
  if (/laundry/i.test(name)) return "laundry";
  return "general";
}

function centroid(room) {
  const poly = room?.polygon || [];
  if (!poly.length) return { x: 0, y: 0 };
  return {
    x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
    y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
  };
}

export function nearestWall(house, point, limit = 3) {
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

function interiorWalls(house) {
  return (house.walls || []).filter((wall) => !isMassWall(wall) && wall.role !== "exterior");
}

export function wetWallFor(house, room) {
  const at = centroid(room);
  const walls = interiorWalls(house);
  let best = null;
  for (const wall of walls.length ? walls : (house.walls || [])) {
    const hit = nearestWall({ walls: [wall] }, at, 80);
    if (!hit) continue;
    if (!best || hit.distance < best.distance) best = hit;
  }
  return best?.wall || null;
}

let idCount = 1;
function nextId(prefix) {
  idCount += 1;
  return `${prefix}-${idCount}`;
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

export function suggestRoom(house, room) {
  const role = roleFor(room);
  if (role !== "bath" && role !== "kitchen" && role !== "laundry") return [];
  const wall = wetWallFor(house, room);
  if (!wall) return [];
  const length = wallLength(wall);
  const kinds = role === "bath"
    ? ["toilet", "lavatory", "shower"]
    : role === "kitchen"
      ? ["kitchen-sink", "dishwasher"]
      : ["washer", "laundry-sink"];
  const ghosts = [];
  kinds.forEach((kind, index) => {
    const spec = fixtureSpec(kind);
    const offset = Math.min(length - 0.8, Math.max(1.4, 1.6 + index * 2.2));
    const at = pointOnWall(wall, offset, wall.thickness / 2 + spec.inset, centroid(room));
    ghosts.push({
      id: nextId("ghost"),
      kind,
      name: spec.name,
      x: at.x,
      y: at.y,
      wallId: wall.id,
      offset,
      inset: spec.inset,
      roomId: room.id,
      roomRole: role,
      phase: room.phase || "phase1",
      heaterType: kind === "water-heater" ? "electric-tank" : undefined,
      chase: false,
      ghost: true,
    });
  });
  return ghosts;
}

export function suggestPlacements(house) {
  const ghosts = [];
  for (const room of house.rooms || []) {
    if (room.outdoor) continue;
    const role = roleFor(room);
    const already = (house.plumbing?.fixtures || []).some((item) => !item.ghost && item.roomId === room.id);
    if (already) continue;
    ghosts.push(...suggestRoom(house, room));
  }
  return ghosts;
}

export function fixtureFromClick(house, point, kind) {
  const spec = fixtureSpec(kind);
  const near = nearestWall(house, point, 4);
  const room = (house.rooms || []).find((item) => pointInRing(point, item.polygon || []));
  const inset = spec.inset;
  let x = point.x;
  let y = point.y;
  if (near) {
    const toward = room ? centroid(room) : point;
    const at = pointOnWall(near.wall, near.offset, near.wall.thickness / 2 + inset, toward);
    x = at.x;
    y = at.y;
  }
  return {
    id: nextId("fixture"),
    kind,
    name: spec.name,
    x,
    y,
    wallId: near?.wall.id || null,
    offset: near?.offset ?? null,
    inset,
    roomId: room?.id || null,
    roomRole: room ? roleFor(room) : "general",
    phase: near?.wall.phase || room?.phase || "phase1",
    heaterType: kind === "water-heater" ? (house.plumbing?.heaterType || "electric-tank") : undefined,
    chase: false,
    ghost: false,
  };
}

export function entryFromClick(house, point) {
  const near = nearestWall(house, point, 4);
  return {
    id: "water-entry",
    x: near?.x ?? point.x,
    y: near?.y ?? point.y,
    wallId: near?.wall.id || null,
    offset: near?.offset ?? null,
    phase: near?.wall.phase || "phase1",
  };
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    const x = ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (crosses && point.x < x) inside = !inside;
  }
  return inside;
}

export function manhattan(a, b) {
  return {
    length: round2(Math.abs(b.x - a.x) + Math.abs(b.y - a.y)),
    points: [a, { x: b.x, y: a.y }, b],
  };
}

function countedDfu(fixtures) {
  const sinkRooms = new Set(fixtures.filter((item) => item.kind === "kitchen-sink").map((item) => item.roomId));
  return fixtures.map((fixture) => {
    const spec = fixtureSpec(fixture.kind);
    if (fixture.kind === "dishwasher" && sinkRooms.has(fixture.roomId)) {
      return { ...fixture, dfu: 0, trap: spec.trap, note: "Included in the kitchen sink's Table 702.1 value when they share a room." };
    }
    return { ...fixture, dfu: spec.dfu, trap: spec.trap, waterCloset: !!spec.waterCloset };
  });
}

function groupByWall(fixtures) {
  const map = new Map();
  for (const fixture of fixtures) {
    const key = fixture.wallId || fixture.roomId || "loose";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(fixture);
  }
  return [...map.values()];
}

function connectPoints(points) {
  const path = [];
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const leg = manhattan(points[i - 1], points[i]);
    length += leg.length;
    if (!path.length) path.push(...leg.points);
    else path.push(...leg.points.slice(1));
  }
  return { length: round2(length), points: path.length ? path : points };
}

function stackPoint(house, fixtures) {
  const baths = fixtures.filter((item) => item.roomRole === "bath");
  const anchor = (baths.length ? baths : fixtures)[0];
  if (!anchor) return { x: 0, y: 0 };
  return { x: anchor.x, y: anchor.y };
}

function septicPoint(house, stack) {
  const stored = house.plumbing?.septic;
  if (stored) return { x: stored.x, y: stored.y };
  const bounds = house.phases?.phase1?.bounds;
  const y = bounds ? bounds.y0 : 0;
  return { x: stack.x, y };
}

export function laborAssumption(house) {
  const saved = house.plumbing?.labor || {};
  const num = (value, fallback) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);
  return { perFixture: num(saved.perFixture, 2), perFoot: num(saved.perFoot, 0.02) };
}

export function buildPlumbing(house, { phase = "full" } = {}) {
  const all = (house.plumbing?.fixtures || []).filter((item) => !item.ghost);
  const fixtures = countedDfu(all.filter((item) => phase === "full" || item.phase !== "future"));
  const entry = house.plumbing?.entry && (phase === "full" || house.plumbing.entry.phase !== "future")
    ? house.plumbing.entry
    : null;
  const method = house.plumbing?.supplyMethod || "manifold";
  const slope = house.plumbing?.inchesPerFoot;
  const heater = fixtures.find((item) => item.kind === "water-heater") || null;
  const drains = fixtures.filter((item) => item.dfu > 0 || (item.trap > 0 && item.kind !== "dishwasher"));
  const served = fixtures.filter((item) => item.kind !== "water-heater");
  const groups = groupByWall(drains);
  const stacks = groups.map((group) => ({ x: group[0].x, y: group[0].y, wallId: group[0].wallId }));
  const stack = stacks[0] || stackPoint(house, served);
  const septic = drains.length ? septicPoint(house, stacks[stacks.length - 1] || stack) : null;
  const supply = [];
  const origin = entry ? { x: entry.x, y: entry.y } : stack;
  const hotOrigin = heater ? { x: heater.x, y: heater.y } : origin;

  if (method === "trunk") {
    supply.push(...trunkRuns(origin, served.filter((item) => fixtureSpec(item.kind).cold > 0), "cold"));
    supply.push(...trunkRuns(hotOrigin, served.filter((item) => fixtureSpec(item.kind).hot > 0), "hot"));
  } else {
    for (const fixture of served) {
      const spec = fixtureSpec(fixture.kind);
      if (spec.cold > 0) supply.push(run(origin, fixture, "cold", 0.5));
      if (spec.hot > 0) supply.push(run(hotOrigin, fixture, "hot", 0.5));
    }
  }

  const dwv = [];
  groups.forEach((group, index) => {
    const at = stacks[index];
    const anchor = group[0];
    for (const fixture of group) {
      const leg = manhattan({ x: fixture.x, y: fixture.y }, at);
      const along = fixture.wallId && fixture.wallId === anchor.wallId && fixture.offset != null && anchor.offset != null
        ? round2(Math.abs(fixture.offset - anchor.offset))
        : leg.length;
      const developed = round2(along + fixtureDrainDrop(fixture.kind));
      dwv.push({
        fixtureId: fixture.id,
        kind: fixture.kind,
        trap: fixture.trap,
        dfu: fixture.dfu,
        size: Math.max(fixture.trap || 0, drainSize(fixture.dfu, { waterClosets: fixture.waterCloset ? 1 : 0 })),
        length: developed,
        horizontal: along,
        points: leg.points,
        trapArm: along,
      });
    }
  });
  const building = septic ? connectPoints([...stacks, septic]) : { length: 0, points: [stack, stack] };
  const totalDfu = round2(fixtures.reduce((sum, item) => sum + item.dfu, 0));
  const closets = fixtures.filter((item) => item.waterCloset).length;
  const buildingSize = drains.length ? drainSize(totalDfu, { waterClosets: closets }) : 0;
  const usedSlope = typeof slope === "number" ? slope : (buildingSize >= 4 ? 0.125 : 0.25);
  const drop = {
    inchesPerFoot: usedSlope,
    inches: round2(building.length * usedSlope),
    feet: round3((building.length * usedSlope) / 12),
  };
  const vent = {
    size: drains.length ? ventSize(totalDfu, buildingSize) : 0,
    dfu: totalDfu,
  };
  const wsfu = {
    cold: round2(served.reduce((sum, item) => sum + fixtureSpec(item.kind).cold, 0)),
    hot: round2(served.reduce((sum, item) => sum + fixtureSpec(item.kind).hot, 0)),
    total: round2(served.reduce((sum, item) => sum + fixtureSpec(item.kind).total, 0)),
  };
  return {
    fixtures,
    entry,
    heater,
    method,
    supply,
    dwv,
    stack,
    septic,
    building: { ...building, size: buildingSize, slope: drop },
    vent,
    vents: stacks.length,
    dfu: totalDfu,
    wsfu,
    cleanouts: drains.length ? 2 : 0,
  };
}

function run(from, fixture, service, size) {
  const leg = manhattan(from, { x: fixture.x, y: fixture.y });
  return {
    fixtureId: fixture.id,
    service,
    size,
    length: leg.length,
    points: leg.points,
    gallons: service === "hot" ? pipeGallons(leg.length, size) : 0,
  };
}

function trunkRuns(origin, fixtures, service) {
  const pool = fixtures.map((fixture) => ({ fixture, point: { x: fixture.x, y: fixture.y } }));
  const runs = [];
  let cursor = origin;
  let first = true;
  while (pool.length) {
    pool.sort((a, b) => (Math.abs(a.point.x - cursor.x) + Math.abs(a.point.y - cursor.y)) - (Math.abs(b.point.x - cursor.x) + Math.abs(b.point.y - cursor.y)));
    const next = pool.shift();
    const size = first ? 0.75 : 0.5;
    first = false;
    const leg = manhattan(cursor, next.point);
    runs.push({
      fixtureId: next.fixture.id,
      service,
      size,
      length: leg.length,
      points: leg.points,
      gallons: service === "hot" ? pipeGallons(leg.length, size) : 0,
      trunk: true,
    });
    cursor = next.point;
  }
  return runs;
}

export function fixtureWarnings(house, fixture, design = buildPlumbing(house)) {
  const warnings = [];
  const wall = (house.walls || []).find((item) => item.id === fixture.wallId);
  if (wall && isMassWall(wall) && fixture.kind !== "hose-bibb" && !fixture.chase) {
    warnings.push({
      message: "Supply and drain should not run inside hempcrete or rammed earth. Add a furred chase, or move this to an interior wall.",
      section: "Assumption for the plumber and the inspector",
      url: RULES.dfu.adoptionUrl,
      adoptionUrl: RULES.dfu.adoptionUrl,
    });
  }
  if (fixture.kind === "hose-bibb") {
    warnings.push({
      message: "A hose bibb penetrates the exterior wall. Use a sleeve. Confirm the frost-free detail with the plumber.",
      section: "Assumption",
      url: RULES.dfu.adoptionUrl,
      adoptionUrl: RULES.dfu.adoptionUrl,
    });
  }
  const arm = design.dwv.find((item) => item.fixtureId === fixture.id);
  if (arm && arm.trap && arm.trapArm > trapArmLimit(arm.trap) + 1e-6) {
    warnings.push({
      message: `Trap arm is ${arm.trapArm} ft. Table 1002.2 allows ${trapArmLimit(arm.trap)} ft for a ${arm.trap} in. trap.`,
      section: RULES.trapArm.section,
      url: RULES.trapArm.url,
      adoptionUrl: RULES.trapArm.adoptionUrl,
    });
  }
  if (fixture.kind === "toilet" && fixture.wallId) {
    const side = sideClearance(house, fixture);
    if (side != null && side < 1.25 - 1e-6) {
      warnings.push({
        message: `The toilet center is ${round2(side * 12)} in. from a side wall. The clearance used here is 15 in.`,
        section: RULES.clearance.section,
        url: RULES.clearance.url,
        adoptionUrl: RULES.clearance.adoptionUrl,
      });
    }
  }
  if (design.building.size && design.building.size < 4 && design.building.slope.inchesPerFoot + 1e-6 < 0.25 && design.building.length > 0) {
    warnings.push({
      message: `The building drain is sloped at ${design.building.slope.inchesPerFoot} in. per ft. Pipe smaller than 4 in. wants 1/4 in. per ft.`,
      section: RULES.slope.section,
      url: RULES.slope.url,
      adoptionUrl: RULES.slope.adoptionUrl,
    });
  }
  if (!design.vent.size && fixture.dfu > 0) {
    warnings.push({
      message: "This drain has no vent.",
      section: "UPC Chapter 9",
      url: RULES.drainSize.url,
      adoptionUrl: RULES.drainSize.adoptionUrl,
    });
  }
  return warnings;
}

export function sideClearance(house, fixture) {
  const back = (house.walls || []).find((item) => item.id === fixture.wallId);
  let best = null;
  for (const wall of house.walls || []) {
    if (wall.id === fixture.wallId) continue;
    const length = wallLength(wall);
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const cross = Math.abs(dx * (back ? back.end.y - back.start.y : 1) - dy * (back ? back.end.x - back.start.x : 0));
    if (back && cross / ((length || 1) * (wallLength(back) || 1)) < 0.4) continue;
    const hit = nearestWall({ walls: [wall] }, fixture, 8);
    if (!hit) continue;
    if (!best || hit.distance < best) best = hit.distance;
  }
  return best;
}

export function hitPlumbing(house, point, limit = 1.25) {
  const entry = house.plumbing?.entry;
  if (entry && Math.hypot(entry.x - point.x, entry.y - point.y) <= limit) {
    return { type: "entry", id: "entry", distance: Math.hypot(entry.x - point.x, entry.y - point.y) };
  }
  let best = null;
  for (const fixture of house.plumbing?.fixtures || []) {
    const distance = Math.hypot(fixture.x - point.x, fixture.y - point.y);
    if (distance > limit) continue;
    if (!best || distance < best.distance) best = { type: "fixture", id: fixture.id, distance };
  }
  return best;
}

export function linkedElectrical(house, fixture) {
  const devices = (house.electrical?.devices || []).filter((item) => !item.ghost);
  if (!fixture) return null;
  if (fixture.kind === "water-heater") {
    const kind = fixture.heaterType === "heat-pump" ? "heat-pump" : "water-heater";
    return devices.find((item) => item.kind === kind) || null;
  }
  return null;
}

export function linkedWell(house) {
  return (house.electrical?.devices || []).find((item) => !item.ghost && item.kind === "well-pump") || null;
}

const PIPE_ID = { 0.5: "pex-half", 0.75: "pex-three-quarter", 1: "pex-one" };

export function plumbingBom(house, phase = "full") {
  const design = buildPlumbing(house, { phase });
  const rows = [];
  const pipe = {};
  let elbows = 0;
  let tees = 0;
  for (const runItem of design.supply) {
    const id = PIPE_ID[runItem.size] || "pex-half";
    pipe[id] = (pipe[id] || 0) + runItem.length;
    elbows += 2;
    if (runItem.trunk) tees += 1;
  }
  if (design.method === "manifold" && design.supply.length) {
    rows.push({ id: "pex-manifold", category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "One PEX manifold at the water entry. Home-run method." });
  }
  for (const [id, feet] of Object.entries(pipe)) {
    rows.push({ id, category: "plumbing", quantity: round2(feet), unit: "foot", kind: "material", basis: "Supply length, hot and cold, Manhattan from the source plus no extra fittings length." });
  }
  if (elbows) rows.push({ id: "pex-elbow", category: "plumbing", quantity: elbows, unit: "each", kind: "material", basis: "Two elbows per supply run. Assumption." });
  if (tees) rows.push({ id: "pex-tee", category: "plumbing", quantity: tees, unit: "each", kind: "material", basis: "One tee per trunk branch. Assumption." });
  const dwv = {};
  let wyes = 0;
  for (const leg of design.dwv) {
    const id = `abs-${String(leg.size).replace(".", "-")}`;
    dwv[id] = (dwv[id] || 0) + leg.length;
    wyes += 1;
    rows.push({ id: `trap-${String(leg.trap).replace(".", "-")}`, category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: `${leg.trap} in. trap, UPC Table 702.1 minimum.` });
  }
  if (design.building.length > 0) {
    const id = `abs-${String(design.building.size).replace(".", "-")}`;
    dwv[id] = (dwv[id] || 0) + design.building.length;
  }
  for (const [id, feet] of Object.entries(dwv)) {
    if (id.startsWith("abs-")) rows.push({ id, category: "plumbing", quantity: round2(feet), unit: "foot", kind: "material", basis: "Drain and building drain length. A fixture on the stack still includes a vertical drop from the trap, so the length is not zero. That drop is an assumption. Sized from UPC Table 703.2." });
  }
  if (wyes) rows.push({ id: "dwv-wye", category: "plumbing", quantity: wyes, unit: "each", kind: "material", basis: "One wye where a fixture drain meets the stack. Assumption." });
  if (design.vent.size) {
    const vents = Math.max(1, design.vents || 1);
    rows.push({ id: `vent-${String(design.vent.size).replace(".", "-")}`, category: "plumbing", quantity: vents * 10, unit: "foot", kind: "material", basis: "One vent through the roof per wet wall, 10 ft assumed above the stack. Confirm the termination height. Combining these as a wet vent needs the plumber to check Chapter 9." });
    rows.push({ id: "vent-cap", category: "plumbing", quantity: vents, unit: "each", kind: "material", basis: "Vent termination. Assumption." });
  }
  if (design.cleanouts) rows.push({ id: "cleanout", category: "plumbing", quantity: design.cleanouts, unit: "each", kind: "material", basis: "UPC 707.4: one at the upstream end and one at the exit turn." });
  const valves = design.fixtures.filter((item) => item.kind !== "water-heater").length;
  if (valves) rows.push({ id: "shutoff", category: "plumbing", quantity: valves, unit: "each", kind: "material", basis: "One shutoff per fixture. A sink really wants hot and cold; this count is one each until a second is confirmed." });
  for (const fixture of design.fixtures) {
    const id = fixture.kind === "water-heater" && fixture.heaterType === "heat-pump" ? "fixture-hpwh" : `fixture-${fixture.kind}`;
    rows.push({ id, category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "One fixture. A basic published model where we have one. James chooses the finish." });
  }
  if (design.entry) {
    rows.push({ id: "main-shutoff", category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "Main shutoff at the water entry." });
    rows.push({ id: "pressure-tank", category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "Well pressure-tank connection. The well and the pump are stage 8. The 240V pump circuit is the stage 5 well pump when it is placed." });
  }
  const chases = design.fixtures.filter((item) => item.chase).length;
  if (chases) rows.push({ id: "stud-2x4", category: "plumbing", quantity: chases * 2, unit: "each", kind: "material", basis: "Two 2x4 studs for a furred chase so the pipe stays out of the hempcrete or rammed earth. Assumption. The stud price is the published framing stud." });
  const bibbs = design.fixtures.filter((item) => item.kind === "hose-bibb").length;
  if (bibbs) rows.push({ id: "wall-sleeve", category: "plumbing", quantity: bibbs, unit: "each", kind: "material", basis: "Sleeve where a hose bibb penetrates an exterior wall. Assumption." });
  const pipeFeet = Object.values(pipe).reduce((sum, feet) => sum + feet, 0) + Object.entries(dwv).filter(([id]) => id.startsWith("abs-")).reduce((sum, [, feet]) => sum + feet, 0);
  if (pipeFeet > 0) rows.push({ id: "pipe-hanger", category: "plumbing", quantity: Math.ceil(pipeFeet / 4), unit: "each", kind: "material", basis: "One hanger or strap per 4 ft. Spacing is an assumption. Confirm UPC support spacing." });
  rows.push({ id: "plumbing-permit", category: "plumbing", quantity: design.fixtures.length || design.entry ? 1 : 0, unit: "each", kind: "material", basis: "Jefferson County plumbing permit. The fee is stage 9 unless a county fee schedule is cited." });
  const rates = laborAssumption(house);
  const hours = round2(design.fixtures.length * rates.perFixture + pipeFeet * rates.perFoot);
  if (hours > 0) {
    rows.push({ id: "plumbing-labor", category: "labor", quantity: hours, unit: "hour", kind: "labor", wageId: "wage-plumber", basis: `Assumption you can edit: ${rates.perFixture} hours per fixture and ${rates.perFoot} hour per foot of pipe.` });
  }
  const merged = [];
  for (const row of rows) {
    const found = merged.find((item) => item.id === row.id && item.unit === row.unit);
    if (found) found.quantity = round2(found.quantity + row.quantity);
    else merged.push({ ...row });
  }
  return merged.filter((row) => row.quantity > 0);
}

export function fixtureShare(house, fixtureId) {
  const design = buildPlumbing(house, { phase: "full" });
  const fixture = design.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) return [];
  const runs = design.supply.filter((item) => item.fixtureId === fixtureId);
  const drain = design.dwv.find((item) => item.fixtureId === fixtureId);
  const rows = [];
  const pipe = {};
  for (const runItem of runs) {
    const id = PIPE_ID[runItem.size] || "pex-half";
    pipe[id] = (pipe[id] || 0) + runItem.length;
  }
  for (const [id, feet] of Object.entries(pipe)) {
    rows.push({ id, category: "plumbing", quantity: round2(feet), unit: "foot", kind: "material", basis: "This fixture's supply, hot and cold." });
  }
  if (runs.length) rows.push({ id: "pex-elbow", category: "plumbing", quantity: runs.length * 2, unit: "each", kind: "material", basis: "Two elbows on each of this fixture's supply runs. Assumption." });
  if (drain) {
    rows.push({ id: `abs-${String(drain.size).replace(".", "-")}`, category: "plumbing", quantity: drain.length, unit: "foot", kind: "material", basis: "This fixture's drain: the horizontal trap arm plus a vertical drop to the building drain. The drop is an assumption, so a fixture on the stack is not zero feet." });
    rows.push({ id: `trap-${String(drain.trap).replace(".", "-")}`, category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "This fixture's trap." });
    rows.push({ id: "dwv-wye", category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "The wye at the stack. Assumption." });
  }
  if (fixture.kind !== "water-heater") {
    rows.push({ id: "shutoff", category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "Shutoff for this fixture." });
  }
  rows.push({ id: `fixture-${fixture.kind}`, category: "plumbing", quantity: 1, unit: "each", kind: "material", basis: "The fixture. A basic model where a price is published." });
  const feet = runs.reduce((sum, item) => sum + item.length, 0) + (drain?.length || 0);
  const rates = laborAssumption(house);
  rows.push({ id: "plumbing-labor", category: "labor", quantity: round2(rates.perFixture + feet * rates.perFoot), unit: "hour", kind: "labor", wageId: "wage-plumber", basis: "This fixture's labor share. Assumption." });
  return rows.filter((row) => row.quantity > 0);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
