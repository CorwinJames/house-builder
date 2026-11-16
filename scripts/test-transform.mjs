import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decorateHouse } from "../src/build/walls.js";
import { syncRooms } from "../src/build/rooms.js";
import { polygonArea } from "../src/lib/geom.js";
import {
  duplicateSelection, flipSelection, rotateSelection, selectionBounds, selectionSet, shiftContents, nudgeSelection,
} from "../src/build/transform.js";

const sample = JSON.parse(readFileSync(new URL("../data/sample-house.json", import.meta.url)));
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); } catch (error) { failed += 1; console.error(`FAIL - ${name}\n  ${error.stack}`); }
};
const fresh = () => decorateHouse(structuredClone(sample));
const phase1 = (h) => ({ ...h, rooms: h.rooms, walls: h.walls });
const allPhase1 = (h) => [
  ...h.walls.filter((w) => w.phase !== "future").map((w) => ({ type: "wall", id: w.id })),
  ...h.rooms.filter((r) => r.phase !== "future").map((r) => ({ type: "room", id: r.id })),
];
let n = 0;
const makeId = (prefix) => `${prefix}-t${(n += 1)}`;

check("a room brings its walls, doors, and the furniture inside it", () => {
  const house = fresh();
  house.furniture = [{ id: "bed", kind: "bed", x: 30, y: 10, width: 5, depth: 6.67, rotation: 0 }];
  const set = selectionSet(house, [{ type: "room", id: "living" }]);
  assert.ok(set.walls.has("wall-s-p1"));
  assert.ok(set.pieces.some((p) => p.id === "bed"));
});

check("turning the whole phase-1 core 90° keeps its areas, doors, and turns the bed", () => {
  const house = fresh();
  house.walls = house.walls.filter((w) => w.phase !== "future");
  house.rooms = house.rooms.filter((r) => r.phase !== "future");
  house.openings = house.openings.filter((o) => house.walls.some((w) => w.id === o.wallId));
  house.joins = [];
  house.furniture = [{ id: "bed", kind: "bed", x: 30, y: 10, width: 5, depth: 6.67, rotation: 0 }];
  const picks = allPhase1(house);
  const set = selectionSet(house, picks);
  const before = selectionBounds(house, set);
  const { house: turned, detached } = rotateSelection(house, set, -90);
  const after = selectionBounds(turned, selectionSet(turned, picks));
  assert.ok(Math.abs(after.width - before.depth) < 1e-6 && Math.abs(after.depth - before.width) < 1e-6);
  assert.ok(Math.abs(after.cx - before.cx) < 1e-6 && Math.abs(after.cy - before.cy) < 1e-6, "turns about its middle");
  assert.equal(turned.openings.length, house.openings.length);
  assert.equal(turned.furniture[0].rotation, 270);
  const synced = syncRooms(turned);
  const living = synced.rooms.find((r) => r.id === "living");
  assert.ok(living, "the living room keeps its name and id");
  const area = (h, id) => Math.abs(polygonArea(h.rooms.find((r) => r.id === id).polygon));
  assert.ok(Math.abs(area(synced, "living") - area(syncRooms(house), "living")) < 0.5);
  assert.ok(detached >= 0);
});

check("four quarter turns come back to the start", () => {
  const house = fresh();
  const picks = [{ type: "room", id: "living" }];
  let h = house;
  for (let i = 0; i < 4; i += 1) h = rotateSelection(h, selectionSet(h, picks), 90, { x: 31, y: 10 }, { detach: false }).house;
  const a = house.walls.find((w) => w.id === "wall-s-p1");
  const b = h.walls.find((w) => w.id === "wall-s-p1");
  assert.ok(Math.abs(a.start.x - b.start.x) < 1e-6 && Math.abs(a.end.y - b.end.y) < 1e-6);
});

check("flipping mirrors positions and door swings", () => {
  const house = fresh();
  const set = selectionSet(house, allPhase1(house));
  const box = selectionBounds(house, set);
  const door = house.openings.find((o) => o.swingSide);
  const { house: flipped } = flipSelection(house, set, "horizontal");
  const wallBefore = house.walls.find((w) => w.id === "wall-s-p1");
  const wallAfter = flipped.walls.find((w) => w.id === "wall-s-p1");
  assert.ok(Math.abs(wallAfter.start.x - (2 * box.cx - wallBefore.start.x)) < 1e-6);
  assert.notEqual(flipped.openings.find((o) => o.id === door.id).swingSide, door.swingSide);
});

check("nudging and dragging move contents with the walls", () => {
  const house = fresh();
  house.furniture = [{ id: "bed", kind: "bed", x: 30, y: 10, width: 5, depth: 6.67, rotation: 0 }];
  const set = selectionSet(house, [{ type: "room", id: "living" }]);
  const moved = nudgeSelection(house, set, 1, 0).house;
  assert.equal(moved.furniture[0].x, 31);
  const dragged = shiftContents(house, set, 0, 2);
  assert.equal(dragged.furniture[0].y, 12);
});

check("duplicating makes new walls, doors, and rooms beside the old ones", () => {
  const house = fresh();
  const picks = [{ type: "room", id: "living" }];
  const set = selectionSet(house, picks);
  const { house: copy, picks: made } = duplicateSelection(house, set, 60, 0, makeId);
  assert.equal(copy.walls.length, house.walls.length + set.walls.size);
  assert.ok(copy.openings.length > house.openings.length);
  assert.ok(made.some((p) => p.type === "room"));
  const synced = syncRooms(copy);
  assert.ok(synced.rooms.some((r) => /copy/.test(r.name || "")), "the copy keeps a name");
  assert.ok(copy.joins.length >= house.joins.length);
});

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("transform ok");
