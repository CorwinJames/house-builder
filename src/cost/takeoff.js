import assumptions from "../../data/cost-assumptions.json" with { type: "json" };
import { assemblyById } from "../build/catalog.js";
import { electricalBom } from "../electrical/design.js";
import { plumbingBom } from "../plumbing/design.js";
import { siteBom } from "../site/design.js";
import { openingsFor, polygonArea, wallLength } from "../lib/geom.js";

const wasteById = Object.fromEntries(assumptions.waste.map((item) => [item.id, item.factor]));

export function wasteFactor(id) {
  return wasteById[id] || 0;
}

function layerThickness(wall, name) {
  const assembly = assemblyById[wall.assemblyId];
  return assembly?.layers?.find((layer) => layer.name === name)?.thickness || 0;
}

function openingVoid(openings, thickness) {
  return openings.reduce((sum, opening) => sum + opening.width * thickness * (opening.height || 0), 0);
}

/** Cubic feet of hempcrete in one wall, after openings. */
export function hempcreteVolume(wall, openings = []) {
  const thickness = layerThickness(wall, "hempcrete");
  if (!thickness) return 0;
  const gross = wallLength(wall) * thickness * (wall.height || 0);
  return Math.max(0, gross - openingVoid(openings, thickness));
}

export function rammedVolume(wall, openings = []) {
  const thickness = layerThickness(wall, "rammed earth");
  if (!thickness) return 0;
  const gross = wallLength(wall) * thickness * (wall.height || 0);
  return Math.max(0, gross - openingVoid(openings, thickness));
}

export function plasterArea(wall, openings = []) {
  const thickness = layerThickness(wall, "lime plaster");
  if (!thickness) return { area: 0, volume: 0 };
  const length = wallLength(wall);
  const height = wall.height || 0;
  const faces = 2;
  const openingArea = openings.reduce((sum, opening) => sum + opening.width * (opening.height || 0), 0);
  const area = Math.max(0, faces * length * height - faces * openingArea);
  return { area, volume: area * thickness };
}

/**
 * Studs follow the plan drawing: one at each spacing step that is not in an opening,
 * plus four trim studs at each opening. Two plates run the length of the wall.
 */
export function framingFeet(wall, openings = []) {
  const spec = assemblyById[wall.assemblyId]?.framing;
  if (!spec) return { stud: specMember(wall), feet: 0, studs: 0 };
  const length = wallLength(wall);
  const height = wall.height || 0;
  let studs = 0;
  for (let s = spec.spacing / 2; s < length; s += spec.spacing) {
    const blocked = openings.some((opening) => s > opening.offset - 0.35 && s < opening.offset + opening.width + 0.35);
    if (!blocked) studs += 1;
  }
  studs += openings.length * 4;
  const plateFeet = length * 2;
  return {
    member: spec.stud,
    feet: studs * height + plateFeet,
    studs,
  };
}

function specMember(wall) {
  return assemblyById[wall.assemblyId]?.framing?.stud || "";
}

export function headerFeet(openings = []) {
  let twoBySix = 0;
  let other = 0;
  for (const opening of openings) {
    const label = opening.header?.label || "";
    const plies = label.startsWith("2-") ? 2 : 1;
    const feet = (opening.width || 0) * plies;
    if (label === "2x6") twoBySix += feet;
    else if (label) other += feet;
  }
  return { twoBySix, other };
}

export function wallsForPhase(house, phase) {
  const walls = house.walls || [];
  if (phase === "phase1") return walls.filter((wall) => wall.phase !== "future");
  return walls;
}

export function roomsForPhase(house, phase) {
  const rooms = house.rooms || [];
  if (phase === "phase1") return rooms.filter((room) => room.phase !== "future");
  return rooms;
}

function sliceHouse(house, { phase = "full", wallId = null, roomId = null } = {}) {
  let walls = wallsForPhase(house, phase);
  let rooms = roomsForPhase(house, phase);
  if (wallId) {
    walls = walls.filter((wall) => wall.id === wallId);
    rooms = [];
  } else if (roomId) {
    rooms = rooms.filter((room) => room.id === roomId);
    walls = [];
  }
  const openings = (house.openings || []).filter((opening) => walls.some((wall) => wall.id === opening.wallId));
  return { walls, rooms, openings };
}

