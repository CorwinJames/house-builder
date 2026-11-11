import assert from "node:assert/strict";
import sample from "../data/sample-house.json" with { type: "json" };
import { snapToGrid, snapAngle, snapDrawingPoint } from "../src/build/snap.js";
import { openingFits, snapOpeningOffset } from "../src/build/openings.js";
import { addWall, resolveJunctions, decorateHouse, wallsOverlap, cloneHouse } from "../src/build/walls.js";
import { detectFaces, syncRooms } from "../src/build/rooms.js";
import { headerForSpan, suggestAssemblyId, DEFAULT_EXTERIOR_ID, RAMMED_EARTH_ID, INTERIOR_ID, catalogForTool } from "../src/build/catalog.js";
import { evaluateRules } from "../src/rules/index.js";
import { polygonArea } from "../src/lib/geom.js";

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

check("rammed earth is suggested only for a south-facing exterior wall", () => {
  const hemp = DEFAULT_EXTERIOR_ID;
  const south = { x: 0, y: -1 };
  const north = { x: 0, y: 1 };
  const east = { x: 1, y: 0 };
  const west = { x: -1, y: 0 };
  const southWall = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const northWall = [{ x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(suggestAssemblyId(...southWall, hemp, false, south), RAMMED_EARTH_ID);
  assert.equal(suggestAssemblyId(...northWall, hemp, false, north), hemp);
  assert.equal(suggestAssemblyId({ x: 0, y: 0 }, { x: 0, y: 10 }, hemp, false, east), hemp);
  assert.equal(suggestAssemblyId({ x: 10, y: 0 }, { x: 10, y: 10 }, hemp, false, west), hemp);
  const at30 = { x: Math.sin((30 * Math.PI) / 180), y: -Math.cos((30 * Math.PI) / 180) };
  const at31 = { x: Math.sin((31 * Math.PI) / 180), y: -Math.cos((31 * Math.PI) / 180) };
  assert.equal(suggestAssemblyId(...southWall, hemp, false, at30), RAMMED_EARTH_ID);
  assert.equal(suggestAssemblyId(...southWall, hemp, false, at31), hemp);
  assert.equal(suggestAssemblyId(...southWall, INTERIOR_ID, false, south), INTERIOR_ID);
  assert.equal(suggestAssemblyId(...southWall, hemp, true, south), hemp);
});

check("door and window catalogs stay separate", () => {
  const doors = catalogForTool("door");
  const windows = catalogForTool("window");
  assert.ok(doors.length > 0);
  assert.ok(windows.length > 0);
  assert.ok(doors.every((item) => item.type === "door"));
  assert.ok(windows.every((item) => item.type === "window"));
  assert.equal(catalogForTool("wall").length, 0);
});

check("grid snaps to 6 inches", () => {
  assert.equal(snapToGrid(1.2, 0.5), 1);
  assert.equal(snapToGrid(1.3, 0.5), 1.5);
  assert.equal(snapToGrid(-0.2, 0.5), 0);
});

check("angle snap locks to 45 degree stops", () => {
  const snapped = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 }, 0.5);
  assert.equal(snapped.angle, 0);
  assert.equal(snapped.y, 0);
  assert.ok(Math.abs(snapped.length - 10) < 0.01);
  const diagonal = snapAngle({ x: 0, y: 0 }, { x: 8, y: 7 }, 0.5);
  assert.equal(diagonal.angle, 45);
});

check("magnets beat the grid", () => {
  const walls = [{ id: "w", start: { x: 3.1, y: 4 }, end: { x: 9, y: 4 }, thickness: 0.5 }];
  const hit = snapDrawingPoint({ x: 3.3, y: 4.2 }, { grid: 0.5, walls, magnetRadius: 0.75 });
  assert.equal(hit.snapped, "end");
  assert.equal(hit.x, 3.1);
  assert.equal(hit.y, 4);
});

check("opening stays off the corner and off its neighbor", () => {
  const wall = { id: "w", start: { x: 0, y: 0 }, end: { x: 12, y: 0 } };
  const existing = [{ id: "o", wallId: "w", offset: 4, width: 3 }];
  assert.equal(openingFits(wall, existing, 0.1, 3).ok, false);
  assert.equal(openingFits(wall, existing, 0.1, 3).reason, "corner");
  assert.equal(openingFits(wall, existing, 3, 2).ok, false);
  assert.equal(openingFits(wall, existing, 7.2, 3).ok, true);
  const slid = snapOpeningOffset(wall, existing, 4.2, 3, 0.5);
  assert.equal(slid.ok, true);
  assert.ok(slid.offset >= 7 || slid.offset + 3 <= 4);
});

check("header grows with the span and stays a placeholder", () => {
  const small = headerForSpan(3);
  const wide = headerForSpan(8);
  assert.equal(small.placeholder, true);
  assert.match(small.note, /placeholder: needs engineer\/code verification/);
  assert.ok(wide.height > small.height);
});

