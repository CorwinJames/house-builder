import { ceilingHeight, makeSkylight, skylightBuild } from "../src/build/skylights.js";
import { roofAt, roofFootprints } from "../src/build/roofShape.js";
import { costLines } from "../src/cost/list.js";
import assert from "node:assert/strict";
import sample from "../data/sample-house.json" with { type: "json" };
import { currentSun, siteMoment, solarPosition, sunVector } from "../src/sun/solar.js";
import { roomSun, sunPatches, wallShadows } from "../src/sun/light.js";
import { decorateHouse } from "../src/build/walls.js";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL - ${name}\n  ${error.message}`);
  }
}

// Port Townsend, WA (Jefferson County).
const PT = { lat: 48.117, lon: -122.76 };

check("summer solstice solar noon in Port Townsend is high in the south", () => {
  // Solar noon there is about 1:12 pm PDT on June 21.
  const sun = solarPosition(siteMoment(6, 21, 13 * 60 + 12), PT.lat, PT.lon);
  // 90 - 48.117 + 23.44 = 65.3 degrees.
  assert.ok(Math.abs(sun.elevation - 65.3) < 0.6, `elevation ${sun.elevation}`);
  assert.ok(Math.abs(sun.azimuth - 180) < 4, `azimuth ${sun.azimuth}`);
});

check("winter solstice noon is low; equinox sunrise is due east", () => {
  const winter = solarPosition(siteMoment(12, 21, 12 * 60 + 12), PT.lat, PT.lon);
  assert.ok(Math.abs(winter.elevation - 18.4) < 0.8, `winter ${winter.elevation}`);
  const morning = solarPosition(siteMoment(3, 20, 7 * 60 + 20), PT.lat, PT.lon);
  assert.ok(Math.abs(morning.azimuth - 90) < 6, `equinox morning azimuth ${morning.azimuth}`);
  const night = solarPosition(siteMoment(6, 21, 1 * 60), PT.lat, PT.lon);
  assert.ok(night.elevation < 0);
});

check("the sample lot has no location, so the sun is set by hand", () => {
  const sun = currentSun(sample, { azimuth: 180, elevation: 30 });
  assert.equal(sun.source, "manual");
  assert.equal(sun.azimuth, 180);
  const lot = { site: { parcel: { origin: { lat: PT.lat, lon: PT.lon } } } };
  assert.equal(currentSun(lot, { month: 6, day: 21, minutes: 13 * 60 }).source, "lot");
});

check("a south window puts a sun patch on the floor north of it", () => {
  const house = decorateHouse(structuredClone(sample));
  const sun = { up: true, vector: sunVector(180, 30) };
  const patches = sunPatches(house, sun);
  const living = patches.find((patch) => patch.openingId === "win-living-s");
  assert.ok(living, "the living room's south window lets sun in");
  const ys = living.polygon.map((point) => point.y);
  assert.ok(Math.min(...ys) > 0.5, "the patch is inside, north of the wall");
  // Sill 2.5 ft, head 6.5 ft, sun 30 degrees: the patch reaches about 6.5 / tan 30 = 11.3 ft in.
  assert.ok(Math.abs(Math.max(...ys) - (0.75 + 0.75 + 6.5 / Math.tan(Math.PI / 6))) < 0.3, `far edge ${Math.max(...ys)}`);
  assert.ok(living.area > 10, `area ${living.area}`);
  const north = sunPatches(house, { up: true, vector: sunVector(0, 30) }).find((patch) => patch.openingId === "win-living-s");
  assert.equal(north, undefined, "no sun through a south window when the sun is in the north");
  assert.ok(roomSun(house, patches).some((room) => room.lit > 0));
});

check("walls cast ground shadows away from the sun, longer when it is low", () => {
  const house = decorateHouse(structuredClone(sample));
  const high = wallShadows(house, { up: true, vector: sunVector(180, 60) })[0];
  const low = wallShadows(house, { up: true, vector: sunVector(180, 15) })[0];
  const reach = (quad) => Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  assert.ok(reach(low) > reach(high) * 4);
  assert.ok(quadNorth(high), "a south sun throws shadows north");
  assert.deepEqual(wallShadows(house, { up: false, vector: sunVector(180, -5) }), []);
});

check("the roof height and slope come from the placeholder hip-and-gable", () => {
  const house = decorateHouse(structuredClone(sample));
  const box = roofFootprints(house, false)[0];
  const mid = { x: (box.x0 + box.x1) / 2, y: box.y0 + 4 };
  const at = roofAt(house, mid, false);
  assert.equal(at.face, "south");
  assert.ok(Math.abs(at.height - (house.roof.plateHeight + 4 * house.roof.pitchRiseOverRun)) < 1e-9);
  assert.deepEqual(at.downhill, { x: 0, y: -1 });
  const ridge = roofAt(house, { x: mid.x, y: (box.y0 + box.y1) / 2 }, false);
  assert.ok(Math.abs(ridge.height - (house.roof.plateHeight + ((box.y1 - box.y0) / 2) * house.roof.pitchRiseOverRun)) < 1e-9);
  assert.equal(roofAt(house, { x: box.x0 - 5, y: mid.y }, false), null);
});

check("a skylight sits on its roof face with a shaft to the ceiling, and light has to get down it", () => {
  const house = decorateHouse(structuredClone(sample));
  const living = house.rooms.find((room) => /living/i.test(room.name || ""));
  const xs = living.polygon.map((point) => point.x);
  const ys = living.polygon.map((point) => point.y);
  const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const skylight = makeSkylight(house, middle, "C06", "sky-1");
  house.skylights = [skylight];
  assert.equal(skylight.roomId, living.id);
  assert.equal(skylight.rotation, 0, "the long way runs north-south, down the south roof face");
  const build = skylightBuild(house, skylight);
  assert.deepEqual(build.problems, []);
  const angle = Math.atan(house.roof.pitchRiseOverRun);
  // Ceiling opening: 21 in wide, 45-3/4 in down the slope, seen from above.
  assert.ok(Math.abs(build.ceilingOpening.depth - (45.75 / 12) * Math.cos(angle)) < 1e-3);
  assert.ok(build.shaft.tallest > build.shaft.shortest, "the uphill end of the shaft is taller");
  const roofMid = roofAt(house, skylight, false).height;
  assert.ok(Math.abs((build.shaft.tallest + build.shaft.shortest) / 2 - (roofMid - ceilingHeight(house))) < 0.05);
  assert.equal(build.framing.raftersCut, 0, "a 21 in opening fits between rafters at 24 in. on center");
  assert.equal(skylightBuild(house, { ...skylight, model: "S06" }).framing.raftersCut, 1);

  const overhead = sunPatches(house, { up: true, vector: sunVector(180, 89.9) }).find((patch) => patch.skylightId === "sky-1");
  assert.ok(overhead, "overhead sun comes straight down the shaft");
  assert.ok(Math.abs(overhead.area - 1.75 * build.ceilingOpening.depth) < 0.3, `area ${overhead.area}`);
  const steep = sunPatches(house, { up: true, vector: sunVector(180, 80) }).find((patch) => patch.skylightId === "sky-1");
  assert.ok(steep && steep.area < overhead.area, "a slanted sun loses some light to the shaft walls");
  const lowSouth = sunPatches(house, { up: true, vector: sunVector(180, 45) }).find((patch) => patch.skylightId === "sky-1");
  assert.equal(lowSouth, undefined, `a ${build.shaft.shortest.toFixed(1)} ft shaft stops a 45° sun before the floor`);
  const behind = sunPatches(house, { up: true, vector: sunVector(0, 20) }).find((patch) => patch.skylightId === "sky-1");
  assert.equal(behind, undefined, "a sun behind the roof face never reaches the glass");
});

check("skylights are costed: unit, flashing, shaft, and framing", () => {
  const house = decorateHouse(structuredClone(sample));
  const living = house.rooms.find((room) => /living/i.test(room.name || ""));
  const xs = living.polygon.map((point) => point.x);
  const ys = living.polygon.map((point) => point.y);
  house.skylights = [makeSkylight(house, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, "C06", "sky-1")];
  const lines = costLines(house, { phase: "phase1", skylightId: "sky-1" });
  const byId = Object.fromEntries(lines.map((line) => [line.id, line]));
  assert.equal(byId["skylight-fs-c06"].quantity, 1);
  assert.equal(byId["skylight-fs-c06"].unitPrice, 407.73);
  assert.equal(byId["flashing-edl-c06"].unitPrice, 118.11);
  for (const id of ["skylight-shaft-studs", "batt-r15-kraft", "xps-2in-r10", "drywall-half", "rafter-lumber"]) assert.ok(byId[id]?.quantity > 0, id);
  assert.equal(byId["skylight-shaft-studs"].unitPrice, 4.25, "shaft studs use the 2x4 stud price");
  assert.equal(byId["rafter-lumber"].priceNeeded, true);
  const whole = costLines(house, { phase: "phase1" });
  assert.ok(whole.some((line) => line.id === "skylight-fs-c06"), "the house total includes it");
  assert.equal(costLines(house, { phase: "phase1", wallId: house.walls[0].id }).filter((line) => line.category === "skylights").length, 0);
});

function quadNorth(quad) {
  return quad[3].y > quad[0].y;
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("sun ok");
