import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import schema from "../schemas/house.schema.json" with { type: "json" };
import sample from "../data/sample-house.json" with { type: "json" };
import { decorateHouse } from "../src/build/walls.js";
import { rasterSegments, svgSegments, planFromSegments, pathLines, parseTransform, sizedSvg } from "../src/build/trace.js";
import { addTracedPlan, imageToPlan, planToImage, rescaleImage, segmentsToFeet, makeImage, imagePxPerFt } from "../src/build/images.js";
import { makeFurnishing, syncFurnishings, FURNISHINGS, furnishPose } from "../src/build/furnish.js";

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const blank = () => {
  const h = decorateHouse(sample);
  return { ...h, walls: [], rooms: [], openings: [], joins: [], furniture: [], skylights: [], electrical: { ...h.electrical, devices: [] }, plumbing: { ...h.plumbing, fixtures: [] } };
};
let n = 0;
const id = (p) => `${p}-x${++n}`;

// ---- a picture: 30 x 20 ft house at 10 px/ft, walls drawn as two 2 px lines.
const PX = 10;
const W = 400;
const H = 300;
const data = new Uint8ClampedArray(W * H * 4); // all clear (see-through)
const ink = (x0, y0, x1, y1) => {
  for (let y = Math.round(y0); y < Math.round(y1); y += 1) for (let x = Math.round(x0); x < Math.round(x1); x += 1) {
    const i = (y * W + x) * 4;
    data[i] = 20; data[i + 1] = 20; data[i + 2] = 20; data[i + 3] = 255;
  }
};
const ox = 50;
const oy = 50;
const hline = (x0, x1, y) => ink(ox + x0 * PX, oy + y * PX, ox + x1 * PX, oy + y * PX + 2);
const vline = (x, y0, y1) => ink(ox + x * PX, oy + y0 * PX, ox + x * PX + 2, oy + y1 * PX);
// Outer face 0..30 x 0..20 (y down in the picture), inner face 1 ft in.
hline(0, 30, 0); hline(1, 29, 1);             // north wall
vline(0, 0, 20); vline(1, 1, 19);             // west wall
vline(29, 1, 19); vline(30, 0, 20);           // east wall
// South wall with a 3 ft door gap from x=8 to x=11.
hline(0, 8, 20); hline(11, 30, 20); hline(1, 8, 19); hline(11, 29, 19);
// Partition at x = 15..15.5, with a 3 ft gap from y=6 to 9.
vline(15, 1, 6); vline(15, 9, 19); vline(15.5, 1, 6); vline(15.5, 9, 19);
const segs = rasterSegments({ width: W, height: H, data }, { pxPerFt: PX });
assert.ok(segs.length >= 10, `raster found ${segs.length} strokes`);
const image = makeImage({ src: "data:,", pxWidth: W, pxHeight: H }, { x: 100, y: 100 }, W / PX, "img-1");
assert.equal(imagePxPerFt(image), PX);
const back = planToImage(image, imageToPlan(image, 0.3, 0.7));
assert.ok(Math.abs(back.u - 0.3) < 1e-9 && Math.abs(back.v - 0.7) < 1e-9);
const plan = planFromSegments(segmentsToFeet(image, segs), { doors: true });
assert.equal(plan.openings.length, 2, `two doors, got ${JSON.stringify(plan.openings)}`);
for (const o of plan.openings) assert.ok(Math.abs(o.width - 3) < 0.4, `door width ${o.width}`);
const walls = plan.walls;
assert.ok(walls.length >= 5 && walls.length <= 7, `walls ${walls.length}`);
assert.ok(walls.every((w) => w.paired), "double lines became single walls");
const result = addTracedPlan(blank(), plan, { makeId: id });
assert.ok(validate(result.house), JSON.stringify(validate.errors?.slice(0, 3)));
assert.equal(result.counts.rooms, 2, `two rooms, got ${result.counts.rooms}`);
assert.equal(result.counts.doors, 2);
const roles = result.house.walls.map((w) => w.role);
assert.ok(roles.includes("exterior") && roles.includes("interior"), "outside walls and a partition");
// Walls only: no doors, the gaps stay open.
const plain = planFromSegments(segmentsToFeet(image, segs), { doors: false });
assert.equal(plain.openings.length, 0);

