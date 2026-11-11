import assert from "node:assert/strict";
import { evaluateExact, plasticConstant, ratioValue, findRatio, nearestRatio, ratioSeries, nearestMark, snapToRatioLength } from "../src/build/ratios.js";
import { solveConstraints, linkWall, FOOTPRINT_WIDTH, FOOTPRINT_DEPTH } from "../src/build/constraints.js";
import { formatFeetFine } from "../src/lib/format.js";
import { wallLength } from "../src/lib/geom.js";

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

check("exact forms match the named constants", () => {
  const golden = (1 + Math.sqrt(5)) / 2;
  assert.ok(Math.abs(evaluateExact("(1+sqrt(5))/2") - golden) < 1e-12);
  assert.ok(Math.abs(evaluateExact("1+sqrt(2)") - (1 + Math.sqrt(2))) < 1e-12);
  assert.ok(Math.abs(evaluateExact("sqrt(2)") - Math.sqrt(2)) < 1e-12);
  assert.ok(Math.abs(evaluateExact("sqrt(3)") - Math.sqrt(3)) < 1e-12);
  assert.ok(Math.abs(evaluateExact("sqrt(5)") - Math.sqrt(5)) < 1e-12);
  assert.ok(Math.abs(evaluateExact("(3+sqrt(13))/2") - ((3 + Math.sqrt(13)) / 2)) < 1e-12);
  assert.equal(evaluateExact("3/2"), 1.5);
  assert.equal(evaluateExact("4/3"), 4 / 3);
  assert.ok(Math.abs(ratioValue(findRatio("golden")) - golden) < 1e-12);
});

check("plastic constant solves x^3 - x - 1 = 0", () => {
  const plastic = plasticConstant();
  assert.ok(Math.abs(plastic - 1.324717957244746) < 1e-12);
  assert.ok(Math.abs(plastic ** 3 - plastic - 1) < 1e-12);
  assert.ok(Math.abs(ratioValue(findRatio("plastic")) - plastic) < 1e-12);
});

check("nearest ratio names a golden rectangle and a near miss", () => {
  const exact = nearestRatio((1 + Math.sqrt(5)) / 2);
  assert.equal(exact.ratio.id, "golden");
  assert.equal(exact.exact, true);
  const near = nearestRatio(1.59);
  assert.equal(near.ratio.id, "golden");
  assert.equal(near.exact, false);
  assert.ok(near.deviation < 0);
  assert.ok(Math.abs(near.deviation * 100 + 1.7) < 0.15);
});

check("a wall becomes phi times its reference", () => {
  const house = blank();
  house.walls.push(wall("a", 0, 0, 10, 0), wall("b", 0, 2, 4, 2));
  house.constraints = [{
    id: "c",
    targetId: "b",
    referenceId: "a",
    ratioId: "golden",
    operation: "multiply",
  }];
  const solved = solveConstraints(house);
  const length = wallLength(solved.house.walls.find((item) => item.id === "b"));
  assert.ok(Math.abs(length - 10 * (1 + Math.sqrt(5)) / 2) < 1e-9);
  assert.equal(solved.warnings.length, 0);
});

check("divide uses the reciprocal", () => {
  const house = blank();
  house.walls.push(wall("a", 0, 0, 10, 0), wall("b", 0, 2, 30, 2));
  house.constraints = [{
    id: "c", targetId: "b", referenceId: "a", ratioId: "2-1", operation: "divide",
  }];
  const solved = solveConstraints(house);
  assert.ok(Math.abs(wallLength(solved.house.walls.find((item) => item.id === "b")) - 5) < 1e-9);
});

check("cycles are reported and left alone", () => {
  const house = blank();
  house.walls.push(wall("a", 0, 0, 10, 0), wall("b", 0, 2, 6, 2));
  house.constraints = [
    { id: "c1", targetId: "a", referenceId: "b", ratioId: "2-1", operation: "multiply" },
    { id: "c2", targetId: "b", referenceId: "a", ratioId: "2-1", operation: "multiply" },
  ];
  const solved = solveConstraints(house);
  assert.ok(solved.warnings.some((warning) => warning.code === "proportion.cycle"));
  assert.ok(Math.abs(wallLength(solved.house.walls.find((item) => item.id === "a")) - 10) < 1e-9);
  assert.ok(Math.abs(wallLength(solved.house.walls.find((item) => item.id === "b")) - 6) < 1e-9);
});

