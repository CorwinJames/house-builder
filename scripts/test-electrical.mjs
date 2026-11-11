import assert from "node:assert/strict";
import { costReport, priceProblems } from "../src/cost/list.js";
import {
  buildElectrical,
  deviceFromClick,
  gaugeForAmps,
  loadCalc,
  outletStations,
  suggestRoom,
} from "../src/electrical/design.js";

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

check("a 30A dryer is 10 AWG and a 20A circuit is 12 AWG", () => {
  assert.equal(gaugeForAmps(15), 14);
  assert.equal(gaugeForAmps(20), 12);
  assert.equal(gaugeForAmps(30), 10);
  assert.equal(gaugeForAmps(40), 8);
  const house = {
    walls: [{ id: "w", start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, phase: "phase1", assemblyId: "interior-partition" }],
    rooms: [],
    electrical: {
      panel: { id: "panel", x: 0, y: 0, height: 5, phase: "phase1" },
      devices: [{
        id: "dryer-1",
        kind: "dryer",
        volts: 240,
        x: 10,
        y: 0,
        height: 4,
        phase: "phase1",
        roomRole: "laundry",
      }],
    },
  };
  const circuit = buildElectrical(house).circuits[0];
  assert.equal(circuit.amps, 30);
  assert.equal(circuit.gauge, 10);
  assert.equal(circuit.breakerPoles, 2);
  assert.equal(circuit.dedicated, true);
});

check("a 20 ft wall gets receptacles so no point is more than 6 ft away", () => {
  assert.deepEqual(outletStations(1.5, 6), []);
  assert.deepEqual(outletStations(10, 6), [5]);
  assert.deepEqual(outletStations(20, 6), [6, 14]);
  const room = {
    id: "living",
    name: "Living room",
    phase: "phase1",
    polygon: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ],
  };
  const ghosts = suggestRoom({ walls: [], rooms: [room] }, room);
  assert.equal(ghosts.length, 6);
  assert.ok(ghosts.every((item) => item.kind === "receptacle" && item.ghost));
  const bath = { ...room, id: "bath", name: "Bathroom" };
  const bathGhosts = suggestRoom({ walls: [], rooms: [bath] }, bath);
  assert.equal(bathGhosts.length, 1);
  assert.equal(bathGhosts[0].kind, "gfci");
});

check("a device 10 ft from the panel routes 18.5 ft with the vertical drop", () => {
  const house = {
    walls: [],
    rooms: [],
    electrical: {
      panel: { id: "panel", x: 0, y: 0, height: 5, phase: "phase1" },
      devices: [{
        id: "d",
        kind: "receptacle",
        volts: 120,
        x: 10,
        y: 0,
        height: 1.5,
        phase: "phase1",
        roomRole: "general",
      }],
    },
  };
  const circuit = buildElectrical(house).circuits[0];
  assert.equal(circuit.length, 18.5);
  assert.equal(circuit.gauge, 12);
  assert.equal(circuit.segments[0].drop, 8.5);
  assert.ok(circuit.voltageDrop.percent > 0);
});

check("the dwelling load example recommends a service from the shown steps", () => {
  const house = {
    rooms: [{
      id: "r",
      name: "Living",
      phase: "phase1",
      polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    }],
    electrical: {
      devices: [{ id: "d", kind: "dryer", volts: 240, phase: "phase1" }],
    },
  };
  const load = loadCalc(house);
  assert.equal(load.area, 100);
  assert.equal(load.steps[0].va, 300);
  assert.equal(load.steps[1].va, 3000);
  assert.equal(load.steps[3].va, 5000);
  assert.equal(load.va, 5380);
  assert.equal(load.amps, 22.42);
  assert.equal(load.service, 100);
  assert.match(load.adoption, /WAC 296-46B-010/);
});

check("placing an outlet adds priced wire and changes the total", () => {
  const bare = {
    id: "t",
    name: "Test",
    schemaVersion: 4,
    walls: [],
    openings: [],
    rooms: [],
    footprint: { width: 10, depth: 10 },
    electrical: { panel: null, devices: [], wallMethods: {} },
  };
  const before = costReport(bare).pricedTotal;
  const placed = deviceFromClick(bare, { x: 10, y: 0 }, "receptacle");
  const house = {
    ...bare,
    electrical: {
      panel: { id: "panel", x: 0, y: 0, height: 5, phase: "phase1" },
      devices: [placed],
      wallMethods: {},
    },
  };
  const report = costReport(house);
  const wire = report.lines.find((line) => line.id === "nm-12-2");
  const labor = report.lines.find((line) => line.id === "electrical-labor");
  assert.ok(wire.quantity > 0);
  assert.equal(wire.priceNeeded, false);
  assert.equal(wire.unitPrice, 0.728);
  assert.match(wire.url, /^https:\/\/www\.homedepot\.com\//);
  assert.equal(labor.unitPrice, 114.21);
  assert.match(labor.url, /lni\.wa\.gov/);
  assert.ok(report.pricedTotal > before);
  const permit = report.lines.find((line) => line.id === "electrical-permit");
  assert.equal(permit.priceNeeded, true);
  assert.equal(permit.lineTotal, null);
});

check("new electrical prices keep a source, and unpriced lines have no invented amount", () => {
  assert.deepEqual(priceProblems(), []);
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("electrical ok");