// ---- SVG: a single-line drawing with a transform, a door swing arc, and a door leaf.
const svg = `<svg width="100%" height="100%" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg">
  <g transform="matrix(1,0,0,1,0,0)">
    <path d="M0,0 L300,0 L300,200 L190,200 M160,200 L0,200 L0,0" style="fill:none;stroke:#000;stroke-width:2px"/>
    <line x1="150" y1="0" x2="150" y2="200" stroke="black"/>
    <path d="M160,200 A30,30 0 0,1 190,170" fill="none" stroke="black"/>
    <line x1="190" y1="200" x2="190" y2="170" stroke="black"/>
  </g>
  <defs><rect x="0" y="0" width="999" height="999"/></defs>
</svg>`;
const parsed = svgSegments(svg);
assert.deepEqual(parsed.box, { x: 0, y: 0, w: 300, h: 200 });
const svgImage = makeImage({ src: "data:,", pxWidth: 300, pxHeight: 200 }, { x: 0, y: 0 }, 30, "img-2");
const svgPlan = planFromSegments(segmentsToFeet(svgImage, parsed.segments), { doors: true });
assert.equal(svgPlan.openings.length, 1, "the gap in the south wall is a door");
assert.ok(Math.abs(svgPlan.openings[0].width - 3) < 0.01);
assert.equal(svgPlan.walls.length, 5, `door leaf dropped, got ${svgPlan.walls.length}`);
const svgHouse = addTracedPlan(blank(), svgPlan, { makeId: id });
assert.equal(svgHouse.counts.rooms, 2);
assert.deepEqual(pathLines("M0 0 h10 v10 c1 1 2 2 3 3 l5 0 z").length, 4);
const rot = parseTransform("rotate(90)");
assert.ok(Math.abs(rot[1] - 1) < 1e-9);
assert.ok(sizedSvg(svg, 600, 400).includes('width="600" height="400"'));
// Angled walls stay angled.
const angled = planFromSegments([{ a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, thick: 0 }, { a: { x: 10, y: 10 }, b: { x: 20, y: 0 }, thick: 0 }]);
assert.equal(angled.walls.length, 2);

// ---- scale: a 15 ft line becomes 30 ft.
const scaled = rescaleImage(image, { x: 0, y: 0 }, { x: 15, y: 0 }, 30);
assert.equal(scaled.width, image.width * 2);

// ---- furnishings: back to the wall, linked points follow and go.
const house = result.house;
const toilet = makeFurnishing(house, "toilet", { x: 100 - 13, y: 100 + 5 }, 0, "furn-1");
const westFace = Math.min(...house.walls.map((w) => Math.min(w.start.x, w.end.x))) + 0.5;
assert.ok(Math.abs(toilet.x - toilet.depth / 2 - westFace) < 0.1, `toilet back at the west wall face (${toilet.x})`);
assert.equal(toilet.rotation, 270, "faces east, into the room");
house.furniture = [toilet, makeFurnishing(house, "fridge", { x: 100, y: 100 }, 90, "furn-2")];
syncFurnishings(house);
const fixture = house.plumbing.fixtures.find((f) => f.furnitureId === "furn-1");
assert.ok(fixture && fixture.kind === "toilet" && fixture.wallId, "the toilet is its plumbing point");
assert.ok(!house.electrical.devices.some((d) => d.furnitureId === "furn-2"), "a fridge has no 240 V point");
assert.ok(validate(house), JSON.stringify(validate.errors?.slice(0, 3)));
house.furniture.push({ ...toilet, id: "furn-3" });
syncFurnishings(house);
assert.equal(house.plumbing.fixtures.filter((f) => f.kind === "toilet").length, 2, "a copy gets its own point");
house.furniture = house.furniture.filter((f) => f.id !== "furn-1");
syncFurnishings(house);
assert.equal(house.plumbing.fixtures.filter((f) => f.kind === "toilet").length, 1, "deleting the toilet deletes its point");
assert.equal(FURNISHINGS.length, 10);
const free = furnishPose(house, "stove", { x: 500, y: 500 }, 90);
assert.equal(free.rotation, 90, "away from walls it keeps its turn");

