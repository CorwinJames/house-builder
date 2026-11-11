import { decorateHouse } from "./walls.js";

const DISCLAIMER = "Not a final design. Not an engineered drawing and not for permitting.";

const ROOF = {
  id: "roof-main",
  kind: "chinese-hip-and-gable",
  placeholder: true,
  pitch: "6:12",
  pitchRiseOverRun: 0.5,
  overhang: 2,
  plateHeight: 10,
  note: "Placeholder massing only. Not a structural or architectural roof design.",
};

/**
 * A labeled sample rectangle so the Site tool has a lot to click.
 * It is not a Jefferson County parcel and it has no price.
 */
export function sampleLot(width, depth) {
  const x0 = -80;
  const y0 = -80;
  const x1 = Math.max(width + 80, 160);
  const y1 = Math.max(depth + 80, 120);
  return {
    sample: true,
    label: "Sample parcel · not a real lot",
    parcel: {
      ring: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
      source: "sample",
      note: "A sample rectangle around the plan. Not from Jefferson County GIS.",
    },
    zone: {
      district: "RR 1:5",
      roadClass: "local-access",
      frontFt: 20,
      sideFt: 5,
      rearFt: 5,
      assumed: true,
    },
    terrain: {
      source: "sample",
      note: "Sample slope, 0.025 ft per ft uphill to the north. Not a USGS 3DEP or WA DNR lidar surface.",
      contourFt: 2,
      plane: { base: 100, east: 0, north: 0.025 },
    },
    soil: {
      mapUnitName: null,
      note: "Not a Web Soil Survey map unit.",
    },
  };
}

export function blankPlan() {
  const width = 36;
  const depth = 24;
  return decorateHouse({
    schemaVersion: 6,
    id: `plan-${Date.now().toString(36)}`,
    name: "Untitled plan",
    description: "Blank plan. Draw walls to start.",
    sample: false,
    disclaimer: DISCLAIMER,
    units: "feet",
    location: {
      name: "Jefferson County, Washington",
      note: "The lot in this file is a sample rectangle, not a Jefferson County parcel.",
    },
    orientation: {
      xAxis: "east",
      yAxis: "north",
      origin: "Southwest corner of the footprint",
      longAxis: "east-west",
    },
    footprint: { width, depth, longAxis: "east-west" },
    phases: {
      phase1: {
        name: "Phase 1",
        bounds: { x0: 0, y0: 0, x1: width, y1: depth },
        note: "Empty plan.",
      },
    },
    levels: [{ id: "main", name: "Main floor", elevation: 0, plateHeight: 10, floorThickness: 0.5 }],
    walls: [],
    rooms: [],
    openings: [],
    roof: { ...ROOF },
    notes: [
      "Blank plan. The lot is a sample rectangle, not a real parcel.",
      "This file has no prices. Do not add one unless it cites a source URL and the date it was checked.",
    ],
    site: sampleLot(width, depth),
  });
}

/**
 * The sample's phase 1 core: living, kitchen, bathroom, and bedroom.
 * Future wings are left out. The sample lot stays, still labeled as a sample.
 */
export function fourRoomSample(sample) {
  const next = structuredClone(sample);
  next.id = "four-room-sample";
  next.name = "Four-room sample";
  next.description = "Phase 1 four-room core: living, kitchen, bathroom, and bedroom. Future wings are not in this plan.";
  next.sample = true;
  next.disclaimer = sample.disclaimer || DISCLAIMER;
  const walls = (next.walls || []).filter((wall) => wall.phase === "phase1");
  const wallIds = new Set(walls.map((wall) => wall.id));
  next.walls = walls;
  next.rooms = (next.rooms || []).filter((room) => room.phase === "phase1");
  const roomIds = new Set(next.rooms.map((room) => room.id));
  next.openings = (next.openings || []).filter((opening) => wallIds.has(opening.wallId));
  next.constraints = (next.constraints || []).filter((item) => {
    const ids = [item.targetId, item.referenceId].filter((id) => id && !String(id).startsWith("footprint:"));
    return ids.every((id) => wallIds.has(id));
  });
  if (next.electrical) {
    const panel = next.electrical.panel;
    next.electrical.panel = panel && (!panel.wallId || wallIds.has(panel.wallId)) ? panel : null;
    next.electrical.devices = (next.electrical.devices || []).filter((device) => (
      device.phase !== "future"
      && (!device.wallId || wallIds.has(device.wallId))
      && (!device.roomId || roomIds.has(device.roomId))
    ));
  }
  if (next.plumbing) {
    const entry = next.plumbing.entry;
    next.plumbing.entry = entry && (!entry.wallId || wallIds.has(entry.wallId)) ? entry : null;
    next.plumbing.fixtures = (next.plumbing.fixtures || []).filter((fixture) => (
      fixture.phase !== "future"
      && (!fixture.wallId || wallIds.has(fixture.wallId))
      && (!fixture.roomId || roomIds.has(fixture.roomId))
    ));
  }
  return decorateHouse(next);
}
