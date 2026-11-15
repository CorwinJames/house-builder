/**
 * Cost rows for skylights: the unit, its flashing kit, the light shaft, and the
 * roof and ceiling framing around the opening. Quantities only; prices come
 * from data/prices.json in costLines. See src/build/skylights.js for how each
 * skylight is built and the assumptions behind these numbers.
 */
import { skylightBuild } from "../build/skylights.js";

const FLASHING_PRICE = { "EDL C06": "flashing-edl-c06", "EDL M08": "flashing-edl-m08", "EDL S06": "flashing-edl-s06" };
const DRYWALL_SHEET_SQFT = 32;
const XPS_BOARD_SQFT = 32;
const BATT_BAG_SQFT = 67.81;
const STUD_PIECE_FT = 8;
const WASTE = 0.1;

/** Which skylights count for this phase or selection. */
export function skylightsFor(house, { phase = "full", roomId = null, wallId = null, skylightId = null } = {}) {
  if (wallId) return [];
  return (house.skylights || []).filter((item) => {
    if (skylightId) return item.id === skylightId;
    if (phase === "phase1" && item.phase === "future") return false;
    if (phase === "phase1") {
      const room = (house.rooms || []).find((entry) => entry.id === item.roomId);
      if (room?.phase === "future") return false;
    }
    if (roomId) return item.roomId === roomId;
    return true;
  });
}

export function skylightBom(house, options = {}) {
  const items = skylightsFor(house, options);
  if (!items.length) return [];
  const full = options.phase !== "phase1";
  const builds = items.map((item) => skylightBuild(house, item, full));
  const rows = [];
  const ids = items.map((item) => item.id);
  const add = (row) => {
    if (row.quantity > 0.0001) rows.push({ category: "skylights", kind: "material", skylightIds: ids, ...row });
  };

  const byModel = new Map();
  const byFlashing = new Map();
  for (const build of builds) {
    byModel.set(build.model.id, (byModel.get(build.model.id) || 0) + 1);
    byFlashing.set(build.model.flashing, (byFlashing.get(build.model.flashing) || 0) + 1);
  }
  for (const [model, count] of byModel) {
    add({ id: `skylight-fs-${model.toLowerCase()}`, quantity: count, unit: "each", basis: `VELUX FS ${model} 2004 fixed deck-mount, laminated Low-E3. One per skylight.` });
  }
  for (const [kit, count] of byFlashing) {
    add({ id: FLASHING_PRICE[kit], quantity: count, unit: "each", basis: `${kit} low-profile flashing kit (shingle or slate roofing). One per skylight.` });
  }

  const shaftArea = builds.reduce((sum, build) => sum + build.shaft.area, 0);
  const studFeet = builds.reduce((sum, build) => sum + build.shaft.studFeet + build.shaft.plateFeet, 0);
  const roofLumber = builds.reduce((sum, build) => sum + build.framing.roofLumberFeet, 0);
  const ceilingLumber = builds.reduce((sum, build) => sum + build.framing.ceilingLumberFeet, 0);
  const cutCount = builds.reduce((sum, build) => sum + build.framing.raftersCut, 0);
  const area = Math.round(shaftArea * 100) / 100;

  add({
    id: "skylight-shaft-studs",
    priceId: "stud-2x4",
    quantity: Math.ceil((studFeet * (1 + WASTE)) / STUD_PIECE_FT - 1e-9),
    unit: "piece",
    basis: `Skylight shaft walls: 2x4 studs at 16 in. on center plus top and bottom plates, ${Math.round(studFeet)} linear ft, plus ${WASTE * 100}% waste, in 8 ft pieces.`,
  });
  add({
    id: "batt-r15-kraft",
    quantity: Math.ceil((shaftArea * (1 + WASTE)) / BATT_BAG_SQFT - 1e-9),
    unit: "bag",
    basis: `R-15 batts in the shaft wall cavities: ${area} sq ft of shaft wall, plus ${WASTE * 100}% waste, in ${BATT_BAG_SQFT} sq ft bags.`,
  });
  add({
    id: "xps-2in-r10",
    quantity: Math.ceil((shaftArea * (1 + WASTE)) / XPS_BOARD_SQFT - 1e-9),
    unit: "board",
    basis: `2 in. R-10 XPS on the attic side of the shaft walls (13+10 wall path, 2021 WSEC-R Table R402.1.3): ${area} sq ft, plus ${WASTE * 100}% waste, in 4 × 8 ft boards.`,
  });
  add({
    id: "drywall-half",
    quantity: Math.ceil((shaftArea * (1 + WASTE)) / DRYWALL_SHEET_SQFT - 1e-9),
    unit: "sheet",
    basis: `1/2 in. drywall lining the shaft: ${area} sq ft, plus ${WASTE * 100}% waste, in 4 × 8 ft sheets. Tape and mud not counted.`,
  });
  add({
    id: "rafter-lumber",
    quantity: Math.round((roofLumber + ceilingLumber) * 100) / 100,
    unit: "linear foot",
    basis: `Headers at the top and bottom of each roof and ceiling opening${cutCount ? `, and doubled trimmers full length beside ${cutCount} cut rafter${cutCount > 1 ? "s" : ""} and joist${cutCount > 1 ? "s" : ""}` : ""} (IRC R802.9). Same size as the rafters and joists, which aren't designed yet; framing assumed 24 in. on center.`,
  });
  return rows;
}