console.log("trace and furnish ok");

// ---- 3D models stand on the floor at their real size, front toward plan +y.
const THREE = await import("three");
const { furnishingModel } = await import("../src/render/furnish3d.js");
for (const spec of FURNISHINGS) {
  const model = furnishingModel({ id: "m", kind: spec.kind, x: 0, y: 0, rotation: 0, width: spec.w / 12, depth: spec.d / 12 });
  const box = new THREE.Box3().setFromObject(model);
  assert.ok(Math.abs(box.min.y) < 0.01, `${spec.kind} sits on the floor`);
  assert.ok(Math.abs(box.max.y - spec.h / 12) < 0.35, `${spec.kind} is ${spec.h} in tall (${(box.max.y * 12).toFixed(1)})`);
  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  assert.ok(w <= spec.w / 12 + 0.05 && w >= 0.85 * spec.w / 12, `${spec.kind} width ${w}`);
  assert.ok(d <= spec.d / 12 + 0.1 && d >= 0.85 * spec.d / 12, `${spec.kind} depth ${d}`);
  // The back is against the wall side (plan −y is Three.js +Z).
  assert.ok(Math.abs(box.max.z - spec.d / 24) < 0.06, `${spec.kind} back edge`);
}
console.log("furnishing models ok");

// ---- walls that cross are cut, so both rooms on each side are found.
const cross = planFromSegments([
  { a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }, { a: { x: 20, y: 0 }, b: { x: 20, y: 20 } },
  { a: { x: 20, y: 20 }, b: { x: 0, y: 20 } }, { a: { x: 0, y: 20 }, b: { x: 0, y: 0 } },
  { a: { x: 10, y: 0 }, b: { x: 10, y: 20 } }, { a: { x: 0, y: 10 }, b: { x: 20, y: 10 } },
].map((s) => ({ ...s, thick: 0 })), { doors: false });
const crossed = addTracedPlan(blank(), cross, { makeId: id });
assert.equal(crossed.counts.rooms, 4, `four rooms from a cross, got ${crossed.counts.rooms}`);
console.log("crossing walls ok");

