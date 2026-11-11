import assert from "node:assert/strict";
import sample from "../data/sample-house.json" with { type: "json" };
import { decorateHouse } from "../src/build/walls.js";
import { costReport } from "../src/cost/list.js";
import { evaluateRules } from "../src/rules/index.js";
import { SITE_RULES, siteWarnings } from "../src/rules/site.js";
import {
  acres,
  buildSite,
  buildableRing,
  gradePad,
  gravityCheck,
  insetRing,
  pointInRing,
} from "../src/site/design.js";
import { localFeet, ringsFromGeoJson, siteFromRing } from "./fetch-parcel.mjs";

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

const house = decorateHouse(sample);

check("the sample lot is 5 acres and labeled as a sample", () => {
  assert.equal(house.site.sample, true);
  assert.match(house.site.label, /not a real lot/i);
  assert.ok(Math.abs(acres(house.site.parcel.ring) - 5) < 0.01);
  assert.match(house.site.soil.note, /not a web soil survey/i);
  assert.match(house.site.terrain.note, /not a usgs/i);
});

check("the buildable area is inset 20 ft from the road and 5 ft elsewhere", () => {
  const ring = buildableRing(house.site);
  const ys = ring.map((point) => point.y);
  const xs = ring.map((point) => point.x);
  assert.ok(Math.abs(Math.min(...ys) - (-60)) < 0.2);
  assert.ok(Math.abs(Math.min(...xs) - (-155)) < 0.2);
  assert.ok(Math.abs(Math.max(...xs) - 335) < 0.2);
  const view = buildSite(house);
  assert.ok(view.contours.length >= 3);
});

check("a convex inset keeps the sample house inside", () => {
  const ring = insetRing(house.site.parcel.ring, () => 5);
  assert.equal(pointInRing({ x: 38, y: 20 }, ring), true);
  assert.equal(pointInRing({ x: -159, y: 20 }, ring), false);
});

check("gravity uses the building-drain drop and the south slope", () => {
  const gravity = gravityCheck(house);
  assert.ok(Math.abs(gravity.stubInches - 12.76) < 0.05, gravity.stubInches);
  assert.equal(gravity.ok, true);
  assert.ok(gravity.groundInches > gravity.needInches);
});

check("grading reports cut and fill without a price", () => {
  const grade = gradePad(house);
  assert.ok(grade.cutYd > 1);
  assert.ok(grade.fillYd > 1);
  const report = costReport(house);
  const line = report.lines.find((item) => item.id === "grading");
  assert.ok(line);
  assert.equal(line.priceNeeded, true);
  assert.equal(report.lines.some((item) => item.id === "well-drilled" && item.priceNeeded), true);
});

rule("jcc.setback", () => {
  assert.equal(siteWarnings(house).some((item) => item.ruleId === "jcc.setback"), false);
  const moved = decorateHouse(sample);
  moved.walls.push({
    id: "out",
    start: { x: -158, y: 10 },
    end: { x: -158, y: 30 },
    role: "exterior",
    phase: "phase1",
    assemblyId: "hempcrete-exterior",
  });
  const hit = siteWarnings(moved).find((item) => item.ruleId === "jcc.setback");
  assert.equal(hit.severity, "blocker");
  assert.equal(hit.citation.confirmSection, false);
});

rule("jcc.zone-assumed", () => {
  assert.ok(siteWarnings(house).some((item) => item.ruleId === "jcc.zone-assumed"));
});

rule("wac.well-drainfield", () => {
  const close = structuredClone(house);
  close.site.well = { ...close.site.well, x: 40, y: -40 };
  const hit = siteWarnings(close).find((item) => item.ruleId === "wac.well-drainfield");
  assert.equal(hit.severity, "blocker");
  assert.equal(siteWarnings(house).some((item) => item.ruleId === "wac.well-drainfield"), false);
});