check("a new wall tees into an existing wall", () => {
  const house = {
    schemaVersion: 2,
    levels: [{ id: "main", plateHeight: 10 }],
    walls: [{
      id: "base",
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
    openings: [{ id: "win", wallId: "base", type: "window", offset: 14, width: 3, height: 4, sill: 2.5, header: headerForSpan(3) }],
    rooms: [],
  };
  const added = addWall(house, { x: 10, y: 0 }, { x: 10, y: 8 }, "interior-partition");
  assert.equal(added.warnings.length, 0);
  const horizontal = added.house.walls.filter((wall) => wall.start.y === 0 && wall.end.y === 0);
  assert.equal(horizontal.length, 2);
  const opening = added.house.openings[0];
  const host = added.house.walls.find((wall) => wall.id === opening.wallId);
  assert.ok(host);
  assert.ok(opening.offset + opening.width <= Math.hypot(host.end.x - host.start.x, host.end.y - host.start.y) + 0.01);
});

check("overlapping walls are refused and reported", () => {
  const house = decorateHouse(sample);
  const south = house.walls.find((wall) => wall.id === "wall-s-p1");
  const added = addWall(house, { ...south.start }, { x: south.start.x + 8, y: south.start.y }, south.assemblyId);
  assert.ok(added.warnings.some((warning) => warning.message.includes("on top")));
  assert.equal(added.house.walls.length, house.walls.length);
  assert.equal(wallsOverlap(south, { ...south, id: "other" }), true);
});

check("a rectangle of walls detects one room", () => {
  const walls = [
    { id: "s", start: { x: 0, y: 0 }, end: { x: 12, y: 0 }, thickness: 0.5 },
    { id: "e", start: { x: 12, y: 0 }, end: { x: 12, y: 10 }, thickness: 0.5 },
    { id: "n", start: { x: 12, y: 10 }, end: { x: 0, y: 10 }, thickness: 0.5 },
    { id: "w", start: { x: 0, y: 10 }, end: { x: 0, y: 0 }, thickness: 0.5 },
  ];
  const faces = detectFaces(walls, 0.2);
  assert.equal(faces.length, 1);
  const area = polygonArea(faces[0].polygon);
  assert.ok(area > 80 && area < 120, `area ${area}`);
});

check("sample walls still enclose the phase 1 rooms", () => {
  const faces = detectFaces(sample.walls, 1);
  assert.ok(faces.length >= 4, `found ${faces.length} faces`);
  const synced = syncRooms({ ...sample, rooms: sample.rooms.map((room) => ({ ...room })) }, faces);
  const names = new Set(synced.rooms.map((room) => room.name));
  for (const name of ["Living room", "Kitchen", "Bathroom", "Bedroom"]) {
    assert.ok(names.has(name), `missing ${name}; have ${[...names].join(", ")}`);
  }
});

check("dragging a tee keeps the joined endpoint shared", () => {
  const house = {
    schemaVersion: 2,
    levels: [{ id: "main", plateHeight: 10 }],
    walls: [],
    openings: [],
    rooms: [],
  };
  const first = addWall(house, { x: 0, y: 0 }, { x: 16, y: 0 }, "hempcrete-exterior");
  const second = addWall(first.house, { x: 8, y: 0 }, { x: 8, y: 10 }, "interior-partition");
  const vertical = second.house.walls.find((wall) => wall.start.x === 8 && wall.end.x === 8);
  assert.ok(vertical);
  const joined = second.house.walls.filter((wall) => (
    (wall.start.x === 8 && wall.start.y === 0) || (wall.end.x === 8 && wall.end.y === 0)
  ));
  assert.ok(joined.length >= 2);
});

check("rules flag a corner-hugging opening and stay silent on the sample", () => {
  const bad = decorateHouse(sample);
  bad.openings.push({
    id: "bad",
    wallId: "wall-s-p1",
    type: "window",
    offset: 0.1,
    width: 2,
    height: 3,
    sill: 2,
    header: headerForSpan(2),
  });
  const warnings = evaluateRules(bad);
  assert.ok(warnings.some((warning) => warning.code === "geometry.corner-clearance"));
  const clean = evaluateRules(decorateHouse(sample)).filter((warning) => String(warning.code || "").startsWith("geometry"));
  assert.equal(clean.length, 0, clean.map((warning) => warning.message).join("; "));
});

check("resolveJunctions is stable on a plain tee", () => {
  const house = cloneHouse({
    schemaVersion: 2,
    levels: [{ id: "main", plateHeight: 10 }],
    walls: [
      {
        id: "a", levelId: "main", start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
        assembly: "framed", assemblyId: "interior-partition", thickness: 0.5, height: 10, phase: "phase1", role: "interior",
      },
      {
        id: "b", levelId: "main", start: { x: 4, y: 0 }, end: { x: 4, y: 6 },
        assembly: "framed", assemblyId: "interior-partition", thickness: 0.5, height: 10, phase: "phase1", role: "interior",
      },
    ],
    openings: [],
    rooms: [],
  });
  resolveJunctions(house, ["a", "b"]);
  assert.ok(house.walls.length >= 3);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\ngeometry ok");
