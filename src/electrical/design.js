import { assemblyById } from "../build/catalog.js";
import { polygonArea, wallLength } from "../lib/geom.js";

/** Copper circular mils, NEC Chapter 9 Table 8. Confirm against the adopted book. */
export const CIRCULAR_MILS = { 14: 4110, 12: 6530, 10: 10380, 8: 16510, 6: 26240, 4: 41740 };

/**
 * NM-B is limited to the 60°C column (NEC 334.80).
 * 14, 12 and 10 AWG are also capped by NEC 240.4(D).
 * Confirm the table cells against the 2023 NEC adopted by WAC 296-46B-010.
 */
export function gaugeForAmps(amps) {
  if (amps <= 15) return 14;
  if (amps <= 20) return 12;
  if (amps <= 30) return 10;
  if (amps <= 40) return 8;
  if (amps <= 55) return 6;
  return 4;
}

export const RULES = {
  spacing: {
    section: "NEC 210.52(A)",
    text: "No point along a wall more than 6 ft from a receptacle. Wall space 2 ft or wider counts.",
    url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70",
    adoption: "WAC 296-46B-010 adopts the 2023 NEC.",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
  },
  kitchen: {
    section: "NEC 210.52(C) and 210.11(C)(1)",
    text: "Countertop wall line: no point more than 2 ft from a receptacle. At least two 20A small-appliance circuits.",
    note: "Assumption: the room has no counter polygon, so the 2 ft rule is applied to the longest wall and the 6 ft rule to the other kitchen walls. Confirm the real counter.",
    url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
  },
  bath: {
    section: "NEC 210.52(D) and 210.8(A)",
    text: "A bathroom needs a receptacle, and it must be GFCI protected.",
    url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
  },
  laundry: {
    section: "NEC 210.11(C)(2)",
    text: "At least one 20A laundry branch circuit.",
    url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
  },
  voltageDrop: {
    section: "NEC 210.19(A) Informational Note",
    text: "Branch-circuit conductors sized so the drop stays within 3 percent at the farthest outlet, and so feeder plus branch stays within 5 percent, provide reasonable efficiency of operation. Guidance, not a mandatory rule.",
    url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70",
    adoption: "WAC 296-46B-010 adopts the 2023 NEC.",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
  },
};

/** Branch-circuit guidance from NEC 210.19(A) Informational Note. Not a hard maximum. */
export const BRANCH_DROP_PERCENT = 3;

export const APPLIANCES = {
  range: { name: "Range", volts: 240, amps: 40, note: "NEC 210.19(A)(3): a household range of 8.75 kW or more needs at least 40A. Confirm the nameplate." },
  dryer: { name: "Dryer", volts: 240, amps: 30, note: "A 30A circuit is the usual dryer minimum. Confirm the nameplate. Section to verify: NEC 220.54 and 422.10." },
  ev: { name: "EV charger", volts: 240, amps: 40, note: "Assumption: 40A until the charger nameplate is known." },
  "water-heater": { name: "Water heater", volts: 240, amps: 30, note: "Assumption: 30A. Confirm the nameplate." },
  "heat-pump": { name: "Heat pump / mini-split", volts: 240, amps: 30, note: "Assumption: 30A. Confirm the nameplate." },
  "well-pump": { name: "Well pump", volts: 240, amps: 20, note: "Assumption: a 240V 20A pump. A 120V pump can use a 20A circuit instead. Confirm the nameplate." },
};

const DEVICE_DEFAULTS = {
  receptacle: { name: "Receptacle", volts: 120, amps: 0, mount: "wall", height: 1.5 },
  gfci: { name: "GFCI receptacle", volts: 120, amps: 0, mount: "wall", height: 1.5 },
  "wr-receptacle": { name: "Weather-resistant receptacle", volts: 120, amps: 0, mount: "wall", height: 1.5 },
  switch: { name: "Switch", volts: 120, amps: 0, mount: "wall", height: 4 },
  "switch-3way": { name: "3-way switch", volts: 120, amps: 0, mount: "wall", height: 4 },
  light: { name: "Light", volts: 120, amps: 0, mount: "ceiling", height: 10 },
  fan: { name: "Exhaust fan", volts: 120, amps: 0, mount: "ceiling", height: 10 },
  smoke: { name: "Smoke / CO alarm", volts: 120, amps: 0, mount: "ceiling", height: 10 },
  "wall-light": { name: "Wall light", volts: 120, amps: 0, mount: "wall", height: 5 },
};

export const CIRCUIT_COLORS = ["#C23B22", "#1F6F8B", "#2F6B3A", "#8A5A12", "#5C3D8A", "#0E6B5C", "#9C341F", "#3D4C7A", "#6B4A2A", "#245C4A"];

