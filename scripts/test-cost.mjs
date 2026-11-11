import assert from "node:assert/strict";
import { hempcreteVolume } from "../src/cost/takeoff.js";
import { costReport, effectiveRecord, materialsDocument, priceProblems } from "../src/cost/list.js";

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

const wall = {
  id: "w",
  assemblyId: "hempcrete-exterior",
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  height: 10,
  thickness: 1,
  phase: "phase1",
  role: "exterior",
};

function houseWith(walls, openings = [], rooms = []) {
  return {
    id: "t",
    name: "Test",
    schemaVersion: 3,
    walls,
    openings,
    rooms,
    footprint: { width: 10, depth: 10 },
    cost: { diyFinish: true, overrides: [], rates: [] },
  };
}

check("a 10 by 10 hempcrete wall holds 75 cubic feet", () => {
  assert.equal(hempcreteVolume(wall, []), 75);
  const opened = hempcreteVolume(wall, [{ width: 2, height: 4, offset: 1 }]);
  assert.equal(opened, 69);
});

check("binder bags follow the published 4.5 cubic foot yield", () => {
  const report = costReport(houseWith([wall]));
  const binder = report.lines.find((line) => line.id === "hemp-binder");
  assert.equal(binder.quantity, Math.ceil((75 * 1.1) / 4.5));
  assert.equal(binder.unitPrice, 45);
  assert.equal(binder.lineTotal, binder.quantity * 45);
  assert.equal(binder.priceNeeded, false);
  assert.match(binder.url, /^https:\/\//);
});

check("a longer wall raises the priced total", () => {
  const short = costReport(houseWith([wall])).pricedTotal;
  const long = costReport(houseWith([{ ...wall, end: { x: 20, y: 0 } }])).pricedTotal;
  assert.ok(long > short);
});

check("phase 1 leaves out a future wall", () => {
  const future = { ...wall, id: "f", phase: "future", start: { x: 0, y: 2 }, end: { x: 10, y: 2 } };
  const both = houseWith([wall, future]);
  const phase1 = costReport(both, { phase: "phase1" }).pricedTotal;
  const full = costReport(both, { phase: "full" }).pricedTotal;
  assert.ok(full > phase1);
});

check("unpriced lines stay out of the total and are counted", () => {
  const report = costReport(houseWith([wall], [{ id: "d", wallId: "w", type: "door", width: 3, height: 6.667, offset: 2, header: { label: "2-2x10" } }]));
  const door = report.lines.find((line) => line.id === "door-unit");
  assert.equal(door.priceNeeded, true);
  assert.equal(door.lineTotal, null);
  assert.ok(report.unpricedCount >= 1);
  assert.equal(report.lines.filter((line) => line.priceNeeded).reduce((sum, line) => sum + (line.lineTotal || 0), 0), 0);
});

check("a bid replaces a published price", () => {
  const bid = effectiveRecord("hemp-binder", [{
    priceId: "hemp-binder",
    amount: 10,
    sourceType: "bid",
    note: "Local bid",
    date: "2026-11-11",
  }]);
  assert.equal(bid.amount, 10);
  assert.equal(bid.sourceType, "bid");
  const report = costReport(houseWith([wall]), { overrides: [{ priceId: "hemp-binder", amount: 10, sourceType: "bid", note: "Local bid", date: "2026-11-11" }] });
  const binder = report.lines.find((line) => line.id === "hemp-binder");
  assert.equal(binder.unitPrice, 10);
});

check("James's finish labor is free until it is hired out", () => {
  const rooms = [{ id: "r", phase: "phase1", finish: "wood", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }];
  const diy = costReport(houseWith([wall], [], rooms), { hireFinish: false });
  const hired = costReport(houseWith([wall], [], rooms), { hireFinish: true });
  const diyPaint = diy.lines.find((line) => line.id === "paint-labor");
  const hiredPaint = hired.lines.find((line) => line.id === "paint-labor");
  assert.equal(diyPaint.lineTotal, 0);
  assert.match(diyPaint.name, /DIY/);
  assert.ok(hiredPaint.lineTotal > 0);
});

check("every priced record has a source, URL, and date", () => {
  assert.deepEqual(priceProblems(), []);
  const broken = priceProblems([{
    id: "x",
    sourceName: "",
    dateChecked: "",
    unit: "bag",
    kind: "material",
    sourceType: "published-price",
    amount: 1,
    url: "",
  }]);
  assert.ok(broken.some((item) => item.includes("source")));
  assert.ok(broken.some((item) => item.includes("date")));
  assert.ok(broken.some((item) => item.includes("URL")));
});

check("the materials export keeps unpriced lines and the format id", () => {
  const doc = materialsDocument(houseWith([wall]), { phase: "phase1" });
  assert.equal(doc.format, "house-builder.materials");
  assert.equal(doc.formatVersion, 1);
  assert.ok(doc.lines.some((line) => line.priceNeeded));
  assert.equal(typeof doc.pricedTotal, "number");
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("cost ok");