rule("wac.well-tank", () => {
  const close = structuredClone(house);
  close.site.well = { ...close.site.well, x: 32, y: -10 };
  assert.ok(siteWarnings(close).some((item) => item.ruleId === "wac.well-tank"));
});

rule("wac.well-building", () => {
  const close = structuredClone(house);
  close.site.well = { ...close.site.well, x: 10, y: 10 };
  assert.ok(siteWarnings(close).some((item) => item.ruleId === "wac.well-building"));
});

rule("wac.drainfield-line", () => {
  const close = structuredClone(house);
  close.site.septic.drainfield = { x: -158, y: -78, width: 10, depth: 10 };
  assert.ok(siteWarnings(close).some((item) => item.ruleId === "wac.drainfield-line"));
});

rule("wac.drainfield-building", () => {
  const close = structuredClone(house);
  close.site.septic.drainfield = { x: 10, y: -5, width: 20, depth: 10 };
  assert.ok(siteWarnings(close).some((item) => item.ruleId === "wac.drainfield-building"));
});

rule("wac.tank-line", () => {
  const close = structuredClone(house);
  close.site.septic.tank = { x: -159, y: -79 };
  assert.ok(siteWarnings(close).some((item) => item.ruleId === "wac.tank-line"));
});

rule("wac.tank-building", () => {
  const close = structuredClone(house);
  close.site.septic.tank = { x: 20, y: 2 };
  assert.ok(siteWarnings(close).some((item) => item.ruleId === "wac.tank-building"));
});

rule("upc.gravity-fall", () => {
  assert.equal(siteWarnings(house).some((item) => item.ruleId === "upc.gravity-fall"), false);
  const uphill = structuredClone(house);
  uphill.site.septic.tank = { x: 32, y: 80 };
  const hit = siteWarnings(uphill).find((item) => item.ruleId === "upc.gravity-fall");
  assert.equal(hit.citation.confirmSection, true);
  assert.match(hit.why, /12\.76/);
});

rule("wac.reserve-area", () => {
  const short = structuredClone(house);
  short.site.septic.reserve = { x: 90, y: -55, width: 10, depth: 10 };
  assert.ok(siteWarnings(short).some((item) => item.ruleId === "wac.reserve-area"));
});

rule("wac.loading-rate", () => {
  const hit = siteWarnings(house).find((item) => item.ruleId === "wac.loading-rate");
  assert.equal(hit.severity, "tip");
  assert.equal(hit.citation.confirmSection, true);
});

check("every site rule has a test", () => {
  for (const id of SITE_RULES) assert.ok(tested.has(id), id);
});

check("the code list includes the sample site tips", () => {
  const findings = evaluateRules(house);
  assert.ok(findings.some((item) => item.ruleId === "wac.loading-rate"));
  assert.ok(findings.some((item) => item.ruleId === "jcc.zone-assumed"));
  assert.equal(findings.some((item) => item.ruleId === "jcc.setback"), false);
});

check("a fetched ring becomes plan feet around the house", () => {
  const geojson = {
    features: [{
      geometry: { type: "Polygon", coordinates: [[[-122.8, 48.05], [-122.79, 48.05], [-122.79, 48.06], [-122.8, 48.06], [-122.8, 48.05]]] },
      properties: { ORIG_PARCEL_ID: "SAMPLE" },
    }],
  };
  const rings = ringsFromGeoJson(geojson);
  assert.equal(rings.length, 1);
  const placed = localFeet(rings[0]);
  assert.ok(placed.ring.length >= 4);
  const doc = siteFromRing(rings[0], { parcelId: "SAMPLE", soil: "Townsend silt loam" });
  assert.equal(doc.site.soil.mapUnitName, "Townsend silt loam");
  assert.equal(doc.site.sample, false);
  const ys = doc.site.parcel.ring.map((point) => point.y);
  assert.ok(Math.abs(Math.min(...ys) - (-80)) < 1);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nsite checks passed");