check("two constraints on one wall conflict", () => {
  const house = blank();
  house.walls.push(wall("a", 0, 0, 8, 0), wall("b", 0, 1, 9, 1), wall("c", 0, 2, 3, 2));
  house.constraints = [
    { id: "c1", targetId: "c", referenceId: "a", ratioId: "1-1", operation: "multiply" },
    { id: "c2", targetId: "c", referenceId: "b", ratioId: "1-1", operation: "multiply" },
  ];
  const solved = solveConstraints(house);
  assert.ok(solved.warnings.some((warning) => warning.code === "proportion.conflict"));
  assert.ok(Math.abs(wallLength(solved.house.walls.find((item) => item.id === "c")) - 8) < 1e-9);
});

check("golden series from a 12 ft module includes phi and phi squared", () => {
  const golden = findRatio("golden");
  const phi = ratioValue(golden);
  const marks = ratioSeries(12, golden, [], "φ");
  const lengths = marks.map((mark) => mark.length);
  assert.ok(lengths.some((length) => Math.abs(length - 12) < 1e-9));
  assert.ok(lengths.some((length) => Math.abs(length - 12 * phi) < 1e-9));
  assert.ok(lengths.some((length) => Math.abs(length - 12 * phi * phi) < 1e-9));
  const snapped = nearestMark(12 * phi + 0.2, marks);
  assert.ok(Math.abs(snapped.length - 12 * phi) < 1e-9);
  const point = snapToRatioLength({ x: 0, y: 0 }, { x: 20, y: 1 }, golden, 12, []);
  assert.equal(point.angle, 0);
  assert.ok(point.ticks.length > 1);
  assert.ok(point.ticks.some((tick) => tick.label.includes("φ")));
});

check("footprint constraint wants phi times the depth and does not run unless asked", () => {
  const house = blank();
  house.footprint = { width: 76, depth: 47, longAxis: "east-west" };
  house.constraints = [{
    id: "footprint-golden",
    targetId: FOOTPRINT_WIDTH,
    referenceId: FOOTPRINT_DEPTH,
    ratioId: "golden",
    operation: "multiply",
  }];
  const held = solveConstraints(house);
  assert.equal(held.house.footprint.width, 76);
  const applied = solveConstraints(house, { includeFootprint: true });
  const expected = 47 * (1 + Math.sqrt(5)) / 2;
  assert.ok(Math.abs(applied.house.footprint.width - expected) < 1e-9);
});

check("linkWall stores the constraint and sets the length", () => {
  const house = blank();
  house.walls.push(wall("a", 0, 0, 10, 0), wall("b", 0, 3, 12, 3));
  const linked = linkWall(house, "b", "a", "sqrt2", "multiply");
  const constraint = linked.constraints.find((item) => item.targetId === "b");
  assert.equal(constraint.ratioId, "sqrt2");
  assert.ok(Math.abs(wallLength(linked.walls.find((item) => item.id === "b")) - 10 * Math.sqrt(2)) < 1e-9);
});

check("construction rounding is to the nearest sixteenth and stays visible", () => {
  const whole = formatFeetFine(10);
  assert.equal(whole.construction, "10'");
  assert.equal(whole.fudged, false);
  const half = formatFeetFine(10.5 / 12);
  assert.equal(half.construction, "0'-10 1/2\"");
  const goldenWidth = 47 * (1 + Math.sqrt(5)) / 2;
  const detail = formatFeetFine(goldenWidth);
  assert.equal(detail.construction, "76'-9/16\"");
  assert.equal(detail.fudged, true);
  assert.match(detail.exact, /76\.0476 ft/);
});

function blank() {
  return {
    schemaVersion: 2,
    footprint: { width: 10, depth: 10, longAxis: "east-west" },
    levels: [{ id: "main", plateHeight: 10 }],
    walls: [],
    rooms: [],
    openings: [],
    constraints: [],
    customRatios: [],
  };
}

function wall(id, x0, y0, x1, y1) {
  return {
    id,
    levelId: "main",
    start: { x: x0, y: y0 },
    end: { x: x1, y: y1 },
    assembly: "framed",
    assemblyId: "interior-partition",
    thickness: 0.5,
    height: 10,
    phase: "phase1",
    role: "interior",
  };
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nratios ok");
