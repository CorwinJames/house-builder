import Ajv2020 from "ajv/dist/2020.js";
import house from "../data/sample-house.json" with { type: "json" };
import schema from "../schemas/house.schema.json" with { type: "json" };
import { blankPlan, fourRoomSample } from "../src/build/newPlan.js";
import { distPointRect, fieldFootprint, placeSite, SETBACKS, suggestSite } from "../src/site/design.js";

const errors = [];
const fail = (message) => errors.push(message);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function check(doc, label) {
  if (validate(doc)) return;
  for (const error of validate.errors) fail(`${label} ${error.instancePath || "/"} ${error.message}`);
}

const blank = blankPlan();
check(blank, "blank");
if (blank.walls.length || blank.rooms.length || blank.openings.length) fail("blank plan should start empty");
if (!blank.site?.parcel?.ring?.length) fail("blank plan needs a sample lot");
if (!/sample/i.test(blank.site.label || "")) fail("blank lot must say it is a sample");
if (blank.roof.placeholder !== true) fail("blank roof stays a placeholder");

const core = fourRoomSample(house);
check(core, "four-room");
const roomIds = core.rooms.map((room) => room.id).sort();
if (roomIds.join(",") !== "bathroom,bedroom,kitchen,living") fail(`four-room rooms were ${roomIds.join(",")}`);
if (core.walls.some((wall) => wall.phase === "future")) fail("four-room plan still has a future wall");
if (core.rooms.some((room) => room.phase !== "phase1")) fail("four-room plan kept a future room");
if (!core.site?.parcel?.ring?.length) fail("four-room plan should keep the sample lot");
if (core.sample !== true) fail("four-room sample flag");

const spots = suggestSite(house);
if (spots.map((item) => item.kind).join(",") !== "well,tank,drainfield,reserve") fail(`suggest site kinds ${spots.note || ""}`);
const blankSpots = suggestSite(blank);
if (blankSpots.map((item) => item.kind).join(",") !== "well,tank,drainfield,reserve") fail(`blank suggest ${blankSpots.note || ""}`);
const size = fieldFootprint(blank);
const well = blankSpots.find((item) => item.kind === "well");
const field = blankSpots.find((item) => item.kind === "drainfield");
const gap = distPointRect(well, {
  x: field.x - size.width / 2,
  y: field.y - size.depth / 2,
  width: size.width,
  depth: size.depth,
});
if (gap < SETBACKS.well.drainfieldFt - 0.05) fail(`blank well is ${gap} ft from the drain field`);
const tiny = blankPlan();
tiny.site.parcel.ring = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }];
const none = suggestSite(tiny);
if (none.length) fail("a lot too small for 100 ft should not invent a layout");
if (!/public or shared water/i.test(none.note || "")) fail("a lot too small should name the other water options");
const moved = placeSite(house, { x: 10, y: 12 }, "well");
if (moved.house.site.well.x !== 10 || moved.house.site.well.y !== 12) fail("placeSite well");
if (moved.selection?.type !== "well") fail("placeSite selects the well");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("new plan ok");