export const PLACE_OPTIONS = [
  { id: "receptacle", group: "120V", label: "Standard receptacle" },
  { id: "gfci", group: "120V", label: "GFCI receptacle" },
  { id: "wr-receptacle", group: "120V", label: "Weather-resistant receptacle" },
  { id: "range", group: "240V", label: "Range" },
  { id: "dryer", group: "240V", label: "Dryer" },
  { id: "ev", group: "240V", label: "EV charger" },
  { id: "water-heater", group: "240V", label: "Water heater" },
  { id: "heat-pump", group: "240V", label: "Heat pump / mini-split" },
  { id: "well-pump", group: "240V", label: "Well pump" },
  { id: "switch", group: "Controls", label: "Single-pole switch" },
  { id: "switch-3way", group: "Controls", label: "3-way switch" },
  { id: "light", group: "Controls", label: "Ceiling light" },
  { id: "wall-light", group: "Controls", label: "Wall light" },
  { id: "fan", group: "Controls", label: "Exhaust fan" },
  { id: "smoke", group: "Controls", label: "Smoke / CO alarm" },
  { id: "panel", group: "Panel", label: "Main panel" },
];

export function deviceSpec(kind, supply = "240") {
  if (APPLIANCES[kind]) {
    const spec = APPLIANCES[kind];
    if (kind === "well-pump" && supply === "120") {
      return { ...spec, volts: 120, amps: 20, mount: "wall", height: 4, note: "120V option. Confirm the pump nameplate." };
    }
    return { ...spec, mount: "wall", height: 4 };
  }
  return DEVICE_DEFAULTS[kind] || DEVICE_DEFAULTS.receptacle;
}

export function defaultWallMethod(wall) {
  const id = wall?.assemblyId || "";
  if (id.includes("hemp") || id.includes("rammed") || wall?.assembly === "hempcrete" || wall?.assembly === "rammed-earth") {
    return "conduit";
  }
  return "stud-bay";
}

export function wallMethod(house, wall) {
  return house.electrical?.wallMethods?.[wall.id] || defaultWallMethod(wall);
}

export function outletStations(length, reach) {
  if (length < 2 - 1e-6) return [];
  if (length <= reach * 2 + 1e-6) return [round2(length / 2)];
  const spots = [];
  let x = reach;
  spots.push(round2(x));
  while (length - x > reach + 1e-6) {
    const next = x + reach * 2;
    if (length - next <= reach + 1e-6) {
      spots.push(round2(length - reach));
      break;
    }
    spots.push(round2(next));
    x = next;
  }
  return spots;
}

function roomEdges(room) {
  const poly = room.polygon || [];
  const edges = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    edges.push({ a, b, length: Math.hypot(b.x - a.x, b.y - a.y) });
  }
  return edges;
}

function pointOnEdge(edge, distance) {
  const t = edge.length < 1e-6 ? 0 : distance / edge.length;
  return { x: edge.a.x + (edge.b.x - edge.a.x) * t, y: edge.a.y + (edge.b.y - edge.a.y) * t };
}

export function nearestWall(house, point, limit = 2) {
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
    if (!best || distance < best.distance) {
      best = { wall, offset: clamped * length, x, y, distance };
    }
  }
  return best;
}

function roleFor(room) {
  const name = room?.name || "";
  if (/bath/i.test(name)) return "bath";
  if (/kitchen/i.test(name)) return "kitchen";
  if (/laundry/i.test(name)) return "laundry";
  if (room?.outdoor) return "outdoor";
  return "general";
}

let idCount = 1;
function nextId(prefix) {
  idCount += 1;
  return `${prefix}-${idCount}`;
}

/**
 * Ghost receptacles for one room. Kitchen walls use a 2 ft reach.
 * A bathroom gets one GFCI. Other walls use the 6 ft rule.
 */
export function suggestRoom(house, room) {
  const role = roleFor(room);
  if (role === "outdoor") return [];
  const kind = role === "bath" || role === "kitchen" ? "gfci" : "receptacle";
  const height = role === "kitchen" ? 3.5 : 1.5;
  const devices = [];
  if (role === "bath") {
    const edge = roomEdges(room).sort((a, b) => b.length - a.length)[0];
    if (!edge) return [];
    const at = pointOnEdge(edge, edge.length / 2);
    devices.push(ghostDevice(house, room, { kind: "gfci", x: at.x, y: at.y, height, role }));
    return devices;
  }
  const edges = roomEdges(room);
  const counter = role === "kitchen"
    ? edges.reduce((best, edge) => (edge.length > best.length ? edge : best), edges[0])
    : null;
  for (const edge of edges) {
    const reach = role === "kitchen" && edge === counter ? 2 : 6;
    const stationHeight = role === "kitchen" && edge === counter ? height : role === "kitchen" ? 1.5 : height;
    for (const station of outletStations(edge.length, reach)) {
      const at = pointOnEdge(edge, station);
      devices.push(ghostDevice(house, room, { kind, x: at.x, y: at.y, height: stationHeight, role }));
    }
  }
  return devices;
}

