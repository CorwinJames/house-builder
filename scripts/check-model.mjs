import Ajv2020 from "ajv/dist/2020.js";
import house from "../data/sample-house.json" with { type: "json" };
import schema from "../schemas/house.schema.json" with { type: "json" };
import { polygonArea, wallLength } from "../src/lib/geom.js";
import { isFutureShown } from "../src/render/visibility.js";
import { assemblyById } from "../src/build/catalog.js";

const errors = [];
const fail = (message) => errors.push(message);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
if (!validate(house)) {
  for (const error of validate.errors) {
    fail(`schema ${error.instancePath || "/"} ${error.message}`);
  }
}

if (house.schemaVersion !== 2) fail("schemaVersion must be 2");
if (house.sample !== true) fail("sample must be true");
if (house.roof.placeholder !== true) fail("roof.placeholder must stay true until a real roof is designed");
if (house.footprint.width !== 76 || house.footprint.depth !== 47) {
  fail("footprint must stay 76 ft east-west by 47 ft north-south");
}

const core = house.phases.phase1.bounds;
const gross = (core.x1 - core.x0) * (core.y1 - core.y0);
if (gross < 900 || gross > 1200) fail(`phase 1 gross area ${gross} is outside 900–1,200 sq ft`);

const ids = new Set();
for (const collection of ["walls", "rooms", "openings", "levels"]) {
  for (const item of house[collection]) {
    if (ids.has(item.id)) fail(`duplicate id ${item.id}`);
    ids.add(item.id);
  }
}

const levelIds = new Set(house.levels.map((level) => level.id));
const wallById = new Map(house.walls.map((wall) => [wall.id, wall]));

for (const wall of house.walls) {
  if (!levelIds.has(wall.levelId)) fail(`${wall.id} references missing level ${wall.levelId}`);
  if (wallLength(wall) < 0.5) fail(`${wall.id} is too short`);
  const assembly = assemblyById[wall.assemblyId];
  if (!assembly) fail(`${wall.id} has unknown assembly ${wall.assemblyId}`);
  else if (Math.abs(wall.thickness - assembly.thickness) > 0.001) {
    fail(`${wall.id} thickness ${wall.thickness} does not match assembly ${assembly.thickness}`);
  }
  if (assembly && !String(assembly.note || "").includes("placeholder: needs engineer/code verification")) {
    fail(`${assembly.id} is missing the placeholder marker`);
  }
}

for (const opening of house.openings) {
  if (!opening.header?.placeholder) fail(`${opening.id} header must stay a placeholder`);
  if (opening.header && !String(opening.header.note || "").includes("placeholder: needs engineer/code verification")) {
    fail(`${opening.id} header note is missing the placeholder marker`);
  }
}

const expectedAreas = {
  living: 306.1875,
  kitchen: 288.4375,
  bathroom: 98.4375,
  bedroom: 278.4375,
  patio: 506,
  garage: 462,
  office: 276.25,
  "bedroom-2": 216.75,
  laundry: 178.5,
  "hall-bath": 105,
  "primary-bedroom": 332.0625,
  "primary-bath": 88.6875,
};

let phase1Area = 0;
const seenRooms = new Set();
for (const room of house.rooms) {
  if (!levelIds.has(room.levelId)) fail(`${room.id} references missing level ${room.levelId}`);
  const area = polygonArea(room.polygon);
  seenRooms.add(room.id);
  const expected = expectedAreas[room.id];
  if (expected == null) fail(`unexpected room ${room.id}`);
  else if (Math.abs(area - expected) > 0.05) fail(`${room.id} area ${area} != ${expected}`);
  if (room.phase === "phase1") phase1Area += area;
  const xs = room.polygon.map((point) => point.x);
  const ys = room.polygon.map((point) => point.y);
  if (Math.min(...xs) < -0.01 || Math.min(...ys) < -0.01) fail(`${room.id} leaves the footprint`);
  if (Math.max(...xs) > house.footprint.width + 0.01) fail(`${room.id} is east of the footprint`);
  if (Math.max(...ys) > house.footprint.depth + 0.01) fail(`${room.id} is north of the footprint`);
}
for (const id of Object.keys(expectedAreas)) {
  if (!seenRooms.has(id)) fail(`missing room ${id}`);
}
if (phase1Area < 900 || phase1Area > 1200) {
  fail(`phase 1 room area ${phase1Area} is outside 900–1,200 sq ft`);
}

const openingsByWall = new Map();
for (const opening of house.openings) {
  const wall = wallById.get(opening.wallId);
  if (!wall) {
    fail(`${opening.id} references missing wall ${opening.wallId}`);
    continue;
  }
  if (!openingsByWall.has(wall.id)) openingsByWall.set(wall.id, []);
  openingsByWall.get(wall.id).push(opening);
  if (opening.sill + opening.height > wall.height + 0.02) {
    fail(`${opening.id} is taller than ${wall.id}`);
  }
}

for (const [wallId, openings] of openingsByWall) {
  const wall = wallById.get(wallId);
  const length = wallLength(wall);
  const sorted = openings.slice().sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  for (const opening of sorted) {
    if (opening.offset < cursor - 0.02) fail(`${opening.id} overlaps another opening on ${wallId}`);
    if (opening.offset + opening.width > length + 0.02) fail(`${opening.id} runs past the end of ${wallId}`);
    cursor = opening.offset + opening.width;
  }
}

const south = wallById.get("wall-s-p1");
const north = wallById.get("wall-n-p1");
const west = wallById.get("wall-w-p1");
const east = wallById.get("wall-e-p1");
if (Math.abs(south.start.y - south.thickness / 2 - core.y0) > 0.01) fail("south wall outer face is not the phase 1 south bound");
if (Math.abs(north.start.y + north.thickness / 2 - core.y1) > 0.01) fail("north wall outer face is not the phase 1 north bound");
if (Math.abs(west.start.x - west.thickness / 2 - core.x0) > 0.01) fail("west wall outer face is not the phase 1 west bound");
if (Math.abs(east.start.x + east.thickness / 2 - core.x1) > 0.01) fail("east wall outer face is not the phase 1 east bound");

function walkKeys(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (/price|cost|usd|dollar/i.test(key)) fail(`do not store prices (${path}.${key})`);
    walkKeys(value[key], `${path}.${key}`);
  }
}
walkKeys(house, "house");

const hidden = isFutureShown({ phase: "phase1", layers: { future: true } });
const shown = isFutureShown({ phase: "full", layers: { future: true } });
const layerOff = isFutureShown({ phase: "full", layers: { future: false } });
if (hidden || !shown || layerOff) fail("future visibility rule is wrong");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("sample house ok");
console.log(`phase 1 gross ${gross} sq ft, phase 1 rooms ${phase1Area} sq ft`);
for (const room of house.rooms) {
  console.log(`  ${room.id}: ${polygonArea(room.polygon).toFixed(2)} sq ft (${room.phase})`);
}
