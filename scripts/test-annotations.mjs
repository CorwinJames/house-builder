import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schemas/house.schema.json" with { type: "json" };
import sample from "../data/sample-house.json" with { type: "json" };
import { decorateHouse } from "../src/build/walls.js";
import { furnitureFootprint, roomGroundLine } from "../src/build/annotations.js";
import { headerForSpan } from "../src/build/catalog.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function roof() {
  return {
    id: "roof-main",
    kind: "chinese-hip-and-gable",
    placeholder: true,
    pitch: "6:12",
    pitchRiseOverRun: 0.5,
    overhang: 2,
    plateHeight: 10,
    note: "Placeholder.",
  };
}

function madeUpHouse() {
  const opening = {
    id: "door-1",
    wallId: "wall-s",
    type: "door",
    style: "swing",
    offset: 2,
    width: 3,
    height: 6.67,
    sill: 0,
  };
  opening.header = headerForSpan(opening.width);
  return {
    schemaVersion: 7,
    id: "made-up-marks",
    name: "Made-up plan",
    sample: false,
    disclaimer: "A made-up shape for the annotation test. scale estimated from drawing, confirm one real measurement",
    units: "feet",
    footprint: { width: 20, depth: 12, longAxis: "east-west" },
    phases: {
      phase1: {
        name: "Phase 1",
        bounds: { x0: 0, y0: 0, x1: 20, y1: 12 },
        note: "suggested, Sophie and James to confirm",
      },
    },
    levels: [{ id: "main", name: "Main floor", elevation: 0, plateHeight: 10, floorThickness: 0.5 }],
    walls: [{
      id: "wall-s",
      levelId: "main",
      start: { x: 0, y: 0 },
      end: { x: 20, y: 0 },
      assembly: "hempcrete",
      assemblyId: "hempcrete-exterior",
      thickness: 1,
      height: 10,
      phase: "phase1",
      role: "exterior",
    }],
    rooms: [{
      id: "room-1",
      levelId: "main",
      name: "Music room",
      phase: "phase1",
      polygon: [{ x: 1, y: 1 }, { x: 14, y: 1 }, { x: 14, y: 10 }, { x: 1, y: 10 }],
      finish: "wood",
      conditioned: true,
      groundLevel: "higher ground",
      note: "Made-up room. windows not yet drawn",
    }],
    openings: [opening],
    roof: roof(),
    notes: ["windows not yet drawn", "scale estimated from drawing, confirm one real measurement"],
    furniture: [{
      id: "furn-piano",
      kind: "piano",
      name: "Piano",
      x: 6,
      y: 4,
      rotation: 90,
      width: 5,
      depth: 2,
      roomId: "room-1",
      note: "Made-up icon.",
    }],
    planLabels: [{ id: "label-erv", text: "ERV", x: 2, y: 2, note: "Made-up label." }],
    siteFeatures: [{
      id: "feat-tree",
      kind: "tree",
      name: "Tree",
      x: 16,
      y: 8,
      size: 6,
      note: "Made-up tree.",
    }],
  };
}

const errors = [];
const fail = (message) => errors.push(message);

const house = madeUpHouse();
if (!validate(house)) {
  for (const error of validate.errors) fail(`made-up ${error.instancePath || "/"} ${error.message}`);
}
if (roomGroundLine(house.rooms[0]) !== "higher ground") fail("ground line");
const footprint = furnitureFootprint(house.furniture[0]);
const xs = footprint.map((point) => point.x);
const ys = footprint.map((point) => point.y);
const width = Math.max(...xs) - Math.min(...xs);
const depth = Math.max(...ys) - Math.min(...ys);
if (Math.abs(width - 2) > 0.01 || Math.abs(depth - 5) > 0.01) {
  fail(`rotated piano footprint is ${width} by ${depth}, expected 2 by 5`);
}

const broken = madeUpHouse();
delete broken.furniture[0].name;
if (validate(broken)) fail("furniture without a name should fail");

if (!validate(sample)) {
  for (const error of validate.errors) fail(`sample ${error.instancePath || "/"} ${error.message}`);
}
const migrated = decorateHouse(sample);
if (migrated.schemaVersion !== 7) fail(`migrated version ${migrated.schemaVersion}`);
if (!Array.isArray(migrated.furniture) || migrated.furniture.length !== 0) fail("migration should add an empty furniture list");
if (!Array.isArray(migrated.planLabels) || !Array.isArray(migrated.siteFeatures)) fail("migration should add label lists");
if (!validate(migrated)) {
  for (const error of validate.errors) fail(`migrated sample ${error.instancePath || "/"} ${error.message}`);
}

const older = decorateHouse({ ...madeUpHouse(), schemaVersion: 6, furniture: undefined, planLabels: undefined, siteFeatures: undefined });
if (older.schemaVersion !== 7) fail("version 6 should migrate to 7");
if (older.furniture.length !== 0 || older.planLabels.length !== 0) fail("missing lists should become empty");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("ok  annotations");