function ghostDevice(house, room, { kind, x, y, height, role }) {
  const spec = deviceSpec(kind);
  const near = nearestWall(house, { x, y }, 2.5);
  return {
    id: nextId("ghost"),
    kind,
    name: spec.name,
    volts: spec.volts,
    amps: spec.amps,
    mount: "wall",
    height,
    x: near?.x ?? x,
    y: near?.y ?? y,
    wallId: near?.wall.id || null,
    offset: near?.offset ?? null,
    roomId: room.id,
    roomRole: role,
    phase: room.phase || "phase1",
    ghost: true,
  };
}

export function suggestPlacements(house) {
  const existing = new Set((house.electrical?.devices || []).filter((item) => !item.ghost).map((item) => `${item.roomId}:${item.roomRole || ""}`));
  const ghosts = [];
  for (const room of house.rooms || []) {
    if (room.outdoor) continue;
    const role = roleFor(room);
    if (existing.has(`${room.id}:${role}`)) continue;
    if ((house.electrical?.devices || []).some((item) => !item.ghost && item.roomId === room.id && (item.kind === "receptacle" || item.kind === "gfci"))) continue;
    ghosts.push(...suggestRoom(house, room));
  }
  return ghosts;
}

export function devicePoint(house, device) {
  if (device.wallId) {
    const wall = (house.walls || []).find((item) => item.id === device.wallId);
    if (wall) {
      const length = wallLength(wall) || 1;
      const t = Math.min(1, Math.max(0, (device.offset || 0) / length));
      return {
        x: wall.start.x + (wall.end.x - wall.start.x) * t,
        y: wall.start.y + (wall.end.y - wall.start.y) * t,
      };
    }
  }
  return { x: device.x || 0, y: device.y || 0 };
}

export function panelPoint(house) {
  const panel = house.electrical?.panel;
  if (!panel) return null;
  return devicePoint(house, panel);
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

export function roomAt(house, point) {
  return (house.rooms || []).find((room) => pointInRing(point, room.polygon || [])) || null;
}

export function deviceFromClick(house, point, kind, extra = {}) {
  const supply = extra.supply || "240";
  const spec = deviceSpec(kind, supply);
  const ceiling = spec.mount === "ceiling";
  const near = ceiling ? null : nearestWall(house, point, 4);
  const x = near?.x ?? point.x;
  const y = near?.y ?? point.y;
  const room = roomAt(house, { x, y }) || roomAt(house, point);
  return {
    id: nextId("device"),
    kind,
    name: spec.name,
    volts: spec.volts,
    amps: spec.amps,
    supply,
    mount: spec.mount,
    height: spec.height,
    x,
    y,
    wallId: near?.wall.id || null,
    offset: near?.offset ?? null,
    roomId: room?.id || null,
    roomRole: room ? roleFor(room) : "general",
    phase: near?.wall.phase || room?.phase || "phase1",
    ghost: false,
  };
}

export function applyDeviceKind(device, kind, supply = device.supply || "240") {
  const spec = deviceSpec(kind, supply);
  return {
    ...device,
    kind,
    name: spec.name,
    volts: spec.volts,
    amps: spec.amps,
    supply,
    mount: spec.mount,
    ghost: false,
  };
}

export function panelFromClick(house, point) {
  const near = nearestWall(house, point, 4);
  return {
    id: "panel-main",
    x: near?.x ?? point.x,
    y: near?.y ?? point.y,
    wallId: near?.wall.id || null,
    offset: near?.offset ?? null,
    height: 5,
    phase: near?.wall.phase || "phase1",
  };
}

export function hitElectrical(house, point, limit = 1.25) {
  const panel = panelPoint(house);
  if (panel && Math.hypot(panel.x - point.x, panel.y - point.y) <= limit) {
    return { type: "panel", id: "panel" };
  }
  let best = null;
  for (const device of house.electrical?.devices || []) {
    const at = devicePoint(house, device);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance > limit) continue;
    if (!best || distance < best.distance) best = { type: "device", id: device.id, distance };
  }
  return best;
}

export function laborAssumption(house) {
  const saved = house.electrical?.labor || {};
  const num = (value, fallback) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);
  return {
    perDevice: num(saved.perDevice, 0.75),
    panel: num(saved.panel, 2),
    perFoot: num(saved.perFoot, 0.01),
  };
}

function dropFeet(device) {
  const plate = 10;
  return Math.max(0, round2(plate - (device.height || 0)));
}

export function manhattan(a, b) {
  const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  return {
    length: round2(length),
    points: [a, { x: b.x, y: a.y }, b],
  };
}

