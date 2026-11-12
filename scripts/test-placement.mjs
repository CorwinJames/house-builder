import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankPlan } from "../src/build/newPlan.js";
import { DEFAULT_EXTERIOR_ID } from "../src/build/catalog.js";
import { addRoomRectangle } from "../src/build/walls.js";
import { syncRooms } from "../src/build/rooms.js";
import { planToScene, sceneToPlan, pointInRing } from "../src/build/space.js";
import { previewPlacement } from "../src/build/placement.js";
import { planDimensions } from "../src/render/dimensions.js";
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
  assert.ok(Math.hypot(panel.x - 80, panel.y - 80) < 0.1, "a rejected ghost stays at the click");
});

check("a click on a room corner snaps onto a wall", () => {
  const house = squareHouse();
  const corner = previewPlacement(house, { x: 0, y: 0 }, { system: "electrical", kind: "panel" });
  const beside = previewPlacement(house, { x: -0.6, y: 0.4 }, { system: "electrical", kind: "panel" });
  assert.equal(corner.ok, true, corner.reason);
  assert.equal(beside.ok, true, beside.reason);
  assert.ok(corner.wallId);
  assert.ok(beside.wallId);
});

check("a drawn room is dimensioned from its walls, not the stored footprint", () => {
  const house = squareHouse();
  const dims = planDimensions(house, true);
  const horizontal = dims.filter((dim) => dim.y0 === dim.y1);
  const vertical = dims.filter((dim) => dim.x0 === dim.x1);
  assert.equal(horizontal.length, 2);
  assert.equal(vertical.length, 2);
  const faces = new Set(dims.map((dim) => dim.face));
  assert.deepEqual(faces, new Set(["inside", "outside"]));
  for (const dim of dims) {
    const length = Math.hypot(dim.x1 - dim.x0, dim.y1 - dim.y0);
    assert.ok(length < 20, `dimension ${length} stays on the 16 ft room`);
    assert.ok(dim.x0 > -2 && dim.x1 < 20 && dim.y0 > -2 && dim.y1 < 20);
  }
  const insideW = horizontal.find((dim) => dim.face === "inside");
  const outsideW = horizontal.find((dim) => dim.face === "outside");
  assert.ok(Math.abs(outsideW.x1 - outsideW.x0) > Math.abs(insideW.x1 - insideW.x0));
  const filled = blankPlan();
  filled.rooms = [{
    id: "room",
    name: "Room",
    outdoor: false,
    phase: "phase1",
    polygon: [
      { x: 0, y: 0 },
      { x: 36, y: 0 },
      { x: 36, y: 24 },
      { x: 0, y: 24 },
    ],
  }];
  const plain = planDimensions(filled, true);
  assert.equal(plain.length, 2);
  assert.ok(plain.every((dim) => !dim.face));
});

check("the sample house is dimensioned from its walls", () => {
  const house = JSON.parse(readFileSync(new URL("../data/sample-house.json", import.meta.url), "utf8"));
  const full = planDimensions(house, true);
  const widths = full.filter((dim) => dim.y0 === dim.y1).map((dim) => Math.abs(dim.x1 - dim.x0));
  assert.ok(widths.some((length) => Math.abs(length - 76) < 0.6), `outside width ${widths}`);
  assert.ok(full.every((dim) => dim.x1 - dim.x0 < 76.6 && dim.y1 - dim.y0 < 47.6));
  assert.ok(full.filter((dim) => dim.face === "outside").length === 2);
  assert.ok(full.filter((dim) => dim.face === "inside").length === 2);
  const phase = planDimensions(house, false);
  const phaseWidths = phase.filter((dim) => dim.y0 === dim.y1).map((dim) => Math.abs(dim.x1 - dim.x0));
  assert.ok(phaseWidths.every((length) => length < 40), `phase 1 stays off the full footprint ${phaseWidths}`);
});

check("a blank drawn room can suggest a panel, outlets, and a sink", () => {
  const house = squareHouse();
  const outlets = suggestPlacements(house);
  const panel = suggestPanel(house);
  const fixtures = suggestFixtures(house);
  assert.ok(outlets.length > 0);
  assert.equal(outlets.note, "");
  assert.equal(panel?.kind, "panel");
  assert.ok(fixtures.some((item) => item.kind === "kitchen-sink"));
  assert.equal(fixtures.note, "");
});

check("a light in an empty room does not count as outlets", () => {
  const house = squareHouse();
  const room = house.rooms[0];
  house.electrical = house.electrical || { devices: [] };
  house.electrical.devices = [{
    id: "light-1",
    kind: "light",
    roomId: room.id,
    roomRole: "general",
    ghost: false,
    x: 8,
    y: 8,
  }];
  const outlets = suggestPlacements(house);
  assert.ok(outlets.length > 0);
  assert.doesNotMatch(outlets.note || "", /already has outlets/i);
  house.electrical.devices.push({
    id: "out-1",
    kind: "receptacle",
    roomId: room.id,
    roomRole: "general",
    ghost: false,
    x: 1,
    y: 1,
  });
  const full = suggestPlacements(house);
  assert.equal(full.length, 0);
  assert.match(full.note, /already has outlets/i);
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
