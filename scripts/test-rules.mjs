import assert from "node:assert/strict";
import sample from "../data/sample-house.json" with { type: "json" };
import { decorateHouse } from "../src/build/walls.js";
import { applyFix, evaluateRules } from "../src/rules/index.js";
import { CODE_RULES, codeWarnings } from "../src/rules/code.js";

let failed = 0;
const tested = new Set();

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

function rule(id, fn) {
  tested.add(id);
  check(id, fn);
}

function rect(id, name, x, y, w, h, phase = "phase1") {
  return {
    id,
    name,
    phase,
    levelId: "main",
    outdoor: false,
    polygon: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

function wall(id, x0, y0, x1, y1, extra = {}) {
  return {
    id,
    start: { x: x0, y: y0 },
    end: { x: x1, y: y1 },
    height: 10,
    thickness: extra.thickness ?? 0.5,
    assemblyId: extra.assemblyId || "interior-partition",
    assembly: extra.assembly || "framed",
    role: extra.role || "interior",
    phase: extra.phase || "phase1",
    ...extra,
    id,
    start: { x: x0, y: y0 },
    end: { x: x1, y: y1 },
  };
}

function shell(extra = {}) {
  return {
    schemaVersion: 5,
    levels: [{ id: "main", plateHeight: extra.plate || 10 }],
    walls: extra.walls || [],
    rooms: extra.rooms || [],
    openings: extra.openings || [],
    electrical: extra.electrical || { devices: [], panel: null },
    plumbing: extra.plumbing || { fixtures: [] },
    energy: extra.energy,
  };
}

function ids(house, id, injected) {
  return codeWarnings(house, injected).filter((finding) => finding.ruleId === id);
}

rule("irc.room-area", () => {
  const small = shell({ rooms: [rect("office", "Office", 0, 0, 6, 6)] });
  assert.equal(ids(small, "irc.room-area").length, 1);
  const kitchen = shell({ rooms: [rect("kitchen", "Kitchen", 0, 0, 6, 6)] });
  assert.equal(ids(kitchen, "irc.room-area").length, 0);
  const ok = shell({ rooms: [rect("living", "Living", 0, 0, 10, 10)] });
  assert.equal(ids(ok, "irc.room-area").length, 0);
});

rule("irc.room-dimension", () => {
  const narrow = shell({ rooms: [rect("office", "Office", 0, 0, 6, 12)] });
  assert.equal(ids(narrow, "irc.room-dimension").length, 1);
  const kitchen = shell({ rooms: [rect("kitchen", "Kitchen", 0, 0, 6, 12)] });
  assert.equal(ids(kitchen, "irc.room-dimension").length, 0);
  const ok = shell({ rooms: [rect("living", "Living", 0, 0, 10, 12)] });
  assert.equal(ids(ok, "irc.room-dimension").length, 0);
});

rule("irc.ceiling-height", () => {
  const low = shell({
    rooms: [rect("living", "Living", 0, 0, 10, 10)],
    walls: [wall("s", 0, 0, 10, 0, { height: 6.5 })],
  });
  assert.equal(ids(low, "irc.ceiling-height").length, 1);
  const bath = shell({
    rooms: [rect("bath", "Bathroom", 0, 0, 8, 8)],
    walls: [wall("s", 0, 0, 8, 0, { height: 6.5 })],
  });
  assert.equal(ids(bath, "irc.ceiling-height").length, 1);
  const okBath = shell({
    rooms: [rect("bath", "Bathroom", 0, 0, 8, 8)],
    walls: [wall("s", 0, 0, 8, 0, { height: 6.7 })],
  });
  assert.equal(ids(okBath, "irc.ceiling-height").length, 0);
  const ok = shell({
    rooms: [rect("living", "Living", 0, 0, 10, 10)],
    walls: [wall("s", 0, 0, 10, 0, { height: 8 })],
  });
  assert.equal(ids(ok, "irc.ceiling-height").length, 0);
});

rule("irc.egress-window", () => {
  const room = rect("bed", "Bedroom", 0, 0, 12, 12);
  const edge = wall("s", 0, 0, 12, 0, { role: "exterior", assemblyId: "hempcrete-exterior", assembly: "hempcrete", thickness: 1 });
  const missing = shell({ rooms: [room], walls: [edge] });
  assert.equal(ids(missing, "irc.egress-window").length, 1);
  const small = shell({
    rooms: [room],
    walls: [edge],
    openings: [{ id: "w", wallId: "s", type: "window", offset: 4, width: 1.5, height: 1.5, sill: 2 }],
  });
  assert.equal(ids(small, "irc.egress-window")[0].severity, "blocker");
  const ok = shell({
    rooms: [room],
    walls: [edge],
    openings: [{ id: "w", wallId: "s", type: "window", offset: 3, width: 3, height: 4, sill: 2.5 }],
  });
  assert.equal(ids(ok, "irc.egress-window").length, 0);
});

rule("irc.egress-door", () => {
  const edge = wall("s", 0, 0, 12, 0, { role: "exterior", assemblyId: "hempcrete-exterior", assembly: "hempcrete", thickness: 1 });
  const none = shell({ rooms: [rect("living", "Living", 0, 0, 12, 10)], walls: [edge] });
  assert.equal(ids(none, "irc.egress-door").length, 1);
  const narrow = shell({
    rooms: [rect("living", "Living", 0, 0, 12, 10)],
    walls: [edge],
    openings: [{ id: "d", wallId: "s", type: "door", offset: 2, width: 2.5, height: 6.667 }],
  });
  const hit = ids(narrow, "irc.egress-door")[0];
  assert.ok(hit.fix);
  const widened = applyFix(narrow, hit);
  assert.equal(widened.openings[0].width, 3);
  assert.equal(ids(widened, "irc.egress-door").length, 0);
});

rule("irc.hallway", () => {
  assert.equal(ids(shell({ rooms: [rect("living", "Living", 0, 0, 12, 10)] }), "irc.hallway").length, 0);
  const narrow = shell({ rooms: [rect("hall", "Hall", 0, 0, 10, 2.5)] });
  assert.equal(ids(narrow, "irc.hallway").length, 1);
  const named = shell({ rooms: [rect("hb", "Hall bath", 0, 0, 8, 5)] });
  assert.equal(ids(named, "irc.hallway").length, 0);
  const ok = shell({ rooms: [rect("hall", "Hallway", 0, 0, 10, 3.5)] });
  assert.equal(ids(ok, "irc.hallway").length, 0);
});

rule("irc.stair", () => {
  assert.equal(ids(shell({ rooms: [rect("living", "Living", 0, 0, 12, 10)] }), "irc.stair").length, 0);
  const narrow = shell({ rooms: [rect("stair", "Stair", 0, 0, 12, 2.5)] });
  assert.equal(ids(narrow, "irc.stair").length, 1);
  const ok = shell({ rooms: [rect("stair", "Stair", 0, 0, 12, 3.5)] });
  assert.equal(ids(ok, "irc.stair").length, 0);
});

rule("irc.smoke", () => {
  const bare = shell({
    rooms: [rect("bed", "Bedroom", 0, 0, 12, 12), rect("living", "Living", 0, 12, 12, 12)],
  });
  assert.ok(ids(bare, "irc.smoke").some((finding) => finding.fix?.id === "add-smoke"));
  const hit = ids(bare, "irc.smoke").find((finding) => finding.fix?.id === "add-smoke" && finding.target.id === "bed");
  const withInside = applyFix(bare, hit);
  assert.ok(withInside.electrical.devices.some((device) => device.kind === "smoke" && device.roomId === "bed"));
  const covered = shell({
    rooms: [rect("bed", "Bedroom", 0, 0, 12, 12), rect("living", "Living", 0, 12, 12, 12)],
    electrical: {
      devices: [
        { id: "a", kind: "smoke", name: "Smoke / CO alarm", x: 6, y: 6, roomId: "bed", phase: "phase1", ghost: false, volts: 120 },
        { id: "b", kind: "smoke", name: "Smoke / CO alarm", x: 6, y: 14, roomId: "living", phase: "phase1", ghost: false, volts: 120 },
      ],
    },
  });
  assert.equal(ids(covered, "irc.smoke").length, 0);
});

rule("irc.co", () => {
  const bare = shell({
    rooms: [rect("bed", "Bedroom", 0, 0, 12, 12), rect("living", "Living", 0, 12, 12, 12)],
  });
  assert.equal(ids(bare, "irc.co").length, 1);
  const covered = shell({
    rooms: [rect("bed", "Bedroom", 0, 0, 12, 12), rect("living", "Living", 0, 12, 12, 12)],
    electrical: {
      devices: [
        { id: "b", kind: "smoke", name: "Smoke / CO alarm", x: 6, y: 14, roomId: "living", phase: "phase1", ghost: false, volts: 120 },
      ],
    },
  });
  assert.equal(ids(covered, "irc.co").length, 0);
});

rule("irc.garage-heat", () => {
  assert.equal(ids(shell({ rooms: [rect("living", "Living", 0, 0, 12, 10)] }), "irc.garage-heat").length, 0);
  const garage = shell({ rooms: [rect("garage", "Garage", 0, 0, 20, 20)] });
  assert.equal(ids(garage, "irc.garage-heat").length, 1);
});

rule("irc.bath-exhaust", () => {
  const bath = shell({ rooms: [rect("bath", "Bathroom", 0, 0, 8, 8)] });
  const hit = ids(bath, "irc.bath-exhaust")[0];
  assert.equal(hit.fix.id, "add-fan");
  const next = applyFix(bath, hit);
  assert.equal(ids(next, "irc.bath-exhaust").length, 0);
});

rule("nec.gfci", () => {
  const plain = shell({
    rooms: [rect("bath", "Bathroom", 0, 0, 8, 8)],
    electrical: {
      devices: [{
        id: "r", kind: "receptacle", name: "Receptacle", volts: 120, x: 4, y: 1, roomId: "bath", roomRole: "bath", phase: "phase1", ghost: false,
      }],
    },
  });
  const hit = ids(plain, "nec.gfci").find((finding) => finding.target.id === "r");
  assert.equal(hit.severity, "blocker");
  const next = applyFix(plain, hit);
  assert.equal(next.electrical.devices[0].kind, "gfci");
  assert.equal(ids(next, "nec.gfci").filter((finding) => finding.target?.id === "r").length, 0);
  const throughWall = shell({
    rooms: [rect("living", "Living", 0, 0, 12, 10), rect("kitchen", "Kitchen", 12, 0, 10, 10)],
    electrical: {
      devices: [{ id: "r2", kind: "receptacle", volts: 120, x: 11, y: 5, roomId: "living", roomRole: "general", phase: "phase1", ghost: false }],
    },
    plumbing: { fixtures: [{ id: "sink", kind: "kitchen-sink", x: 13, y: 5, roomId: "kitchen", phase: "phase1", ghost: false }] },
  });
  assert.equal(ids(throughWall, "nec.gfci").filter((finding) => finding.target?.id === "r2").length, 0);
  const sameRoom = shell({
    rooms: [rect("kitchen", "Kitchen", 0, 0, 12, 10)],
    electrical: {
      devices: [{ id: "r3", kind: "receptacle", volts: 120, x: 4, y: 2, roomId: "kitchen", roomRole: "general", phase: "phase1", ghost: false }],
    },
    plumbing: { fixtures: [{ id: "sink", kind: "kitchen-sink", x: 6, y: 2, roomId: "kitchen", phase: "phase1", ghost: false }] },
  });
  assert.ok(ids(sameRoom, "nec.gfci").some((finding) => finding.target?.id === "r3"));
});

rule("nec.afci", () => {
  const house = shell({ rooms: [rect("bed", "Bedroom", 0, 0, 12, 12), rect("bath", "Bathroom", 20, 0, 8, 8)] });
  const open = {
    circuits: [{ id: "c1", name: "Receptacles", amps: 20, volts: 120, afci: false, deviceIds: ["d"], voltageDrop: { percent: 1 } }],
    devices: [{ id: "d", kind: "receptacle", roomId: "bed", x: 6, y: 6, ghost: false, phase: "phase1" }],
    gaps: [],
  };
  assert.equal(ids(house, "nec.afci", { electrical: open }).length, 1);
  assert.equal(ids(house, "nec.afci", { electrical: { ...open, circuits: [{ ...open.circuits[0], afci: true }] } }).length, 0);
  const bath = {
    circuits: [{ id: "b", name: "Bathroom", amps: 20, volts: 120, afci: false, deviceIds: ["g"], voltageDrop: { percent: 1 } }],
    devices: [{ id: "g", kind: "gfci", roomId: "bath", x: 22, y: 4, ghost: false, phase: "phase1" }],
    gaps: [],
  };
  assert.equal(ids(house, "nec.afci", { electrical: bath }).length, 0);
});

rule("nec.receptacle-spacing", () => {
  const open = shell({ rooms: [rect("living", "Living", 0, 0, 20, 10)] });
  assert.equal(ids(open, "nec.receptacle-spacing").length, 1);
  const devices = [
    { id: "e", kind: "receptacle", volts: 120, x: 10, y: 0, roomId: "living", roomRole: "general", phase: "phase1", ghost: false },
    { id: "n", kind: "receptacle", volts: 120, x: 10, y: 10, roomId: "living", roomRole: "general", phase: "phase1", ghost: false },
    { id: "w", kind: "receptacle", volts: 120, x: 0, y: 5, roomId: "living", roomRole: "general", phase: "phase1", ghost: false },
    { id: "east", kind: "receptacle", volts: 120, x: 20, y: 5, roomId: "living", roomRole: "general", phase: "phase1", ghost: false },
  ];
  // 20 ft edges need a second outlet. 8 ft room with one outlet per wall passes.
  const ok = shell({
    rooms: [rect("living", "Living", 0, 0, 8, 8)],
    electrical: {
      devices: [
        { id: "s", kind: "receptacle", volts: 120, x: 4, y: 0, roomId: "living", phase: "phase1", ghost: false },
        { id: "n", kind: "receptacle", volts: 120, x: 4, y: 8, roomId: "living", phase: "phase1", ghost: false },
        { id: "w", kind: "receptacle", volts: 120, x: 0, y: 4, roomId: "living", phase: "phase1", ghost: false },
        { id: "e", kind: "receptacle", volts: 120, x: 8, y: 4, roomId: "living", phase: "phase1", ghost: false },
      ],
    },
  });
  assert.equal(ids(ok, "nec.receptacle-spacing").length, 0);
  void devices;
});

rule("nec.kitchen-circuits", () => {
  const kitchen = shell({ rooms: [rect("kitchen", "Kitchen", 0, 0, 12, 10)] });
  assert.equal(ids(kitchen, "nec.kitchen-circuits").length, 1);
  const supplied = shell({
    rooms: [rect("kitchen", "Kitchen", 0, 0, 12, 10)],
    electrical: {
      devicesPerCircuit: 1,
      devices: [
        { id: "a", kind: "gfci", volts: 120, x: 2, y: 1, roomId: "kitchen", roomRole: "kitchen", phase: "phase1", ghost: false },
        { id: "b", kind: "gfci", volts: 120, x: 6, y: 1, roomId: "kitchen", roomRole: "kitchen", phase: "phase1", ghost: false },
      ],
    },
  });
  assert.equal(ids(supplied, "nec.kitchen-circuits").length, 0);
});

rule("nec.laundry-circuit", () => {
  const laundry = shell({ rooms: [rect("laundry", "Laundry", 0, 0, 8, 8)] });
  assert.equal(ids(laundry, "nec.laundry-circuit").length, 1);
  const supplied = shell({
    rooms: [rect("laundry", "Laundry", 0, 0, 8, 8)],
    electrical: {
      devices: [{ id: "w", kind: "gfci", volts: 120, x: 2, y: 1, roomId: "laundry", roomRole: "laundry", phase: "phase1", ghost: false }],
    },
  });
  assert.equal(ids(supplied, "nec.laundry-circuit").length, 0);
});

rule("nec.voltage-drop", () => {
  const far = shell({
    rooms: [rect("living", "Living", 0, 0, 90, 10)],
    walls: [wall("s", 0, 0, 90, 0)],
    electrical: {
      panel: { id: "panel-main", x: 1, y: 0, wallId: "s", offset: 1, height: 5, phase: "phase1" },
      devices: [{
        id: "far", kind: "receptacle", volts: 120, x: 80, y: 0, wallId: "s", offset: 80, roomId: "living", roomRole: "general", phase: "phase1", ghost: false, height: 1.5, mount: "wall",
      }],
    },
  });
  assert.equal(ids(far, "nec.voltage-drop").length, 1);
  assert.equal(ids(far, "nec.voltage-drop")[0].severity, "tip");
  const near = shell({
    rooms: [rect("living", "Living", 0, 0, 20, 10)],
    walls: [wall("s", 0, 0, 20, 0)],
    electrical: {
      panel: { id: "panel-main", x: 1, y: 0, wallId: "s", offset: 1, height: 5, phase: "phase1" },
      devices: [{
        id: "near", kind: "receptacle", volts: 120, x: 8, y: 0, wallId: "s", offset: 8, roomId: "living", roomRole: "general", phase: "phase1", ghost: false, height: 1.5, mount: "wall",
      }],
    },
  });
  assert.equal(ids(near, "nec.voltage-drop").length, 0);
});

rule("upc.toilet-clearance", () => {
  const tight = shell({
    walls: [
      wall("back", 0, 0, 0, 10),
      wall("side", 0, 1, 8, 1),
    ],
    plumbing: { fixtures: [{ id: "t", kind: "toilet", x: 1, y: 1.4, wallId: "back", offset: 1.4, phase: "phase1", ghost: false }] },
  });
  assert.equal(ids(tight, "upc.toilet-clearance").length, 1);
  const ok = shell({
    walls: [
      wall("back", 0, 0, 0, 10),
      wall("side", 0, 1, 8, 1),
    ],
    plumbing: { fixtures: [{ id: "t", kind: "toilet", x: 1, y: 4, wallId: "back", offset: 4, phase: "phase1", ghost: false }] },
  });
  assert.equal(ids(ok, "upc.toilet-clearance").length, 0);
});

rule("upc.trap-arm", () => {
  const long = shell({
    walls: [wall("wet", 0, 0, 0, 12)],
    plumbing: {
      fixtures: [
        { id: "a", kind: "lavatory", x: 0, y: 1, wallId: "wet", offset: 1, roomId: "bath", roomRole: "bath", phase: "phase1", ghost: false },
        { id: "b", kind: "lavatory", x: 0, y: 10, wallId: "wet", offset: 10, roomId: "bath", roomRole: "bath", phase: "phase1", ghost: false },
      ],
    },
  });
  const hits = ids(long, "upc.trap-arm");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].citation.confirmSection, true);
  const ok = shell({
    walls: [wall("wet", 0, 0, 0, 12)],
    plumbing: {
      fixtures: [
        { id: "a", kind: "lavatory", x: 0, y: 1, wallId: "wet", offset: 1, roomId: "bath", roomRole: "bath", phase: "phase1", ghost: false },
        { id: "b", kind: "lavatory", x: 0, y: 3, wallId: "wet", offset: 3, roomId: "bath", roomRole: "bath", phase: "phase1", ghost: false },
      ],
    },
  });
  assert.equal(ids(ok, "upc.trap-arm").length, 0);
});

