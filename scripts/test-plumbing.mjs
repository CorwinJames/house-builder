import assert from "node:assert/strict";
import { priceProblems } from "../src/cost/list.js";
import {
  buildPlumbing,
  drainSize,
  fixtureFromClick,
  fixtureWarnings,
  slopeDrop,
  suggestRoom,
  trapArmLimit,
} from "../src/plumbing/design.js";

let failed = 0;
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

check("a bathroom group is 6 DFU and the drain is 3 in. because of the toilet", () => {
  const house = {
    walls: [{ id: "w", start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, phase: "phase1", assemblyId: "interior-partition", role: "interior", thickness: 0.5 }],
    rooms: [{ id: "bath", name: "Bathroom", phase: "phase1", polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 10 }, { x: 0, y: 10 }] }],
    plumbing: {
      fixtures: [
        { id: "t", kind: "toilet", x: 1, y: 2, wallId: "w", offset: 2, roomId: "bath", roomRole: "bath", phase: "phase1" },
        { id: "l", kind: "lavatory", x: 1, y: 4, wallId: "w", offset: 4, roomId: "bath", roomRole: "bath", phase: "phase1" },
        { id: "s", kind: "shower", x: 1, y: 6, wallId: "w", offset: 6, roomId: "bath", roomRole: "bath", phase: "phase1" },
      ],
      septic: { x: 1, y: 0 },
    },
  };
  const design = buildPlumbing(house);
  assert.equal(design.dfu, 6);
  assert.equal(design.building.size, 3);
  assert.equal(drainSize(6, { waterClosets: 1 }), 3);
  assert.equal(drainSize(6, { waterClosets: 0 }), 2);
});

check("supply fixture units add up and home runs are 1/2 in.", () => {
  const house = {
    walls: [],
    rooms: [],
    plumbing: {
      supplyMethod: "manifold",
      entry: { id: "e", x: 0, y: 0, phase: "phase1" },
      fixtures: [
        { id: "t", kind: "toilet", x: 4, y: 0, phase: "phase1", roomRole: "bath" },
        { id: "l", kind: "lavatory", x: 6, y: 0, phase: "phase1", roomRole: "bath" },
      ],
    },
  };
  const design = buildPlumbing(house);
  assert.equal(design.wsfu.total, 3.5);
  assert.ok(design.supply.every((run) => run.size === 0.5));
  assert.equal(design.supply.find((run) => run.fixtureId === "t").length, 4);
});

check("a 20 ft building drain drops 5 in. at 1/4 in. per ft", () => {
  const drop = slopeDrop(20, 3);
  assert.equal(drop.inchesPerFoot, 0.25);
  assert.equal(drop.inches, 5);
  const house = {
    walls: [],
    rooms: [],
    plumbing: {
      septic: { x: 20, y: 0 },
      fixtures: [{ id: "t", kind: "toilet", x: 0, y: 0, phase: "phase1", roomRole: "bath", roomId: "b" }],
    },
  };
  const design = buildPlumbing(house);
  assert.equal(design.building.length, 20);
  assert.equal(design.building.slope.inches, 5);
});

check("a lavatory trap arm longer than 2.5 ft warns", () => {
  assert.equal(trapArmLimit(1.25), 2.5);
  const house = {
    walls: [{ id: "w", start: { x: 0, y: 0 }, end: { x: 0, y: 12 }, assemblyId: "interior-partition", role: "interior", thickness: 0.5 }],
    rooms: [],
    plumbing: {
      fixtures: [
        { id: "t", kind: "toilet", x: 1, y: 1, wallId: "w", roomId: "bath", roomRole: "bath", phase: "phase1" },
        { id: "l", kind: "lavatory", x: 1, y: 6, wallId: "w", roomId: "bath", roomRole: "bath", phase: "phase1" },
      ],
    },
  };
  const design = buildPlumbing(house);
  const arm = design.dwv.find((item) => item.fixtureId === "l");
  assert.ok(arm.trapArm > 2.5);
  const warnings = fixtureWarnings(house, house.plumbing.fixtures[1], design);
  assert.ok(warnings.some((item) => item.section === "UPC Table 1002.2"));
});

check("suggest placements puts a toilet, lavatory, and shower in a bathroom", () => {
  const room = {
    id: "bath",
    name: "Bathroom",
    phase: "phase1",
    polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 10 }, { x: 0, y: 10 }],
  };
  const house = {
    walls: [{ id: "w", start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, assemblyId: "interior-partition", role: "interior", thickness: 0.5, phase: "phase1" }],
    rooms: [room],
  };
  const ghosts = suggestRoom(house, room);
  assert.deepEqual(ghosts.map((item) => item.kind), ["toilet", "lavatory", "shower"]);
  const kitchen = { id: "k", name: "Kitchen", phase: "phase1", polygon: room.polygon };
  const kitchenGhosts = suggestRoom({ ...house, rooms: [kitchen] }, kitchen);
  assert.deepEqual(kitchenGhosts.map((item) => item.kind), ["kitchen-sink", "dishwasher"]);
});

check("a sink that is the stack still has a real drain length and no trap-arm warning", () => {
  const house = {
    walls: [{ id: "w", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, assemblyId: "interior-partition", role: "interior", thickness: 0.5 }],
    rooms: [],
    plumbing: {
      septic: { x: 0, y: -20 },
      fixtures: [{
        id: "sink",
        kind: "kitchen-sink",
        x: 5,
        y: 0.4,
        wallId: "w",
        offset: 5,
        roomId: "k",
        roomRole: "kitchen",
        phase: "phase1",
      }],
    },
  };
  const design = buildPlumbing(house);
  const drain = design.dwv[0];
  assert.equal(drain.trapArm, 0);
  assert.ok(drain.length >= 2);
  const warnings = fixtureWarnings(house, house.plumbing.fixtures[0], design);
  assert.equal(warnings.some((item) => item.section === "UPC Table 1002.2"), false);
});

check("placing a sink adds priced PEX and changes nothing that was invented", () => {
  assert.deepEqual(priceProblems(), []);
  const bare = { walls: [], rooms: [], plumbing: { fixtures: [], entry: { x: 0, y: 0, phase: "phase1" } } };
  const sink = fixtureFromClick(bare, { x: 10, y: 0 }, "kitchen-sink");
  const house = { ...bare, plumbing: { ...bare.plumbing, fixtures: [sink] } };
  const design = buildPlumbing(house);
  const cold = design.supply.find((run) => run.service === "cold");
  assert.equal(cold.length, 10);
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("plumbing ok");
