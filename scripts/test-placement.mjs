import assert from "node:assert/strict";
import { blankPlan } from "../src/build/newPlan.js";
import { DEFAULT_EXTERIOR_ID } from "../src/build/catalog.js";
import { addRoomRectangle } from "../src/build/walls.js";
import { syncRooms } from "../src/build/rooms.js";
import { planToScene, sceneToPlan, pointInRing } from "../src/build/space.js";
import { previewPlacement } from "../src/build/placement.js";
import { suggestPanel, suggestPlacements } from "../src/electrical/design.js";
import { suggestPlacements as suggestFixtures } from "../src/plumbing/design.js";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("ok ", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL", name);
    console.error(error);
  }
}

function squareHouse() {
  const drawn = addRoomRectangle(blankPlan(), { x: 0, y: 0 }, { x: 16, y: 16 }, DEFAULT_EXTERIOR_ID);
  return syncRooms(drawn.house);
}

check("plan and 3D share one transform", () => {
  const scene = planToScene({ x: 4, y: 9 }, 5);
  assert.deepEqual(scene, { x: 4, y: 5, z: -9 });
  assert.deepEqual(sceneToPlan(scene.x, scene.y, scene.z), { x: 4, y: 9 });
});

check("a click inside a drawn room places the panel and sink on the same plan point the 3D view uses", () => {
  const house = squareHouse();
  const room = house.rooms.find((item) => (item.polygon || []).length >= 3);
  assert.ok(room, "a rectangle of walls becomes a room");
  const click = { x: 8, y: 8 };
  const panel = previewPlacement(house, click, { system: "electrical", kind: "panel" });
  const sink = previewPlacement(house, click, { system: "plumbing", kind: "kitchen-sink" });
  assert.equal(panel.ok, true, panel.reason);
  assert.equal(sink.ok, true, sink.reason);
  assert.equal(previewPlacement(house, click, { system: "electrical", kind: "panel" }).x, panel.x);
  assert.equal(previewPlacement(house, click, { system: "electrical", kind: "panel" }).y, panel.y);
  assert.ok(pointInRing(panel, room.polygon), "panel sits inside the room");
  assert.ok(pointInRing(sink, room.polygon), "sink sits inside the room");
  const panelScene = planToScene(panel, 5);
  const sinkScene = planToScene(sink, 0.7);
  assert.deepEqual(sceneToPlan(panelScene.x, panelScene.y, panelScene.z), { x: panel.x, y: panel.y });
  assert.deepEqual(sceneToPlan(sinkScene.x, sinkScene.y, sinkScene.z), { x: sink.x, y: sink.y });
  assert.ok(pointInRing(sceneToPlan(sinkScene.x, sinkScene.y, sinkScene.z), room.polygon));
});

check("a click far from every wall does not place and says why", () => {
  const house = squareHouse();
  const panel = previewPlacement(house, { x: 80, y: 80 }, { system: "electrical", kind: "panel" });
  const sink = previewPlacement(house, { x: 80, y: 80 }, { system: "plumbing", kind: "kitchen-sink" });
  assert.equal(panel.ok, false);
  assert.match(panel.reason, /wall/i);
  assert.equal(sink.ok, false);
  assert.match(sink.reason, /wall/i);
});

check("a blank drawn room can suggest a panel, outlets, and a sink", () => {
  const house = squareHouse();
  const outlets = suggestPlacements(house);
  const panel = suggestPanel(house);
  const fixtures = suggestFixtures(house);
  assert.ok(outlets.length > 0);
  assert.equal(panel?.kind, "panel");
  assert.ok(fixtures.some((item) => item.kind === "kitchen-sink"));
});

check("no walls explains the missing suggestion", () => {
  const note = previewPlacement(blankPlan(), { x: 1, y: 1 }, { system: "electrical", kind: "panel" });
  assert.equal(note.ok, false);
  assert.match(note.reason, /wall/i);
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("placement ok");