rule("upc.slope", () => {
  const flat = shell({
    walls: [wall("w", 0, 0, 0, 8)],
    plumbing: {
      inchesPerFoot: 0.1,
      septic: { x: 0, y: 20 },
      fixtures: [{ id: "t", kind: "toilet", x: 0, y: 2, wallId: "w", offset: 2, phase: "phase1", ghost: false }],
    },
  });
  const hit = ids(flat, "upc.slope")[0];
  assert.ok(hit);
  assert.equal(hit.citation.confirmSection, true);
  const ok = shell({
    walls: [wall("w", 0, 0, 0, 8)],
    plumbing: {
      septic: { x: 0, y: 20 },
      fixtures: [{ id: "t", kind: "toilet", x: 0, y: 2, wallId: "w", offset: 2, phase: "phase1", ghost: false }],
    },
  });
  assert.equal(ids(ok, "upc.slope").length, 0);
});

rule("upc.vent", () => {
  const house = shell();
  const missing = ids(house, "upc.vent", {
    plumbing: { vent: { size: 0 }, dfu: 3, dwv: [], building: { size: 3, length: 4, slope: { inchesPerFoot: 0.25 } } },
  });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].citation.confirmSection, true);
  const vented = ids(house, "upc.vent", {
    plumbing: { vent: { size: 2 }, dfu: 3, dwv: [], building: { size: 3, length: 4, slope: { inchesPerFoot: 0.25 } } },
  });
  assert.equal(vented.length, 0);
});