// ---- resizing a traced plan as one group.
const { scaleSelection, selectionSet: setOf, selectionBounds: boundsOf } = await import("../src/build/transform.js");
const { makeGroup, groupOf, groupMembers, isWholeGroup, pruneGroups } = await import("../src/build/groups.js");
const { syncRooms } = await import("../src/build/rooms.js");
const traced = addTracedPlan(blank(), plan, { makeId: id });
const g = makeGroup(traced.house, traced.picks, "Traced", "group-1");
assert.ok(validate(traced.house), JSON.stringify(validate.errors?.slice(0, 3)));
const member = traced.picks[0];
assert.equal(groupOf(traced.house, member).id, "group-1");
assert.ok(isWholeGroup(traced.house, g, groupMembers(traced.house, g)));
const set = setOf(traced.house, traced.picks);
const before = boundsOf(traced.house, set);
const door = traced.house.openings[0];
const doorWall = traced.house.walls.find((w) => w.id === door.wallId);
const doorCenterBefore = door.offset + door.width / 2;
const lenBefore = Math.hypot(doorWall.end.x - doorWall.start.x, doorWall.end.y - doorWall.start.y);
const grown = syncRooms(scaleSelection(traced.house, set, 1.5).house);
const after = boundsOf(grown, setOf(grown, traced.picks));
const wallSpan = (b) => b.x1 - b.x0;
assert.ok(Math.abs(wallSpan(after) - wallSpan(before)) > 10, "the plan got bigger");
const grownDoor = grown.openings.find((o) => o.id === door.id);
assert.equal(grownDoor.width, door.width, "doors keep their real size");
const grownWall = grown.walls.find((w) => w.id === doorWall.id);
assert.equal(grownWall.thickness, doorWall.thickness, "walls keep their thickness");
const lenAfter = Math.hypot(grownWall.end.x - grownWall.start.x, grownWall.end.y - grownWall.start.y);
assert.ok(Math.abs(lenAfter - lenBefore * 1.5) < 1e-6, "walls get longer");
assert.ok(Math.abs((grownDoor.offset + grownDoor.width / 2) - doorCenterBefore * 1.5) < 0.6, "the door keeps its place along the wall");
const roomArea = (h) => h.rooms.reduce((sum, r) => sum + Math.abs(r.polygon.reduce((a, p, i, arr) => a + p.x * arr[(i + 1) % arr.length].y - arr[(i + 1) % arr.length].x * p.y, 0)) / 2, 0);
assert.ok(roomArea(grown) > roomArea(traced.house) * 2, "rooms grow with it");
// A picture scales with its size.
const pic = makeImage({ src: "data:,", pxWidth: 100, pxHeight: 50 }, { x: 0, y: 0 }, 20, "pic-1");
const withPic = { ...blank(), images: [pic] };
const bigger = scaleSelection(withPic, setOf(withPic, [{ type: "image", id: "pic-1" }]), 2).house;
assert.equal(bigger.images[0].width, 40);
assert.equal(bigger.images[0].height, 20);
// Deleted members leave the group.
traced.house.walls = traced.house.walls.slice(1);
pruneGroups(traced.house);
assert.equal(traced.house.groups[0].members.length, traced.picks.length - 1);
console.log("resize and groups ok");

// ---- lining things up: the first thing picked stays still.
const { alignSelection, selectionUnits } = await import("../src/build/align.js");
{
  const a = addTracedPlan(blank(), plan, { makeId: id });
  makeGroup(a.house, a.picks, "A", "group-a");
  const b = addTracedPlan(a.house, { walls: plan.walls.map((w) => ({ ...w, start: { x: w.start.x + 60, y: w.start.y - 7 }, end: { x: w.end.x + 60, y: w.end.y - 7 } })), openings: [] }, { makeId: id });
  makeGroup(b.house, b.picks, "B", "group-b");
  const pic = makeImage({ src: "data:,", pxWidth: 100, pxHeight: 100 }, { x: 40, y: 200 }, 10, "pic-a");
  const doc = { ...b.house, images: [pic] };
  const picks = [...a.picks, ...b.picks, { type: "image", id: "pic-a" }];
  const units = selectionUnits(doc, picks);
  assert.equal(units.length, 3, `two groups and a picture, got ${units.length}`);
  const boxOfPicks = (h, list) => boundsOf(h, setOf(h, list));
  const keyBox = boxOfPicks(doc, a.picks);
  const top = alignSelection(doc, picks, "top");
  assert.equal(top.moved, 2);
  assert.ok(Math.abs(boxOfPicks(top.house, b.picks).y1 - keyBox.y1) < 1e-6, "B's top meets A's top");
  assert.ok(Math.abs(top.house.images[0].y + top.house.images[0].height / 2 - keyBox.y1) < 1e-6, "the picture's top meets A's top");
  const bBefore = boxOfPicks(doc, b.picks);
  assert.ok(Math.abs(boxOfPicks(top.house, b.picks).x0 - bBefore.x0) < 1e-6, "lining up tops moves only up or down");
  assert.ok(Math.abs(boxOfPicks(top.house, a.picks).y1 - keyBox.y1) < 1e-6 && Math.abs(boxOfPicks(top.house, a.picks).x0 - keyBox.x0) < 1e-6, "the first stays still");
  const centre = alignSelection(doc, picks, "center");
  const cx = (box) => (box.x0 + box.x1) / 2;
  assert.ok(Math.abs(cx(boxOfPicks(centre.house, b.picks)) - cx(keyBox)) < 1e-6, "centres line up left to right");
  for (const how of ["left", "right", "middle", "bottom"]) assert.equal(alignSelection(doc, picks, how).moved, 2, how);
  // Touching rooms with no group are one section.
  const loose = addTracedPlan(blank(), plan, { makeId: id });
  assert.equal(selectionUnits(loose.house, loose.picks).length, 1, "a section of touching rooms is one unit");
  assert.equal(alignSelection(loose.house, loose.picks, "left").moved, 0);
}
console.log("align ok");