function routeChain(panel, devices) {
  const points = devices.map((device) => ({ device, point: { x: device._x, y: device._y } }));
  const ordered = [];
  let cursor = panel;
  const pool = [...points];
  let length = 0;
  let along = 0;
  let farthest = 0;
  const segments = [];
  while (pool.length) {
    pool.sort((a, b) => (Math.abs(a.point.x - cursor.x) + Math.abs(a.point.y - cursor.y)) - (Math.abs(b.point.x - cursor.x) + Math.abs(b.point.y - cursor.y)));
    const next = pool.shift();
    const leg = manhattan(cursor, next.point);
    const drop = dropFeet(next.device);
    along += leg.length;
    farthest = Math.max(farthest, along + drop);
    length += leg.length + drop;
    segments.push({ ...leg, deviceId: next.device.id, drop });
    ordered.push(next.device);
    cursor = next.point;
  }
  return { length: round2(length), farthest: round2(farthest), segments, devices: ordered };
}

function chunk(items, size) {
  const groups = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/**
 * Keep each group under the 3 percent branch-circuit guidance when a panel is present.
 * A device that is already over 3 percent on its own stays on its own circuit so the warning can show.
 */
function packByDrop(items, spec, origin, limit) {
  const pool = [...items];
  const groups = [];
  const gauge = gaugeForAmps(spec.amps);
  while (pool.length) {
    pool.sort((a, b) => (Math.abs(a._x - origin.x) + Math.abs(a._y - origin.y)) - (Math.abs(b._x - origin.x) + Math.abs(b._y - origin.y)));
    const group = [pool.shift()];
    while (pool.length && group.length < limit) {
      let best = 0;
      let bestDrop = Infinity;
      for (let i = 0; i < pool.length; i += 1) {
        const trial = routeChain(origin, [...group, pool[i]]);
        const drop = voltageDrop(spec.amps, trial.farthest, gauge, spec.volts).percent;
        if (drop < bestDrop) {
          bestDrop = drop;
          best = i;
        }
      }
      if (bestDrop > BRANCH_DROP_PERCENT) break;
      group.push(pool.splice(best, 1)[0]);
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Group real (not ghost) devices into circuits and route each one from the panel.
 * devicesPerCircuit is an assumption, not a code maximum.
 */
export function buildElectrical(house, { phase = "full", devicesPerCircuit = 8 } = {}) {
  const all = (house.electrical?.devices || []).filter((device) => !device.ghost);
  const devices = all.filter((device) => phase === "full" || device.phase !== "future");
  const panel = house.electrical?.panel && (phase === "full" || house.electrical.panel.phase !== "future")
    ? house.electrical.panel
    : null;
  const origin = panel ? panelPoint({ ...house, electrical: { ...house.electrical, panel } }) : { x: 0, y: 0 };
  const located = devices.map((device) => ({ ...device, _x: devicePoint(house, device).x, _y: devicePoint(house, device).y }));
  const limit = house.electrical?.devicesPerCircuit || devicesPerCircuit;
  const circuits = [];
  let n = 1;
  const add = (spec, group) => {
    if (!group.length) return;
    const routed = panel ? routeChain(origin, group) : { length: 0, farthest: 0, segments: [], devices: group };
    const gauge = gaugeForAmps(spec.amps);
    const drop = voltageDrop(spec.amps, routed.farthest, gauge, spec.volts);
    circuits.push({
      id: `c${n}`,
      number: n,
      ...spec,
      gauge,
      length: routed.length,
      segments: routed.segments,
      deviceIds: routed.devices.map((device) => device.id),
      voltageDrop: drop,
      breakerPoles: spec.volts === 240 ? 2 : 1,
    });
    n += 1;
  };

  for (const device of located.filter((item) => item.volts === 240 || APPLIANCES[item.kind])) {
    const spec = deviceSpec(device.kind, device.supply);
    add({
      name: spec.name,
      volts: spec.volts,
      amps: spec.amps,
      gfci: false,
      afci: false,
      dedicated: true,
    }, [device]);
  }
  const rest = located.filter((item) => item.volts !== 240 && !APPLIANCES[item.kind]);
  const isReceptacle = (item) => ["receptacle", "gfci", "wr-receptacle"].includes(item.kind);
  const bath = rest.filter((item) => item.roomRole === "bath" && isReceptacle(item));
  const kitchen = rest.filter((item) => item.roomRole === "kitchen" && isReceptacle(item));
  const laundry = rest.filter((item) => item.roomRole === "laundry" && isReceptacle(item));
  const groupDevices = (items, spec) => (panel ? packByDrop(items, spec, origin, limit) : chunk(items, limit));
  const bathSpec = { name: "Bathroom", volts: 120, amps: 20, gfci: true, afci: false, dedicated: true };
  groupDevices(bath, bathSpec).forEach((group, index, all) => add({
    ...bathSpec,
    name: all.length > 1 ? `Bathroom ${index + 1}` : "Bathroom",
  }, group));
  const kitchenSpec = { volts: 120, amps: 20, gfci: true, afci: true, dedicated: true };
  groupDevices(kitchen, { ...kitchenSpec, name: "Kitchen" }).forEach((group, index) => add({
    ...kitchenSpec,
    name: `Kitchen small-appliance ${String.fromCharCode(65 + (index % 26))}`,
  }, group));
  const laundrySpec = { name: "Laundry", volts: 120, amps: 20, gfci: true, afci: false, dedicated: true };
  groupDevices(laundry, laundrySpec).forEach((group, index, all) => add({
    ...laundrySpec,
    name: all.length > 1 ? `Laundry ${index + 1}` : "Laundry",
  }, group));
  const dedicatedIds = new Set([...bath, ...kitchen, ...laundry].map((item) => item.id));
  const general = rest.filter((item) => !dedicatedIds.has(item.id));
  const lights = general.filter((item) => ["light", "wall-light", "fan", "smoke", "switch", "switch-3way"].includes(item.kind));
  const receptacles = general.filter((item) => !lights.includes(item));
  const receptacleSpec = { volts: 120, amps: 20, afci: true, dedicated: false };
  groupDevices(receptacles, { ...receptacleSpec, name: "Receptacles" }).forEach((group, index) => add({
    ...receptacleSpec,
    name: `Receptacles ${index + 1}`,
    gfci: group.some((item) => item.kind === "gfci" || item.kind === "wr-receptacle" || item.roomRole === "outdoor"),
  }, group));
  const lightSpec = { volts: 120, amps: 15, gfci: false, afci: true, dedicated: false };
  groupDevices(lights, { ...lightSpec, name: "Lights" }).forEach((group, index) => add({
    ...lightSpec,
    name: `Lights ${index + 1}`,
  }, group));

  const rooms = (house.rooms || []).filter((room) => !room.outdoor && (phase === "full" || room.phase !== "future"));
  const gaps = [];
  const kitchenCircuits = circuits.filter((circuit) => circuit.name.startsWith("Kitchen")).length;
  if (rooms.some((room) => roleFor(room) === "kitchen") && kitchenCircuits < 2) {
    gaps.push({
      message: "The kitchen still needs a second 20A small-appliance circuit.",
      section: "NEC 210.11(C)(1)",
      url: RULES.kitchen.url,
      adoptionUrl: RULES.kitchen.adoptionUrl,
    });
  }
  if (rooms.some((room) => roleFor(room) === "bath") && !bath.length) {
    gaps.push({
      message: "A bathroom still needs a GFCI receptacle.",
      section: "NEC 210.52(D) and 210.8(A)",
      url: RULES.bath.url,
      adoptionUrl: RULES.bath.adoptionUrl,
    });
  }
  if (rooms.some((room) => roleFor(room) === "laundry") && !laundry.length) {
    gaps.push({
      message: "A laundry room still needs its 20A circuit.",
      section: "NEC 210.11(C)(2)",
      url: RULES.laundry.url,
      adoptionUrl: RULES.laundry.adoptionUrl,
    });
  }

  return { circuits, panel, devices: located, load: loadCalc(house, phase), gaps };
}

export function voltageDrop(amps, feet, gauge, volts) {
  const cm = CIRCULAR_MILS[gauge] || CIRCULAR_MILS[12];
  const drop = (2 * 12.9 * amps * feet) / cm;
  return { volts: round2(drop), percent: round2((drop / volts) * 100) };
}

export function loadCalc(house, phase = "full") {
  const rooms = (house.rooms || []).filter((room) => !room.outdoor && (phase === "full" || room.phase !== "future"));
  const area = rooms.reduce((sum, room) => sum + polygonArea(room.polygon || []), 0);
  const general = area * 3;
  const smallAppliance = 1500 * 2;
  const laundry = 1500;
  const devices = (house.electrical?.devices || []).filter((device) => !device.ghost && (phase === "full" || device.phase !== "future"));
  const dryer = devices.some((device) => device.kind === "dryer") ? 5000 : 0;
  const range = devices.some((device) => device.kind === "range") ? 8000 : 0;
  const other = devices
    .filter((device) => ["water-heater", "heat-pump", "ev", "well-pump"].includes(device.kind))
    .reduce((sum, device) => sum + deviceSpec(device.kind, device.supply).amps * deviceSpec(device.kind, device.supply).volts, 0);
  const subtotal = general + smallAppliance + laundry + dryer + range + other;
  const demandBase = Math.min(subtotal, 3000) + Math.max(0, Math.min(subtotal, 120000) - 3000) * 0.35 + Math.max(0, subtotal - 120000) * 0.25;
  const amps = demandBase / 240;
  const steps = [
    { label: "General lighting and receptacles", detail: `${round2(area)} sq ft × 3 VA`, va: round2(general), section: "2023 NEC 220.41. Confirm the section number in the adopted book.", url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70" },
    { label: "Two small-appliance circuits", detail: "2 × 1,500 VA", va: smallAppliance, section: "2023 NEC dwelling small-appliance load, 1,500 VA each. Confirm the section (historically 220.52).", url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70" },
    { label: "Laundry circuit", detail: "1,500 VA", va: laundry, section: "2023 NEC laundry branch circuit. Confirm the section.", url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70" },
    { label: "Dryer", detail: dryer ? "5,000 VA minimum" : "None placed", va: dryer, section: "Assumption to verify: 5,000 VA minimum when a dryer is placed.", url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70" },
    { label: "Range", detail: range ? "8,000 VA assumption for one range" : "None placed", va: range, section: "Assumption to verify against NEC 220.55 Column C.", url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70" },
    { label: "Other 240V nameplate loads", detail: "Volts × amps, no demand factor", va: round2(other), section: "Assumption: no demand factor until an engineer checks Article 220.", url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70" },
    { label: "Demand factor applied to the sum", detail: "First 3,000 VA at 100%, then 35% to 120,000 VA, then 25%.", va: round2(demandBase), section: "Assumption to verify: this is the long-standing dwelling demand table. Confirm the 2023 section number.", url: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010" },
  ];
  return {
    area: round2(area),
    va: round2(demandBase),
    amps: round2(amps),
    service: recommendService(amps),
    steps,
    adoption: "WAC 296-46B-010 adopts the 2023 NEC, effective April 1, 2024.",
    adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
  };
}

export function recommendService(amps) {
  return [100, 125, 150, 200, 225, 320, 400].find((size) => size + 1e-6 >= amps) || 400;
}

export function electricalBom(house, phase = "full") {
  const design = buildElectrical(house, { phase });
  const rows = [];
  const wire = {};
  let conduit = 0;
  let fittings = 0;
  let raceway = 0;
  let racewayFittings = 0;
  let nmFeet = 0;
  for (const circuit of design.circuits) {
    const conductors = circuit.volts === 240 ? 3 : 2;
    const key = `${circuit.gauge}-${conductors}`;
    let dropNm = 0;
    let dropConduit = 0;
    let dropRaceway = 0;
    let horizontal = 0;
    for (const segment of circuit.segments) {
      horizontal += segment.length;
      const device = design.devices.find((item) => item.id === segment.deviceId);
      const wall = (house.walls || []).find((item) => item.id === device?.wallId);
      const method = wall ? wallMethod(house, wall) : "stud-bay";
      if (method === "conduit") dropConduit += segment.drop || 0;
      else if (method === "raceway") dropRaceway += segment.drop || 0;
      else dropNm += segment.drop || 0;
    }
    wire[key] = (wire[key] || 0) + horizontal + dropNm;
    nmFeet += horizontal + dropNm;
    conduit += dropConduit;
    raceway += dropRaceway;
    for (const segment of circuit.segments) {
      const device = design.devices.find((item) => item.id === segment.deviceId);
      const wall = (house.walls || []).find((item) => item.id === device?.wallId);
      const method = wall ? wallMethod(house, wall) : "stud-bay";
      if (method === "conduit" && segment.drop) fittings += 2;
      if (method === "raceway" && segment.drop) racewayFittings += 2;
    }
  }
  const wireId = {
    "14-2": "nm-14-2",
    "12-2": "nm-12-2",
    "10-2": "nm-10-2",
    "10-3": "nm-10-3",
    "8-3": "nm-8-3",
    "6-3": "nm-6-3",
    "4-3": "nm-4-3",
  };
  for (const [key, feet] of Object.entries(wire)) {
    rows.push({ id: wireId[key] || `wire-${key}`, category: "electrical", quantity: round2(feet), unit: "foot", kind: "material", basis: `${key.replace("-", "/")} from the routed circuit lengths, including the vertical drop.` });
  }
  const counts = {};
  for (const device of design.devices) counts[device.kind] = (counts[device.kind] || 0) + 1;
  const devicePrice = {
    receptacle: "device-receptacle",
    gfci: "device-gfci",
    "wr-receptacle": "device-wr",
    switch: "device-switch",
    "switch-3way": "device-switch-3way",
    light: "device-light",
    "wall-light": "device-light",
    fan: "device-fan",
    smoke: "device-smoke",
    range: "device-range",
    dryer: "device-dryer",
    ev: "device-ev",
    "water-heater": "device-water-heater",
    "heat-pump": "device-heat-pump",
    "well-pump": "device-well-pump",
  };
  for (const [kind, quantity] of Object.entries(counts)) {
    rows.push({ id: devicePrice[kind] || `device-${kind}`, category: "electrical", quantity, unit: "each", kind: "material", basis: "One device per placement." });
  }
  if (design.devices.length) {
    rows.push({ id: "device-box", category: "electrical", quantity: design.devices.length, unit: "each", kind: "material", basis: "One box per device. Assumption." });
    rows.push({ id: "device-plate", category: "electrical", quantity: design.devices.length, unit: "each", kind: "material", basis: "One cover plate per device. Assumption." });
  }
  if (design.circuits.length) {
    const breakers = {};
    for (const circuit of design.circuits) {
      const id = breakerId(circuit);
      breakers[id] = (breakers[id] || 0) + 1;
    }
    for (const [id, quantity] of Object.entries(breakers)) {
      rows.push({ id, category: "electrical", quantity, unit: "each", kind: "material", basis: "One breaker per circuit. 120V circuits that need both AFCI and GFCI use a dual-function breaker. 240V uses a two-pole breaker of the circuit amps." });
    }
  }
  if (design.panel) {
    const service = design.load.service;
    if (service <= 200) {
      rows.push({ id: "panel-200", category: "electrical", quantity: 1, unit: "each", kind: "material", basis: `The load calc recommends ${service}A. This line is the published 200A panel, which covers that recommendation. An electrician should confirm the service.` });
    } else {
      rows.push({ id: "panel-larger", category: "electrical", quantity: 1, unit: "each", kind: "material", basis: `The load calc recommends ${service}A, which is larger than the priced 200A panel. Price needed.` });
    }
  }
  if (conduit > 0) {
    rows.push({ id: "emt-half", category: "electrical", quantity: round2(conduit), unit: "foot", kind: "material", basis: "Conduit is the default on hempcrete and rammed earth so the wire is not buried in the wall. Assumption: each vertical drop on those walls is 1/2 in. EMT, and the horizontal run stays NM. Needs electrician and inspector confirmation." });
    rows.push({ id: "emt-fitting", category: "electrical", quantity: fittings, unit: "each", kind: "material", basis: "Two fittings per conduit drop. Assumption." });
  }
  if (raceway > 0) {
    rows.push({ id: "raceway", category: "electrical", quantity: round2(raceway), unit: "foot", kind: "material", basis: "Surface raceway on the vertical drop, so the cable stays out of the wall. The horizontal run stays NM. Assumption. Needs electrician and inspector confirmation." });
    rows.push({ id: "raceway-fitting", category: "electrical", quantity: racewayFittings, unit: "each", kind: "material", basis: "Two raceway fittings per drop. Assumption." });
  }
  if (nmFeet > 0) {
    rows.push({ id: "nm-staple", category: "electrical", quantity: Math.ceil(nmFeet / 4.5), unit: "each", kind: "material", basis: "NEC 334.30 secures NM within 12 in. of a box and every 4.5 ft. One staple per 4.5 ft of NM is the count used here. Confirm the spacing." });
  }
  if (design.panel) {
    rows.push({ id: "ground-rod", category: "electrical", quantity: 1, unit: "each", kind: "material", basis: "One 8 ft ground rod. NEC 250.53 may require a second rod if the resistance is over 25 ohms. Verify." });
    rows.push({ id: "ground-clamp", category: "electrical", quantity: 1, unit: "each", kind: "material", basis: "Clamp for the ground rod." });
  }
  rows.push({ id: "electrical-permit", category: "electrical", quantity: design.panel || design.devices.length ? 1 : 0, unit: "each", kind: "material", allowance: false, basis: "Washington L&I electrical permit. The fee is stage 9; this line is the hook." });
  const rates = laborAssumption(house);
  const laborHours = round2(design.devices.length * rates.perDevice + (design.panel ? rates.panel : 0) + nmFeet * rates.perFoot);
  if (laborHours > 0) {
    rows.push({ id: "electrical-labor", category: "labor", quantity: laborHours, unit: "hour", kind: "labor", wageId: "wage-electrician", basis: `Assumption you can edit: ${rates.perDevice} hour per device, ${rates.panel} hours for the panel, and ${rates.perFoot} hour per foot of cable.` });
  }
  return rows.filter((row) => row.quantity > 0);
}

export function deviceWarnings(device, circuit = null) {
  const warnings = [];
  if ((device.roomRole === "bath" || device.roomRole === "kitchen" || device.roomRole === "outdoor") && device.kind === "receptacle") {
    warnings.push({
      message: "This location needs GFCI protection.",
      section: "NEC 210.8(A)",
      url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70",
      adoption: "WAC 296-46B-010 adopts the 2023 NEC.",
      adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
    });
  }
  if (circuit && circuit.voltageDrop.percent > BRANCH_DROP_PERCENT) {
    warnings.push({
      message: `Voltage drop is ${circuit.voltageDrop.percent}% at the far device. The informational note recommends 3% or less on the branch circuit, and 5% or less once the feeder is included.`,
      section: RULES.voltageDrop.section,
      url: RULES.voltageDrop.url,
      adoption: RULES.voltageDrop.adoption,
      adoptionUrl: RULES.voltageDrop.adoptionUrl,
    });
  }
  return warnings;
}

const WIRE_IDS = {
  "14-2": "nm-14-2",
  "12-2": "nm-12-2",
  "10-2": "nm-10-2",
  "10-3": "nm-10-3",
  "8-3": "nm-8-3",
  "6-3": "nm-6-3",
  "4-3": "nm-4-3",
};

const DEVICE_PRICE = {
  receptacle: "device-receptacle",
  gfci: "device-gfci",
  "wr-receptacle": "device-wr",
  switch: "device-switch",
  "switch-3way": "device-switch-3way",
  light: "device-light",
  "wall-light": "device-light",
  fan: "device-fan",
  smoke: "device-smoke",
  range: "device-range",
  dryer: "device-dryer",
  ev: "device-ev",
  "water-heater": "device-water-heater",
  "heat-pump": "device-heat-pump",
  "well-pump": "device-well-pump",
};

/** This device's own parts: the device, box, plate, its cable, the drop material, and its labor. */
export function deviceShare(house, deviceId) {
  const design = buildElectrical(house, { phase: "full" });
  const device = design.devices.find((item) => item.id === deviceId);
  const circuit = design.circuits.find((item) => item.deviceIds.includes(deviceId));
  if (!device || !circuit) return [];
  const segment = circuit.segments.find((item) => item.deviceId === deviceId);
  const horizontal = segment?.length || 0;
  const drop = segment?.drop || 0;
  const wall = (house.walls || []).find((item) => item.id === device.wallId);
  const method = wall ? wallMethod(house, wall) : "stud-bay";
  const nm = horizontal + (method === "conduit" || method === "raceway" ? 0 : drop);
  const rows = [];
  const conductors = circuit.volts === 240 ? 3 : 2;
  const wireKey = `${circuit.gauge}-${conductors}`;
  if (nm > 0) {
    rows.push({ id: WIRE_IDS[wireKey] || `wire-${wireKey}`, category: "electrical", quantity: round2(nm), unit: "foot", kind: "material", basis: "This device's share of the cable: the run from the previous device, plus the vertical drop when that drop is NM." });
  }
  rows.push({ id: DEVICE_PRICE[device.kind] || `device-${device.kind}`, category: "electrical", quantity: 1, unit: "each", kind: "material", basis: "This device." });
  rows.push({ id: "device-box", category: "electrical", quantity: 1, unit: "each", kind: "material", basis: "One box for this device. Assumption." });
  rows.push({ id: "device-plate", category: "electrical", quantity: 1, unit: "each", kind: "material", basis: "One cover plate for this device. Assumption." });
  if (method === "conduit" && drop > 0) {
    rows.push({ id: "emt-half", category: "electrical", quantity: round2(drop), unit: "foot", kind: "material", basis: "Vertical drop in 1/2 in. EMT. Assumption." });
    rows.push({ id: "emt-fitting", category: "electrical", quantity: 2, unit: "each", kind: "material", basis: "Two fittings on this drop. Assumption." });
  }
  if (method === "raceway" && drop > 0) {
    rows.push({ id: "raceway", category: "electrical", quantity: round2(drop), unit: "foot", kind: "material", basis: "Vertical drop in surface raceway. Assumption." });
    rows.push({ id: "raceway-fitting", category: "electrical", quantity: 2, unit: "each", kind: "material", basis: "Two raceway fittings on this drop. Assumption." });
  }
  if (nm > 0) {
    rows.push({ id: "nm-staple", category: "electrical", quantity: Math.max(1, Math.ceil(nm / 4.5)), unit: "each", kind: "material", basis: "This device's NM, one staple per 4.5 ft. NEC 334.30. Assumption." });
  }
  const rates = laborAssumption(house);
  const hours = round2(rates.perDevice + rates.perFoot * (horizontal + drop));
  if (hours > 0) {
    rows.push({ id: "electrical-labor", category: "labor", quantity: hours, unit: "hour", kind: "labor", wageId: "wage-electrician", basis: `This device's share: ${rates.perDevice} hour plus ${rates.perFoot} hour per foot of its cable. Assumption.` });
  }
  return rows;
}

function breakerId(circuit) {
  if (circuit.breakerPoles === 2) {
    if (circuit.amps <= 20) return "breaker-20-2";
    if (circuit.amps <= 30) return "breaker-30-2";
    if (circuit.amps <= 40) return "breaker-40-2";
    return "breaker-50-2";
  }
  if (circuit.afci && circuit.gfci) return circuit.amps <= 15 ? "breaker-15-df" : "breaker-20-df";
  if (circuit.afci) return circuit.amps <= 15 ? "breaker-15-afci" : "breaker-20-df";
  return circuit.amps <= 15 ? "breaker-15" : "breaker-20";
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