rule("upc.mass-wall", () => {
  const hemp = wall("h", 0, 0, 10, 0, { assemblyId: "hempcrete-exterior", assembly: "hempcrete", role: "exterior", thickness: 1 });
  const bare = shell({
    walls: [hemp],
    plumbing: { fixtures: [{ id: "lav", kind: "lavatory", x: 4, y: 0, wallId: "h", offset: 4, phase: "phase1", ghost: false }] },
  });
  const hit = ids(bare, "upc.mass-wall")[0];
  assert.equal(hit.citation.confirmSection, true);
  const next = applyFix(bare, hit);
  assert.equal(next.plumbing.fixtures[0].chase, true);
  assert.equal(ids(next, "upc.mass-wall").length, 0);
});

rule("upc.hose-sleeve", () => {
  const house = shell({
    plumbing: { fixtures: [{ id: "bib", kind: "hose-bibb", x: 1, y: 0, phase: "phase1", ghost: false }] },
  });
  const hit = ids(house, "upc.hose-sleeve")[0];
  assert.equal(hit.severity, "tip");
  assert.equal(hit.citation.confirmSection, true);
});

rule("wsec.wall-insulation", () => {
  const hemp = shell({
    walls: [wall("h", 0, 0, 10, 0, { assemblyId: "hempcrete-exterior", assembly: "hempcrete", role: "exterior", thickness: 1 })],
  });
  assert.ok(ids(hemp, "wsec.wall-insulation").some((finding) => finding.title.includes("R-18")));
  const rammed = shell({
    walls: [wall("r", 0, 0, 10, 0, { assemblyId: "rammed-earth-exterior", assembly: "rammed-earth", role: "exterior", thickness: 1.5 })],
  });
  assert.ok(ids(rammed, "wsec.wall-insulation").some((finding) => /unknown/i.test(finding.title)));
  const framed = shell({ walls: [wall("f", 0, 0, 10, 0)] });
  assert.equal(ids(framed, "wsec.wall-insulation").length, 0);
});

