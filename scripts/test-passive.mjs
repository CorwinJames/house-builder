import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decorateHouse } from "../src/build/walls.js";
import {
  awningFor, climateClass, degreeDays, eaveRangeFor, houseSolar, noonAltitude, wallFacing, windowSolar,
} from "../src/sun/passive.js";
import { sunPatches } from "../src/sun/light.js";
import { sunVector } from "../src/sun/solar.js";
import { roofAt, roofFootprints } from "../src/build/roofShape.js";
import { clerestoryBox, clerestoryEaveRange, clerestoryGeometry } from "../src/build/clerestory.js";
import { clerestoryPatches, glazing } from "../src/sun/light.js";
import { costLines } from "../src/cost/list.js";
import { foldingPanels } from "../src/build/catalog.js";

const sample = JSON.parse(readFileSync(new URL("../data/sample-house.json", import.meta.url)));
const PT = { lat: 48.117, lon: -122.76, name: "Port Townsend" };
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`ok - ${name}`); } catch (error) { failed += 1; console.error(`FAIL - ${name}\n  ${error.message}`); }
}
const fresh = () => decorateHouse(structuredClone(sample));

check("noon sun at Port Townsend", () => {
  assert.ok(Math.abs(noonAltitude(48.117, -23.44) - 18.44) < 0.01);
  assert.ok(Math.abs(noonAltitude(48.117, 23.44) - 65.32) < 0.01);
});

check("degree days and the climate class", () => {
  const warm = degreeDays(Array(3653).fill(30), 10);
  assert.equal(warm.hdd65, 0);
  assert.ok(warm.cdd75 > 2600);
  const house = fresh();
  house.solar = { climate: { hdd65: 7000, cdd75: 0 } };
  assert.equal(climateClass(house).kind, "cold");
  house.solar = { climate: { hdd65: 5000, cdd75: 10 } };
  assert.equal(climateClass(house).kind, "moderate");
  house.solar.climateChoice = "hot";
  assert.equal(climateClass(house).kind, "hot");
});

check("walls face outdoors; a covered patio is outdoors; interior walls are not outside walls", () => {
  const house = fresh();
  const south = house.walls.find((w) => w.id === "wall-s-p1");
  const west = house.walls.find((w) => w.id === "wall-w-p1");
  assert.equal(Math.round(wallFacing(house, south, false).azimuth), 180);
  assert.equal(Math.round(wallFacing(house, west, false).azimuth), 270);
  assert.equal(wallFacing(house, west, false).exterior, true);
  const inner = house.walls.find((w) => w.id === "wall-p1-lk");
  assert.equal(wallFacing(house, inner, false).exterior, false);
  assert.equal(windowSolar(house, house.openings.find((o) => o.id === "open-living-kitchen"), PT), null);
});

check("an awning sized by the rule meets both targets", () => {
  const head = 6.5;
  const sill = 2.5;
  const tanS = Math.tan((65.32 * Math.PI) / 180);
  const tanW = Math.tan((18.44 * Math.PI) / 180);
  const a = awningFor(head, sill, tanS, tanW, 10);
  const zo = head + a.gap;
  assert.ok(Math.abs(zo - a.depth * tanS - sill) < 1e-9, "summer line at the sill");
  assert.ok(Math.abs(zo - a.depth * tanW - head) < 1e-9, "winter line at the head");
  const house = fresh();
  const win = house.openings.find((o) => o.id === "win-living-s");
  win.awning = { depth: a.depth, gap: a.gap };
  const info = windowSolar(house, win, PT);
  assert.ok(info.meetsSummer && info.meetsWinter, JSON.stringify(info.days.map((d) => d.line)));
});