// Alignment snapping while dragging a corner.
{
  const { snapScale, snapPoint, alignTargets } = await import("../src/build/alignSnap.js");
  const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, width: x1 - x0, depth: y1 - y0 });
  // A 10 x 10 box anchored at its south-west corner; another thing 24 ft wide, its right edge at x = 30.
  const moving = box(0, 0, 10, 10);
  const other = { box: box(6, 40, 30, 50), name: "Kitchen", sized: true };
  const anchor = { x: 0, y: 0 };
  const from = { x: 10, y: 10 };
  // Cursor puts the corner at x = 29.8: clicks onto the right edge at 30 (k = 3).
  let snap = snapScale({ anchor, from, box: moving, k: 2.98, targets: [other], tolerance: 0.5 });
  assert.equal(snap.k, 3);
  assert.ok(snap.guides.some((g) => g.kind === "line" && g.a.x === 30 && g.b.x === 30));
  assert.match(snap.said, /right edge of Kitchen/);
  // Near 24 ft wide: same width (k = 2.4).
  snap = snapScale({ anchor, from, box: moving, k: 2.41, targets: [other], tolerance: 0.5 });
  assert.equal(snap.k, 2.4);
  assert.match(snap.said, /same width as Kitchen/);
  assert.ok(snap.guides.filter((g) => g.kind === "span").length === 2);
  // Too far from anything: no snap.
  snap = snapScale({ anchor, from, box: moving, k: 2.7, targets: [other], tolerance: 0.5 });
  assert.equal(snap.k, 2.7);
  assert.equal(snap.guides.length, 0);
  // A corner dragged the other way (anchor north-east): the left edge at x = 6 → corner x = 6.
  snap = snapScale({ anchor: { x: 10, y: 10 }, from: { x: 0, y: 0 }, box: moving, k: 1.02, targets: [{ box: box(-0.1, 40, 6, 50), name: "Bath", sized: false }], tolerance: 0.5 });
  assert.ok(Math.abs(snap.k - 1.01) < 1e-9, `k ${snap.k}`);

  // A wall end: x lines up with an edge; a straight wall clicks to the same length.
  let end = snapPoint({ point: { x: 29.7, y: 3.2 }, other: { x: 0, y: 3 }, targets: [other], tolerance: 0.5 });
  assert.equal(end.point.x, 30);
  assert.equal(end.point.y, 3.2);
  end = snapPoint({ point: { x: 24.3, y: 3 }, other: { x: 0, y: 3 }, targets: [other], tolerance: 0.5 });
  assert.equal(end.point.x, 24);
  assert.match(end.said, /same width as Kitchen/);

  // Targets: the sample's rooms and walls, minus what is moving.
  const doc = decorateHouse(structuredClone(sample));
  const all = alignTargets(doc, { walls: new Set(), rooms: new Set(), pieces: new Set() });
  assert.ok(all.length > doc.rooms.length);
  const room = doc.rooms[0];
  const set = { walls: new Set(), rooms: new Set([room.id]), pieces: new Set() };
  assert.ok(!alignTargets(doc, set).some((t) => t.name === room.name));
}
console.log("align snap ok");