rule("wsec.ceiling-floor", () => {
  const open = shell({ rooms: [rect("living", "Living", 0, 0, 12, 10)] });
  const hit = ids(open, "wsec.ceiling-floor")[0];
  assert.equal(hit.fix.id, "record-insulation");
  const next = applyFix(open, hit);
  assert.equal(next.energy.ceilingR, 60);
  assert.equal(next.energy.floorR, 30);
  assert.equal(ids(next, "wsec.ceiling-floor").length, 0);
});

check("every rule has a test and a citation", () => {
  const confirm = new Set(["upc.trap-arm", "upc.slope", "upc.vent", "upc.mass-wall", "upc.hose-sleeve"]);
  for (const entry of CODE_RULES) {
    assert.ok(tested.has(entry.id), `missing test for ${entry.id}`);
    assert.equal(!!entry.citation.confirmSection, confirm.has(entry.id), entry.id);
    assert.ok(entry.citation.section && entry.citation.code && entry.why && entry.title, entry.id);
    assert.ok(["blocker", "warning", "tip"].includes(entry.severity), entry.id);
  }
});

check("the sample keeps geometry quiet and cites every code finding", () => {
  const findings = evaluateRules(decorateHouse(sample));
  assert.equal(findings.filter((finding) => String(finding.code).startsWith("geometry")).length, 0);
  const coded = findings.filter((finding) => !String(finding.code).startsWith("geometry"));
  assert.ok(coded.length > 0);
  for (const finding of coded) {
    assert.ok(finding.title && finding.why && finding.severity, finding.id);
    assert.ok(finding.citation?.section, finding.id);
    assert.equal(JSON.stringify(finding).includes("$"), false, finding.id);
  }
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall rule checks passed");