/**
 * Quantities only. Prices are applied later so a missing price cannot change the math.
 * wallIds on each row let a selected wall show its own share.
 */
export function takeoff(house, options = {}) {
  const { walls, rooms, openings } = sliceHouse(house, options);
  const rows = [];
  const add = (row) => {
    if (row.quantity > 0.0001) rows.push(row);
  };

  let hemp = 0;
  let rammed = 0;
  let plasterVolume = 0;
  let paintArea = 0;
  const framing = { "2x6": 0, "2x4": 0 };
  const framingWalls = [];
  let doors = 0;
  let windows = 0;
  let headerOther = 0;
  let headerTwoBySix = 0;

  for (const wall of walls) {
    const wallOpenings = openings.filter((opening) => opening.wallId === wall.id);
    const hempVol = hempcreteVolume(wall, wallOpenings);
    const rammedVol = rammedVolume(wall, wallOpenings);
    const plaster = plasterArea(wall, wallOpenings);
    hemp += hempVol;
    rammed += rammedVol;
    plasterVolume += plaster.volume;
    const frame = framingFeet(wall, wallOpenings);
    if (frame.feet > 0 && frame.member) {
      framing[frame.member] = (framing[frame.member] || 0) + frame.feet;
      framingWalls.push(wall.id);
    }
    const headers = headerFeet(wallOpenings);
    headerTwoBySix += headers.twoBySix;
    headerOther += headers.other;
    for (const opening of wallOpenings) {
      if (opening.type === "window") windows += 1;
      else doors += 1;
    }
    const exterior = assemblyById[wall.assemblyId]?.role === "exterior";
    const faces = exterior ? 1 : 2;
    const openingArea = wallOpenings.reduce((sum, opening) => sum + opening.width * (opening.height || 0), 0);
    paintArea += Math.max(0, faces * wallLength(wall) * (wall.height || 0) - faces * openingArea);
  }

  const hempWaste = 1 + wasteFactor("hempcrete");
  const batches = (hemp * hempWaste) / assumptions.hempcreteBatch.yieldCuFt;
  add({
    id: "hemp-binder",
    category: "hempcrete",
    quantity: Math.ceil(batches * assumptions.hempcreteBatch.binderBags - 1e-9),
    unit: "bag",
    kind: "material",
    basis: `${round(hemp)} cu ft of hempcrete, plus ${wasteFactor("hempcrete") * 100}% waste, in whole bags`,
  });
  add({
    id: "hemp-hurd",
    category: "hempcrete",
    quantity: Math.ceil(batches * assumptions.hempcreteBatch.hurdBags - 1e-9),
    unit: "bag",
    kind: "material",
    basis: assumptions.hempcreteBatch.note,
  });
  add({
    id: "hemp-water",
    category: "hempcrete",
    quantity: round(batches * assumptions.hempcreteBatch.waterGallonsUsed),
    unit: "gallon",
    kind: "material",
    basis: assumptions.hempcreteBatch.note,
  });
  add({
    id: "hempcrete-place",
    category: "labor",
    quantity: round(hemp / ratePerHour("hempcrete-place", options.rates)),
    unit: "hour",
    kind: "labor",
    wageId: "wage-laborer",
    basis: productionNote("hempcrete-place"),
  });

  add({
    id: "rammed-earth",
    category: "rammed-earth",
    quantity: round(rammed),
    unit: "cubic foot",
    kind: "material",
    basis: "Wall volume after openings. No waste factor; the mix price is not published.",
  });
  add({
    id: "rammed-place",
    category: "labor",
    quantity: round(rammed / ratePerHour("rammed-place", options.rates)),
    unit: "hour",
    kind: "labor",
    wageId: "wage-laborer",
    basis: productionNote("rammed-place"),
  });

  const plasterWaste = 1 + wasteFactor("plaster");
  const plasterLb = plasterVolume * plasterWaste * assumptions.limeDensityLbPerCuFt.value;
  add({
    id: "lime-plaster",
    category: "finishes",
    quantity: Math.ceil(plasterLb / assumptions.limeDensityLbPerCuFt.bagLb - 1e-9),
    unit: "bag",
    kind: "material",
    basis: `${round(plasterVolume)} cu ft of the drawing's plaster layers. Density is the published 44 lb per cubic foot.`,
  });

  const lumberWaste = 1 + wasteFactor("lumber");
  add(pieceRow("stud-2x6", "framing", (framing["2x6"] || 0) + headerTwoBySix, 10, lumberWaste, "2x6 studs, plates, and single 2x6 headers."));
  add(pieceRow("stud-2x4", "framing", framing["2x4"] || 0, 8, lumberWaste, "2x4 studs and plates. Pieces are the published 8 ft length."));
  const frameFeet = (framing["2x6"] || 0) + (framing["2x4"] || 0) + headerTwoBySix;
  add({
    id: "frame",
    category: "labor",
    quantity: round(frameFeet / ratePerHour("frame", options.rates)),
    unit: "hour",
    kind: "labor",
    wageId: "wage-carpenter",
    basis: productionNote("frame"),
  });
  add({
    id: "header-lumber",
    category: "framing",
    quantity: round(headerOther),
    unit: "linear foot",
    kind: "material",
    basis: "Built-up and deep headers from the placeholder header table.",
  });

  add({ id: "door-unit", category: "openings", quantity: doors, unit: "each", kind: "material", basis: "One line per door opening." });
  add({ id: "window-unit", category: "openings", quantity: windows, unit: "each", kind: "material", basis: "One line per window opening." });

  const floors = { wood: 0, tile: 0, stone: 0, concrete: 0 };
  for (const room of rooms) {
    if (room.outdoor) continue;
    const area = polygonArea(room.polygon || []);
    if (floors[room.finish] !== undefined) floors[room.finish] += area;
  }
  add({ id: "flooring", category: "finishes", quantity: round(floors.wood), unit: "square foot", kind: "material", diy: true, basis: "Wood-finish rooms, shoelace area." });
  add({ id: "tile", category: "finishes", quantity: round(floors.tile), unit: "square foot", kind: "material", diy: true, basis: "Tile-finish rooms, shoelace area." });
  add({ id: "stone-floor", category: "finishes", quantity: round(floors.stone), unit: "square foot", kind: "material", basis: "Stone-finish rooms." });
  add({ id: "concrete-floor", category: "finishes", quantity: round(floors.concrete), unit: "square foot", kind: "material", basis: "Concrete-finish rooms." });
  add({ id: "paint", category: "finishes", quantity: round(paintArea), unit: "square foot", kind: "material", diy: true, basis: "One face of exterior walls and both faces of partitions, minus openings." });

  add(laborRow("paint", paintArea, options.rates));
  add(laborRow("flooring", floors.wood, options.rates));
  add(laborRow("tile", floors.tile, options.rates));

  if (!options.wallId && !options.roomId) {
    const footprint = (house.footprint?.width || 0) * (house.footprint?.depth || 0);
    for (const id of ["allowance-foundation", "allowance-slab", "allowance-roof"]) {
      add({
        id,
        category: "allowances",
        quantity: options.phase === "phase1" ? 0 : round(footprint),
        unit: "square foot",
        kind: "material",
        allowance: true,
        basis: "Full footprint only. Not in the total.",
      });
    }
    rows.push(...electricalBom(house, options.phase || "full"));
    rows.push(...plumbingBom(house, options.phase || "full"));
    rows.push(...siteBom(house));
  }

  return rows;
}

function pieceRow(id, category, feet, pieceLength, waste, basis) {
  return {
    id,
    category,
    quantity: Math.ceil((feet * waste) / pieceLength - 1e-9),
    unit: "piece",
    kind: "material",
    basis,
  };
}

function laborRow(id, quantity, rates) {
  const spec = assumptions.production.find((item) => item.id === id);
  if (!spec || !(quantity > 0)) return { quantity: 0 };
  return {
    id: `${id}-labor`,
    category: "labor",
    quantity: round(quantity / ratePerHour(id, rates)),
    unit: "hour",
    kind: "labor",
    diy: true,
    wageId: spec.wageId,
    basis: spec.note,
  };
}

function ratePerHour(id, overrides = []) {
  const edited = overrides.find((item) => item.id === id);
  if (edited && edited.rate > 0) return edited.rate;
  const spec = assumptions.production.find((item) => item.id === id);
  return spec?.perHour || 1;
}

function productionNote(id) {
  return assumptions.production.find((item) => item.id === id)?.note || "";
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export function hempcreteBatchNote() {
  return assumptions.hempcreteBatch;
}
