import assert from "node:assert/strict";
import sample from "../data/sample-house.json" with { type: "json" };
import { snapToGrid, snapAngle, snapDrawingPoint, placePoint } from "../src/build/snap.js";
import {
  describeWall,
  headingDeg,
  measureLabel,
  parseAngle,
  parseLength,
  plainFeet,
  pointAt,
  setWallMeasure,
} from "../src/build/angle.js";
import { tidyHouse } from "../src/build/tidy.js";
import { openingFits, snapOpeningOffset } from "../src/build/openings.js";
import { addWall, resolveJunctions, decorateHouse, wallsOverlap, cloneHouse } from "../src/build/walls.js";
import { detectFaces, syncRooms } from "../src/build/rooms.js";
import { headerForSpan, suggestAssemblyId, DEFAULT_EXTERIOR_ID, RAMMED_EARTH_ID, INTERIOR_ID, catalogForTool } from "../src/build/catalog.js";
import { evaluateRules } from "../src/rules/index.js";
import { polygonArea } from "../src/lib/geom.js";
import { pieceOutline, wallJoints } from "../src/build/joins.js";
import { ratioWallEnd, shapedRoomCorner } from "../src/build/shapeTools.js";

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

check("wall angle is measured east, turning counterclockwise", () => {
  assert.equal(Math.round(headingDeg({ x: 0, y: 0 }, { x: 10, y: 0 })), 0);
  assert.equal(Math.round(headingDeg({ x: 0, y: 0 }, { x: 0, y: 10 })), 90);
  assert.equal(Math.round(headingDeg({ x: 0, y: 0 }, { x: -10, y: 0 })), 180);
  const north = pointAt({ x: 0, y: 0 }, 10, 90);
  assert.ok(Math.abs(north.x) < 1e-6);
  assert.ok(Math.abs(north.y - 10) < 1e-6);
  assert.equal(parseLength("12 ft 4 in"), 12 + 4 / 12);
  assert.equal(parseLength("12.5"), 12.5);
  assert.equal(parseLength("12'4\""), 12 + 4 / 12);
  assert.equal(parseLength("12 4"), 12 + 4 / 12);
  assert.equal(parseAngle("37°"), 37);
  assert.equal(plainFeet(12 + 4 / 12), "12 ft 4 in");
  assert.equal(measureLabel(12 + 4 / 12, 37, 91), "12 ft 4 in at 37°, 91° from the wall it meets");
  const house = {
    walls: [
      { id: "east", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { id: "north", start: { x: 0, y: 0 }, end: { x: 0, y: 8 } },
    ],
  };
  const joined = describeWall(house.walls[1].start, house.walls[1].end, house, "north");
  assert.equal(Math.round(joined.angle), 90);
  assert.equal(Math.round(joined.joinAngle), 90);
  const offset = describeWall({ x: 0, y: 0 }, { x: 10, y: 0 }, {
    walls: [
      { id: "south", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { id: "east", start: { x: 10.6, y: 0.6 }, end: { x: 10.6, y: 8 } },
      { id: "more", start: { x: 10, y: 0 }, end: { x: 16, y: 0 } },
    ],
  }, "south");
  assert.ok(offset.joinAngle > 70 && offset.joinAngle < 110, offset.joinAngle);
  const turned = setWallMeasure({
    walls: [
      { id: "a", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { id: "b", start: { x: 10, y: 0 }, end: { x: 10, y: 6 } },
    ],
  }, "a", 10, 90, "end");
  const a = turned.walls.find((wall) => wall.id === "a");
  const b = turned.walls.find((wall) => wall.id === "b");
  assert.ok(Math.abs(a.start.x) < 1e-6 && Math.abs(a.start.y) < 1e-6);
  assert.ok(Math.abs(a.end.x) < 1e-6 && Math.abs(a.end.y - 10) < 1e-6);
  assert.ok(Math.abs(b.start.x - a.end.x) < 1e-6 && Math.abs(b.start.y - a.end.y) < 1e-6);
  assert.ok(Math.abs(b.end.x - 10) < 1e-6 && Math.abs(b.end.y - 6) < 1e-6);
});

check("free placement keeps the cursor", () => {
  const hit = placePoint({ x: 3.141, y: 2.718 }, { snap: false, origin: { x: 0, y: 0 } });
  assert.equal(hit.snapped, "free");
  assert.equal(hit.x, 3.141);
  assert.equal(hit.y, 2.718);
});

check("opt-in snap uses a fine grid and only nearby angles", () => {
  const near = placePoint({ x: 10.04, y: 0.4 }, { snap: true, grid: 1 / 12, origin: { x: 0, y: 0 }, walls: [], magnetFeet: 0 });
  assert.equal(near.snapped, "angle");
  assert.ok(Math.abs(near.y) < 1e-6);
  const slant = placePoint({ x: 10, y: 4 }, { snap: true, grid: 1 / 12, origin: { x: 0, y: 0 }, walls: [], magnetFeet: 0 });
  assert.equal(slant.snapped, "grid");
  const magnet = placePoint({ x: 3.2, y: 4.1 }, {
    snap: true,
    grid: 1 / 12,
    walls: [{ id: "w", start: { x: 3.1, y: 4 }, end: { x: 9, y: 4 } }],
    magnetFeet: 0.5,
  });
  assert.equal(magnet.snapped, "end");
  assert.equal(magnet.x, 3.1);
  assert.equal(magnet.y, 4);
});

check("tidy squares a near-rectangle and keeps corners joined", () => {
  const house = {
    walls: [
      { id: "a", start: { x: 0.04, y: 0.08 }, end: { x: 10.12, y: 0.2 } },
      { id: "b", start: { x: 10.12, y: 0.2 }, end: { x: 10.28, y: 8.06 } },
      { id: "c", start: { x: 10.28, y: 8.06 }, end: { x: 0.1, y: 8.22 } },
      { id: "d", start: { x: 0.1, y: 8.22 }, end: { x: 0.04, y: 0.08 } },
    ],
  };
  const next = tidyHouse(house, ["a", "b", "c", "d"]);
  for (const wall of next.walls) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    assert.ok(Math.abs(dx) < 0.02 || Math.abs(dy) < 0.02, wall.id);
    const len = Math.hypot(dx, dy);
    assert.ok(Math.abs(len * 4 - Math.round(len * 4)) < 0.02, `${wall.id} ${len}`);
  }
  const corners = next.walls.flatMap((wall) => [wall.start, wall.end]);
  for (const point of corners) {
    const hits = corners.filter((other) => Math.hypot(other.x - point.x, other.y - point.y) < 0.02);
    assert.ok(hits.length >= 2);
  }
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

const close = (a, b, msg) => {
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const jw = (id, sx, sy, ex, ey, thickness = 1) => ({ id, start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness });

check("an L corner closes with a mitered outside corner", () => {
  const a = jw("a", 0, 0, 10, 0);
  const b = jw("b", 10, 0, 10, 8);
  const joints = wallJoints([a, b]);
  // Wall a runs east. Its left (+n) is north, the inside of the corner.
  close(joints.get("a").end.left, { x: 9.5, y: 0.5 }, "inside corner");
  close(joints.get("a").end.right, { x: 10.5, y: -0.5 }, "outside corner");
  // Wall b shares the same two corner points, so there is no notch and no overlap.
  close(joints.get("b").start.right, { x: 10.5, y: -0.5 }, "b outside");
  close(joints.get("b").start.left, { x: 9.5, y: 0.5 }, "b inside");
  // The free ends stay square.
  close(joints.get("a").start.left, { x: 0, y: 0.5 }, "free end");
});

check("a wall that tees into another stops at its face", () => {
  const a = jw("a", 0, 0, 10, 0);
  const t = jw("t", 4, 0, 4, 6, 0.5);
  const outline = pieceOutline(t, 0, 6, wallJoints([a, t]).get("t"));
  close(outline[0], { x: 3.75, y: 0.5 }, "tee left");
  close(outline[3], { x: 4.25, y: 0.5 }, "tee right");
});

check("a straight run of two walls stays square at the join", () => {
  const a = jw("a", 0, 0, 5, 0);
  const b = jw("b", 5, 0, 10, 0);
  const joints = wallJoints([a, b]);
  close(joints.get("a").end.left, { x: 5, y: 0.5 }, "straight");
});

check("a wall end near another wall end clicks onto it even with snap off", () => {
  const walls = [jw("a", 0, 0, 10, 0)];
  const free = placePoint({ x: 10.3, y: 0.2 }, { walls, snap: false });
  assert.equal(free.snapped, "free");
  const joined = placePoint({ x: 10.3, y: 0.2 }, { walls, snap: false, endMagnetFeet: 0.5 });
  assert.equal(joined.snapped, "end");
  assert.equal(joined.x, 10);
  assert.equal(joined.y, 0);
  const far = placePoint({ x: 12, y: 0.2 }, { walls, snap: false, endMagnetFeet: 0.5 });
  assert.equal(far.snapped, "free");
});

check("a shaped room keeps its ratio inside the walls", () => {
  const phi = (1 + Math.sqrt(5)) / 2;
  // 1 ft walls all round, except an 18 in south wall.
  const thickness = (out) => (out.y === -1 ? 1.5 : 1);
  const corner = shapedRoomCorner({ x: 0, y: 0 }, { x: 20, y: 5 }, phi, thickness);
  assert.ok(Math.abs(corner.insideWidth / corner.insideDepth - phi) < 1e-9);
  assert.ok(Math.abs(corner.x - 20) < 1e-9, "the long side follows the cursor");
  assert.ok(Math.abs(corner.y - (corner.insideDepth + 1.25)) < 1e-9, "the short side adds half of each wall");
  const tall = shapedRoomCorner({ x: 0, y: 0 }, { x: -3, y: -12 }, 1.5);
  assert.ok(tall.x < 0 && tall.y === -12, "dragging down and left still works");
  assert.ok(Math.abs(tall.insideDepth / tall.insideWidth - 1.5) < 1e-9);
});

check("a ratio wall is the joined wall times or divided by the ratio, nearest the cursor", () => {
  const phi = (1 + Math.sqrt(5)) / 2;
  const longer = ratioWallEnd({ x: 0, y: 0 }, { x: 0, y: 17 }, 10, phi);
  assert.equal(longer.relation, "times");
  assert.ok(Math.abs(longer.length - 10 * phi) < 1e-9);
  assert.ok(Math.abs(longer.x) < 1e-9 && Math.abs(longer.y - 10 * phi) < 1e-9);
  const shorter = ratioWallEnd({ x: 0, y: 0 }, { x: 6, y: 0 }, 10, phi);
  assert.equal(shorter.relation, "over");
  assert.ok(Math.abs(shorter.length - 10 / phi) < 1e-9);
  assert.equal(ratioWallEnd({ x: 0, y: 0 }, { x: 3, y: 0 }, 10, 1).relation, "same");
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\ngeometry ok");
