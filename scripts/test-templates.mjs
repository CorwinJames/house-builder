import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import schema from "../schemas/house.schema.json" with { type: "json" };
import sample from "../data/sample-house.json" with { type: "json" };
import { TEMPLATES, templateGeometry, templateGhost, placeTemplate, templateClashes } from "../src/build/templates.js";
import { decorateHouse } from "../src/build/walls.js";
import { roofFootprints, roofAt, roofSpec, roofLines } from "../src/build/roofShape.js";
import { takeoff } from "../src/cost/takeoff.js";
import { selectionSet, rotateSelection, duplicateSelection } from "../src/build/transform.js";
import { polygonArea } from "../src/lib/geom.js";
import { evaluateRules } from "../src/rules/index.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const base = decorateHouse(sample);
let n = 0;
const id = (p) => `${p}-t${++n}`;

assert.ok(TEMPLATES.length >= 12, "twelve templates");
for (const group of ["China", "Japan", "Korea"]) assert.ok(TEMPLATES.filter((t) => t.group === group).length >= 3, `${group} has at least three`);

for (const template of TEMPLATES) {
  const g = templateGeometry(template);
  assert.deepEqual(g.warnings, [], `${template.id}: every door and window found a wall`);
  assert.ok(g.walls.length >= 4, `${template.id}: has walls`);
  for (const room of g.rooms) assert.ok(Math.abs(polygonArea(room.polygon)) > 4, `${template.id}: ${room.name} has floor`);
  // No two walls on top of each other.
  for (let i = 0; i < g.walls.length; i += 1) {
    for (let j = i + 1; j < g.walls.length; j += 1) {
      const a = g.walls[i];
      const b = g.walls[j];
      const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.01;
      assert.ok(!((same(a.start, b.start) && same(a.end, b.end)) || (same(a.start, b.end) && same(a.end, b.start))), `${template.id}: duplicate wall`);
    }
  }
  for (const turns of [0, 1]) {
    const at = { x: 200, y: 200 };
    const ghost = templateGhost(template, at, turns);
    assert.equal(templateClashes(base, ghost).length, 0, `${template.id}: clear spot`);
    const { house, picks } = placeTemplate(base, template, at, turns, id);
    assert.ok(validate(house), `${template.id}: schema ${JSON.stringify(validate.errors?.slice(0, 3))}`);
    assert.ok(picks.length > 5);
    const mine = new Set(Object.keys(house.buildings).filter((key) => house.buildings[key].template === template.id));
    const boxes = roofFootprints(house, true).filter((box) => mine.has(box.building));
    assert.equal(boxes.length, mine.size, `${template.id}: one roof per building`);
    for (const box of boxes) {
      const mid = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      assert.ok(roofAt(house, mid, true).height > house.roof.plateHeight, `${template.id}: roof rises`);
      assert.ok(roofLines(box).length >= 1);
    }
    assert.ok(takeoff(house).length > 0);
    const fit = evaluateRules(house).filter((rule) => rule.id.startsWith("fit-"));
    assert.deepEqual(fit.map((rule) => rule.message), [], `${template.id}: doors and windows fit`);
  }
}

// Ridge follows a quarter turn.
const sihe = TEMPLATES.find((t) => t.id === "cn-siheyuan");
const turned = placeTemplate(base, sihe, { x: 200, y: 200 }, 1, id).house;
const wing = Object.entries(turned.buildings).find(([, b]) => b.name.startsWith("West wing"));
assert.equal(wing[1].ridge, "east-west", "a wing's N-S ridge turns E-W with the template");
// The courtyard is a yard, not heated.
assert.ok(turned.rooms.some((room) => room.name === "Courtyard" && room.areaKind === "site"));
assert.ok(!turned.rooms.some((room) => room.name === "Room" && room.conditioned), "no stray heated rooms");

// Roof forms.
const hall = placeTemplate(base, TEMPLATES[0], { x: 200, y: 200 }, 0, id).house;
const hallId = Object.keys(hall.buildings).find((key) => hall.buildings[key].template === "cn-three-bay");
assert.equal(roofSpec(hall, hallId).style, "flush-gable");
const box = roofFootprints(hall, true).find((b) => b.building === hallId);
assert.equal(box.ridge, "x");
// Flush gable: the ends stop at the wall face, the sides keep their eaves.
assert.ok(box.inner && Math.abs(box.x0 - box.inner.x0) < 0.01, "flush gable ends at the wall face");
assert.ok(box.inner.y0 - box.y0 > 1, "eaves on the long sides");
// Turning the hall 90° swaps its ridge.
const set = selectionSet(hall, hall.rooms.filter((r) => r.building === hallId).map((r) => ({ type: "room", id: r.id })));
assert.ok(set.pieces.some((p) => p.type === "column"), "gallery posts come with the rooms");
const spun = rotateSelection(hall, set, 90).house;
assert.equal(spun.buildings[hallId].ridge, "north-south");
// Duplicating makes a new building with its own roof.
const dup = duplicateSelection(hall, set, 60, 0, id).house;
assert.equal(Object.keys(dup.buildings).length, Object.keys(hall.buildings).length + 1);

// Curved roof: corners turn up.
const hanok = placeTemplate(base, TEMPLATES.find((t) => t.id === "kr-straight"), { x: 200, y: 200 }, 0, id).house;
const hb = roofFootprints(hanok, true).find((b) => hanok.buildings[b.building]?.template === "kr-straight");
const corner = roofAt(hanok, { x: hb.x0 + 0.05, y: hb.y0 + 0.05 }, true).height;
const middle = roofAt(hanok, { x: (hb.x0 + hb.x1) / 2, y: hb.y0 + 0.05 }, true).height;
assert.ok(corner > middle + 0.5, `eave corner turns up (${corner} vs ${middle})`);

// Cost picks up the new wall types and posts as priced-needed lines.
const rows = takeoff(placeTemplate(base, TEMPLATES.find((t) => t.id === "jp-minka"), { x: 200, y: 200 }, 0, id).house);
for (const rowId of ["paper-screen", "earth-infill", "timber-column", "raised-floor"]) assert.ok(rows.some((r) => r.id === rowId && r.quantity > 0), `cost row ${rowId}`);

console.log(`templates: ${TEMPLATES.length} templates place, roof, turn, and cost`);
