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

function quadNorth(quad) {
  return quad[3].y > quad[0].y;
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("sun ok");