check("the eave range for the south wall, and setting it moves the roof edge", () => {
  const house = fresh();
  const south = house.walls.filter((w) => w.id === "wall-s-p1");
  const range = eaveRangeFor(house, PT, south);
  assert.ok(range.ok && range.min > 0 && range.max > range.min);
  const before = roofFootprints(house, false)[0].y0;
  house.roof.eaves = { south: range.min, north: 1, east: 1, west: 1 };
  const after = roofFootprints(house, false)[0].y0;
  assert.ok(Math.abs(after - (0 - range.min)) < 1e-9, `south edge ${after}`);
  assert.ok(after < before);
  const info = windowSolar(house, house.openings.find((o) => o.id === "win-living-s"), PT);
  assert.ok(info.meetsSummer && info.meetsWinter);
});

check("a deep eave cuts the window's sun patch in summer but not in winter", () => {
  const house = fresh();
  house.roof.eaves = { south: 3.5, north: 1, east: 1, west: 1 };
  const summer = sunPatches(house, { up: true, vector: sunVector(180, 65) }).find((p) => p.openingId === "win-living-s");
  const winter = sunPatches(house, { up: true, vector: sunVector(180, 18.4) }).find((p) => p.openingId === "win-living-s");
  assert.ok(winter && winter.area > 20, "winter sun comes in");
  assert.ok(!summer || summer.area < 2, `summer patch ${summer?.area}`);
});

check("house summary: sun-side glass share and orientation", () => {
  const summary = houseSolar(fresh(), PT, { full: false, phaseVisible: (phase) => phase !== "future" });
  assert.equal(summary.offSouth, 0);
  assert.ok(summary.sunShare > 0.05 && summary.sunShare < 0.08, `sun share ${summary.sunShare}`);
  assert.ok(Math.abs(summary.collectors.spaceHeating - 63.117) < 1e-9);
});

check("a clerestory: heights, roof faces, and winter sun through the band", () => {
  const house = fresh();
  house.roof.clerestory = { face: "south", setback: 12, glass: 3, eave: 2, lowPitch: 0.25 };
  const box = clerestoryBox(roofFootprints(house, false));
  const g = clerestoryGeometry(house, box, false);
  assert.ok(Math.abs(g.stepY - 12) < 1e-9, `glass line ${g.stepY}`);
  assert.ok(Math.abs(g.lowTop - (10 + (12 - box.y0) * 0.25)) < 1e-9);
  assert.equal(g.sill, g.lowTop + 1);
  assert.equal(g.glassTop, g.sill + 3);
  assert.ok(g.upperPitch > 0);
  const low = roofAt(house, { x: 40, y: 5 }, false);
  const high = roofAt(house, { x: 40, y: 25 }, false);
  assert.equal(low.face, "south");
  assert.equal(high.face, "north");
  assert.ok(high.height > low.height);
  // Winter noon sun from the south at 18.4°: light through the band lands north of the glass.
  const patches = clerestoryPatches(house, { up: true, vector: sunVector(180, 30) });
  assert.ok(patches.length > 0 && patches.every((p) => p.polygon.every((q) => q.y > g.stepY)), "the light falls north of the glass");
  assert.equal(clerestoryPatches(house, { up: true, vector: sunVector(0, 30) }).length, 0, "no sun from behind");
  const summary = houseSolar(house, PT, { full: false, phaseVisible: (phase) => phase !== "future" });
  assert.equal(summary.clerestory.side, "sun");
  assert.ok(summary.sunShare > houseSolar(fresh(), PT, { full: false, phaseVisible: (phase) => phase !== "future" }).sunShare);
  const range = clerestoryEaveRange(g, g.sill, Math.tan((65.3 * Math.PI) / 180), Math.tan((18.4 * Math.PI) / 180));
  assert.ok(range.min > 0);
});

check("a folding glass wall: glass for the sun, its own cost line", () => {
  const house = fresh();
  const patio = house.openings.find((o) => o.id === "door-patio");
  patio.style = "folding";
  assert.ok(glazing(patio));
  const lines = costLines(house, { phase: "phase1" });
  assert.ok(lines.find((l) => l.id === "folding-glass-wall")?.quantity === patio.width);
  assert.equal(foldingPanels(16), 5);
});

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("passive ok");
