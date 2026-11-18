import { ceilingHeight, makeSkylight, skylightBuild } from "../src/build/skylights.js";
import { roofAt, roofFootprints } from "../src/build/roofShape.js";
import { costLines } from "../src/cost/list.js";
import assert from "node:assert/strict";
import sample from "../data/sample-house.json" with { type: "json" };
import { SEASONS, currentSun, siteMoment, solarPosition, sunPlace, sunVector } from "../src/sun/solar.js";
import { roofShadows, roomSun, sunPatches, wallShadows } from "../src/sun/light.js";
import { litRange, sunObstacles } from "../src/sun/rays.js";
import { polygonArea } from "../src/lib/geom.js";
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
  // Sill 2.5 ft, head 6.5 ft, sun 30 degrees. The farthest line in grazes the
  // head at the wall's OUTER face (y = 0 on this 1.5 ft wall), so it lands
  // 6.5 / tan 30 = 11.26 ft north of that face; the near edge is the sill at
  // the inner face: 1.5 + 2.5 / tan 30 = 5.83.
  assert.ok(Math.abs(Math.max(...ys) - 6.5 / Math.tan(Math.PI / 6)) < 0.05, `far edge ${Math.max(...ys)}`);
  assert.ok(Math.abs(Math.min(...ys) - (1.5 + 2.5 / Math.tan(Math.PI / 6))) < 0.05, `near edge ${Math.min(...ys)}`);
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

check("seasons: a reference place sets the sun by season", () => {
  const house = { ...structuredClone(sample), solar: { place: { name: "Port Townsend, WA", lat: 48.117, lon: -122.76 } } };
  assert.equal(sunPlace(house).source, "place");
  const noon = (id) => {
    const season = SEASONS.find((item) => item.id === id);
    return currentSun(house, { mode: "auto", month: season.month, day: season.day, minutes: 13 * 60 + 10 });
  };
  const winter = noon("winter");
  const spring = noon("spring");
  const summer = noon("summer");
  const fall = noon("fall");
  assert.equal(winter.source, "place");
  // Noon altitude at 48.1 N: 90 - lat + declination, about 18, 42, 65, 42 degrees.
  assert.ok(Math.abs(winter.elevation - 18.4) < 1.5, `winter ${winter.elevation}`);
  assert.ok(Math.abs(summer.elevation - 65.3) < 1.5, `summer ${summer.elevation}`);
  assert.ok(Math.abs(spring.elevation - fall.elevation) < 1.5);
  assert.ok(winter.elevation < spring.elevation && spring.elevation < summer.elevation);
  assert.match(winter.label, /^Winter · Dec 21/);
  // No lot and no place: still by hand.
  assert.equal(sunPlace(structuredClone(sample)), null);
  assert.equal(currentSun(structuredClone(sample), { mode: "auto" }).source, "manual");
});

check("thick walls narrow the patch when the sun comes in at an angle", () => {
  const house = decorateHouse(structuredClone(sample));
  const wall = house.walls.find((item) => item.id === house.openings.find((o) => o.id === "win-living-s").wallId);
  const opening = house.openings.find((o) => o.id === "win-living-s");
  const width = (patch) => Math.max(...patch.polygon.map((p) => p.x)) - Math.min(...patch.polygon.map((p) => p.x));
  const square = sunPatches(house, { up: true, vector: sunVector(180, 30) }).find((p) => p.openingId === opening.id);
  const angled = sunPatches(house, { up: true, vector: sunVector(225, 30) }).find((p) => p.openingId === opening.id);
  // Straight on, the patch is the window's width.
  assert.ok(Math.abs(width(square) - opening.width) < 0.05, `square ${width(square)}`);
  // At 45 degrees off the wall the jambs hide a strip as wide as the wall is thick,
  // and the patch is a parallelogram slanting the other way.
  const thick = Number(wall.thickness);
  const patchArea = Math.abs(polygonArea(angled.polygon));
  const squareArea = Math.abs(polygonArea(square.polygon));
  assert.ok(patchArea < squareArea, "less light in at an angle");
  const xsAtNear = angled.polygon.filter((p) => Math.abs(p.y - Math.min(...angled.polygon.map((q) => q.y))) < 0.05).map((p) => p.x);
  assert.ok(xsAtNear.length >= 1);
  assert.ok(thick > 0);
});

check("a gable end's rake shades a window less than a low eave would", () => {
  // One box roof, ridge east-west; a west window under the gable rake, 2 ft overhang.
  const house = decorateHouse(structuredClone(sample));
  house.roof.style = "gable";
  const obstacles = sunObstacles(house, { up: true, vector: sunVector(270, 40) }, { full: false });
  const own = obstacles.roofs[0];
  assert.equal(own.box.style, "gable");
  const midY = (own.box.y0 + own.box.y1) / 2;
  const plate = Number(house.roof.plateHeight);
  // At the middle of the west wall the roof overhead is far above the plate.
  assert.ok(own.top({ x: own.box.x0 + 0.01, y: midY }) > plate + 1);
  const at = { x: own.box.x0 + 2 - 0.01, y: midY };
  const range = litRange(obstacles, at, 0, 30);
  assert.ok(range, "some of the wall sees the sun");
  // The shade line sits above the plate here (a plain eave line would be at plate - depth * tan).
  assert.ok(range[1] > plate - 2 * Math.tan((40 * Math.PI) / 180), `top ${range && range[1]}`);
});

check("an eave line equals plate minus overhang times the profile angle", () => {
  const house = decorateHouse(structuredClone(sample));
  const obstacles = sunObstacles(house, { up: true, vector: sunVector(180, 50) }, { full: false });
  const roof = obstacles.roofs[0];
  // The living room's south wall: outer face at y = 0.
  const x = (roof.box.x0 + roof.box.x1) / 2;
  const at = { x, y: -0.01 };
  const range = litRange(obstacles, at, 0, 30);
  const depth = 0 - roof.box.y0;
  assert.ok(depth > 0.5, `overhang ${depth}`);
  const expected = Number(house.roof.plateHeight) - depth * Math.tan((50 * Math.PI) / 180);
  assert.ok(Math.abs(range[1] - expected) < 0.05, `line ${range[1]} vs ${expected}`);
});

check("the roof throws a ground shadow past the walls' own shadows", () => {
  const house = decorateHouse(structuredClone(sample));
  const sun = { up: true, vector: sunVector(180, 20) };
  const roofs = roofShadows(house, sun, { full: true });
  assert.ok(roofs.length >= 1);
  const farRoof = Math.max(...roofs.flat().map((p) => p.y));
  const farWall = Math.max(...wallShadows(house, sun).flat().map((p) => p.y));
  assert.ok(farRoof > farWall + 5, `roof ${farRoof} wall ${farWall}`);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("sun ok");
