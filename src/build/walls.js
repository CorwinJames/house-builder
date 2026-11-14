import { wallLength, pointAlong } from "../lib/geom.js";
import { assemblyById, headerForSpan, assemblyForRender, suggestAssemblyId, DEFAULT_EXTERIOR_ID } from "./catalog.js";
import { nextId } from "./ids.js";
import { openingFits } from "./openings.js";
import { clipTogether, endsAt, partnersOf, pruneJoins, remapSplit, withJoins } from "./clips.js";

export function cloneHouse(house) {
  return JSON.parse(JSON.stringify(house));
}

export function applyAssembly(wall, assemblyId) {
  const assembly = assemblyById[assemblyId] || assemblyForRender(wall.assembly);
  return {
    ...wall,
    assemblyId: assembly.id,
    assembly: assembly.renderAssembly,
    thickness: assembly.thickness,
    role: assembly.role,
  };
}

export function withHeader(opening) {
  return { ...opening, header: headerForSpan(opening.width) };
}

/** Fill assembly ids and headers on a house that was saved before Stage 2. */
export function decorateHouse(house) {
  const next = cloneHouse(house);
  next.schemaVersion = Math.max(8, next.schemaVersion || 2);
  next.furniture = Array.isArray(next.furniture) ? next.furniture : [];
  next.planLabels = Array.isArray(next.planLabels) ? next.planLabels : [];
  next.siteFeatures = Array.isArray(next.siteFeatures) ? next.siteFeatures : [];
  next.electrical = {
    ...(next.electrical || {}),
    panel: next.electrical?.panel ?? null,
    devices: Array.isArray(next.electrical?.devices) ? next.electrical.devices : [],
    wallMethods: next.electrical?.wallMethods || {},
    devicesPerCircuit: next.electrical?.devicesPerCircuit || 8,
  };
  next.plumbing = {
    ...(next.plumbing || {}),
    fixtures: Array.isArray(next.plumbing?.fixtures) ? next.plumbing.fixtures : [],
    entry: next.plumbing?.entry ?? null,
    septic: next.plumbing?.septic ?? null,
    supplyMethod: next.plumbing?.supplyMethod || "manifold",
    inchesPerFoot: next.plumbing?.inchesPerFoot ?? null,
  };
  next.cost = {
    diyFinish: next.cost?.diyFinish !== false,
    overrides: Array.isArray(next.cost?.overrides) ? next.cost.overrides : [],
    rates: Array.isArray(next.cost?.rates) ? next.cost.rates : [],
  };
  next.walls = next.walls.map((wall) => applyAssembly(wall, wall.assemblyId || assemblyForRender(wall.assembly).id));
  next.openings = next.openings.map((opening) => (opening.header?.placeholder ? opening : withHeader(opening)));
  next.constraints = next.constraints || [];
  next.customRatios = next.customRatios || [];
  next.proportion = next.proportion || { ratioId: "golden", module: 8 };
  withJoins(next);
  pruneJoins(next);
  return next;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function project(point, wall) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return null;
  const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / len2;
  return { t, x: wall.start.x + dx * t, y: wall.start.y + dy * t, length: Math.sqrt(len2) };
}

/**
 * Split `wall` at a distance along its centerline.
 * Openings wholly on one side move with that piece. An opening that crosses
 * the cut stays on the piece it overlaps more and is reported as a warning.
 */
export function splitWall(house, wallId, distance) {
  const index = house.walls.findIndex((wall) => wall.id === wallId);
  if (index < 0) return null;
  const wall = house.walls[index];
  const length = wallLength(wall);
  if (distance < 0.2 || distance > length - 0.2) return null;
  const point = pointAlong(wall, distance);
  const keep = { ...wall, end: { x: point.x, y: point.y } };
  const born = applyAssembly({
    ...wall,
    id: nextId("wall"),
    start: { x: point.x, y: point.y },
    end: { ...wall.end },
  }, wall.assemblyId);
  const warnings = [];
  for (const opening of house.openings) {
    if (opening.wallId !== wall.id) continue;
    const end = opening.offset + opening.width;
    if (end <= distance + 1e-4) continue;
    if (opening.offset >= distance - 1e-4) {
      opening.wallId = born.id;
      opening.offset -= distance;
      continue;
    }
    warnings.push({
      id: `opening-split-${opening.id}`,
      severity: "warn",
      message: "An opening crossed a new corner and was kept on the longer side.",
      target: { type: "opening", id: opening.id },
    });
    if (distance - opening.offset > end - distance) {
      opening.width = distance - opening.offset;
    } else {
      opening.wallId = born.id;
      opening.offset = 0;
      opening.width = end - distance;
    }
  }
  house.walls.splice(index, 1, keep, born);
  // The two halves are still one wall, so they stay clipped where they were cut.
  if (Array.isArray(house.joins)) {
    remapSplit(house, wall.id, born.id);
    clipTogether(house, [{ wall: keep.id, end: "end" }, { wall: born.id, end: "start" }]);
  }
  return { point, keep, born, warnings };
}

function nearlyCollinear(a, b) {
  const adx = a.end.x - a.start.x;
  const ady = a.end.y - a.start.y;
  const bdx = b.end.x - b.start.x;
  const bdy = b.end.y - b.start.y;
  const al = Math.hypot(adx, ady) || 1;
  const bl = Math.hypot(bdx, bdy) || 1;
  const cross = Math.abs(adx / al * bdy / bl - ady / al * bdx / bl);
  return cross < 0.08;
}

/** True when two centerlines lie on top of each other, not when they only meet or cross. */
export function wallsOverlap(a, b) {
  if (!nearlyCollinear(a, b)) return false;
  const projA0 = project(a.start, b);
  const projA1 = project(a.end, b);
  if (!projA0 || !projA1) return false;
  const off = Math.max(
    dist(a.start, { x: projA0.x, y: projA0.y }),
    dist(a.end, { x: projA1.x, y: projA1.y }),
  );
  if (off > 0.35) return false;
  const t0 = Math.min(projA0.t, projA1.t);
  const t1 = Math.max(projA0.t, projA1.t);
  const overlap = (Math.min(t1, 1) - Math.max(t0, 0)) * projA0.length;
  return overlap > 0.4;
}

function segmentCross(a, b, c, d) {
  const rpx = b.x - a.x;
  const rpy = b.y - a.y;
  const qpx = d.x - c.x;
  const qpy = d.y - c.y;
  const den = rpx * qpy - rpy * qpx;
  if (Math.abs(den) < 1e-8) return null;
  const t = ((c.x - a.x) * qpy - (c.y - a.y) * qpx) / den;
  const u = ((c.x - a.x) * rpy - (c.y - a.y) * rpx) / den;
  if (t < -1e-4 || t > 1 + 1e-4 || u < -1e-4 || u > 1 + 1e-4) return null;
  return { t, u, x: a.x + rpx * t, y: a.y + rpy * t };
}

/**
 * After a new wall is added, split anything it tees into or crosses.
 * Existing sample butt joints are left alone: a split only happens when the
 * hit is within `tolerance` feet of a centerline.
 */
export function resolveJunctions(house, wallIds, tolerance = 0.2) {
  const warnings = [];
  const interesting = new Set(wallIds);
  let guard = 0;
  let changed = true;
  while (changed && guard < 12) {
    changed = false;
    guard += 1;
    const walls = house.walls.filter((wall) => interesting.has(wall.id));
    for (const wall of walls) {
      if (!house.walls.includes(wall)) continue;
      for (const other of house.walls) {
        if (other.id === wall.id) continue;
        for (const end of ["start", "end"]) {
          const point = wall[end];
          const hit = project(point, other);
          if (!hit) continue;
          const gap = dist(point, { x: hit.x, y: hit.y });
          if (gap > tolerance) continue;
          const along = hit.t * hit.length;
          if (along <= 0.2 || along >= hit.length - 0.2) {
            if (gap > 0.001 && gap <= tolerance && (hit.t <= 0.02 || hit.t >= 0.98)) {
              wall[end] = hit.t < 0.5 ? { ...other.start } : { ...other.end };
            }
            continue;
          }
          const split = splitWall(house, other.id, along);
          if (!split) continue;
          wall[end] = { ...split.point };
          interesting.add(split.born.id);
          warnings.push(...split.warnings);
          changed = true;
          break;
        }
        if (changed) break;
        const cross = segmentCross(wall.start, wall.end, other.start, other.end);
        if (!cross || cross.t < 0.04 || cross.t > 0.96 || cross.u < 0.04 || cross.u > 0.96) continue;
        const onWall = cross.t * wallLength(wall);
        const onOther = cross.u * wallLength(other);
        const first = splitWall(house, other.id, onOther);
        if (!first) continue;
        const second = splitWall(house, wall.id, onWall);
        if (second) interesting.add(second.born.id);
        interesting.add(first.born.id);
        warnings.push(...first.warnings);
        if (second) warnings.push(...second.warnings);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return warnings;
}

export function makeWall(start, end, assemblyId, phase = "phase1", levelId = "main", height = 10) {
  return applyAssembly({
    id: nextId("wall"),
    levelId,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    height,
    phase,
    assembly: "framed",
    thickness: 0.5,
    role: "interior",
  }, assemblyId);
}

/**
 * `clip` (default true) clips the new wall's ends onto walls they touch and cuts
 * a wall it tees into. With `clip: false` the wall is laid on: it touches but
 * stays its own piece, and nothing is cut.
 */
export function addWall(house, start, end, assemblyId, phase = "phase1", { clip = true } = {}) {
  if (dist(start, end) < 0.45) {
    return { house, warnings: [{ id: "short-wall", severity: "warn", message: "That wall is too short to keep.", target: null }] };
  }
  const next = cloneHouse(house);
  const wall = makeWall(start, end, assemblyId, phase, next.levels[0]?.id || "main", next.levels[0]?.plateHeight || 10);
  const overlap = next.walls.find((other) => wallsOverlap(wall, other));
  if (overlap) {
    return {
      house,
      warnings: [{
        id: `overlap-${overlap.id}`,
        severity: "warn",
        message: "That wall lands on top of another wall.",
        target: { type: "wall", id: overlap.id },
      }],
    };
  }
  next.walls.push(wall);
  withJoins(next);
  const warnings = clip ? resolveJunctions(next, [wall.id]) : [];
  if (clip) clipTouching(next, [wall.id]);
  return { house: next, warnings, createdId: wall.id };
}

export function addRoomRectangle(house, a, b, assemblyId, { clip = true } = {}) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (x1 - x0 < 2 || y1 - y0 < 2) {
    return { house, warnings: [{ id: "small-room", severity: "warn", message: "Drag a room at least 2 feet on each side.", target: null }] };
  }
  let current = cloneHouse(house);
  const warnings = [];
  const ids = [];
  const explicit = assemblyId !== DEFAULT_EXTERIOR_ID;
  const sides = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: 0, y: -1 }],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }, { x: 1, y: 0 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }, { x: 0, y: 1 }],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }, { x: -1, y: 0 }],
  ];
  for (const [start, end, outward] of sides) {
    const id = suggestAssemblyId(start, end, assemblyId, explicit, outward);
    const wall = makeWall(start, end, id, "phase1", current.levels[0]?.id || "main", current.levels[0]?.plateHeight || 10);
    const overlap = current.walls.find((other) => wallsOverlap(wall, other));
    if (overlap) {
      warnings.push({
        id: `overlap-${overlap.id}`,
        severity: "warn",
        message: "Part of that room sits on an existing wall.",
        target: { type: "wall", id: overlap.id },
      });
      continue;
    }
    current.walls.push(wall);
    ids.push(wall.id);
  }
  withJoins(current);
  // A room's own four corners are always one piece.
  const mine = current.walls.filter((wall) => ids.includes(wall.id));
  for (const wall of mine) {
    for (const endName of ["start", "end"]) {
      const touching = endsAt(current, wall[endName]).filter((ref) => ids.includes(ref.wall));
      if (touching.length > 1) clipTogether(current, touching);
    }
  }
  if (clip) {
    warnings.push(...resolveJunctions(current, ids));
    clipTouching(current, current.walls.filter((wall) => ids.includes(wall.id) || !house.walls.some((old) => old.id === wall.id)).map((wall) => wall.id));
  }
  return { house: current, warnings };
}

/** Clip every end of these walls onto any wall end it now sits on. Mutates. */
export function clipTouching(house, wallIds) {
  withJoins(house);
  for (const wall of house.walls.filter((item) => wallIds.includes(item.id))) {
    for (const endName of ["start", "end"]) {
      const touching = endsAt(house, wall[endName]);
      if (touching.length > 1) clipTogether(house, touching);
    }
  }
  return house;
}

/**
 * Move one wall end. Ends clipped to it come along; ends that are only laid on
 * stay where they are. A house with no clip list falls back to "everything that
 * touches", the way plans behaved before clips existed.
 */
export function moveEnd(house, wallId, endName, to) {
  if (!Array.isArray(house.joins)) {
    const wall = house.walls.find((item) => item.id === wallId);
    return wall ? moveEndpointGroup(house, wall[endName], to) : cloneHouse(house);
  }
  const next = cloneHouse(house);
  const refs = [{ wall: wallId, end: endName }, ...partnersOf(next, wallId, endName)];
  for (const ref of refs) {
    const wall = next.walls.find((item) => item.id === ref.wall);
    if (wall) wall[ref.end] = { x: to.x, y: to.y };
  }
  return next;
}

/** Ends outside `ids` that are clipped to a moving wall (or, with no clip list, touching one). */
function attachedEnds(house, ids, tolerance) {
  if (Array.isArray(house.joins)) {
    const out = [];
    for (const wall of house.walls) {
      if (!ids.has(wall.id)) continue;
      for (const endName of ["start", "end"]) {
        for (const ref of partnersOf(house, wall.id, endName)) {
          if (!ids.has(ref.wall) && !out.some((item) => item.wall === ref.wall && item.end === ref.end)) out.push(ref);
        }
      }
    }
    return out;
  }
  const points = house.walls.filter((wall) => ids.has(wall.id)).flatMap((wall) => [wall.start, wall.end]);
  const out = [];
  for (const other of house.walls) {
    if (ids.has(other.id)) continue;
    for (const endName of ["start", "end"]) {
      if (points.some((point) => dist(other[endName], point) <= tolerance)) out.push({ wall: other.id, end: endName });
    }
  }
  return out;
}

export function moveEndpointGroup(house, point, to, tolerance = 0.25) {
  const next = cloneHouse(house);
  for (const wall of next.walls) {
    if (dist(wall.start, point) <= tolerance) wall.start = { x: to.x, y: to.y };
    if (dist(wall.end, point) <= tolerance) wall.end = { x: to.x, y: to.y };
  }
  return next;
}

export function translateWall(house, wallId, dx, dy, tolerance = 0.25) {
  return translateWalls(house, [wallId], dx, dy, tolerance);
}

/**
 * Move several walls together as one rigid piece. Walls outside the set that
 * are clipped to a moving end stretch to stay clipped. Walls that are only laid
 * on stay put.
 */
export function translateWalls(house, wallIds, dx, dy, tolerance = 0.25) {
  const ids = new Set(wallIds);
  const attached = attachedEnds(house, ids, tolerance);
  const next = cloneHouse(house);
  for (const ref of attached) {
    const wall = next.walls.find((item) => item.id === ref.wall);
    if (wall) wall[ref.end] = { x: wall[ref.end].x + dx, y: wall[ref.end].y + dy };
  }
  for (const wall of next.walls) {
    if (!ids.has(wall.id)) continue;
    wall.start = { x: wall.start.x + dx, y: wall.start.y + dy };
    wall.end = { x: wall.end.x + dx, y: wall.end.y + dy };
  }
  return next;
}

export function deleteWall(house, wallId) {
  const next = cloneHouse(house);
  next.walls = next.walls.filter((wall) => wall.id !== wallId);
  next.openings = next.openings.filter((opening) => opening.wallId !== wallId);
  return next;
}

export function resizeOpening(house, openingId, patch) {
  const next = cloneHouse(house);
  const opening = next.openings.find((item) => item.id === openingId);
  if (!opening) return { house, warnings: [] };
  if (patch.width != null) opening.width = patch.width;
  if (patch.height != null) opening.height = patch.height;
  if (patch.sill != null) opening.sill = patch.sill;
  if (patch.type) opening.type = patch.type;
  if (patch.style !== undefined) opening.style = patch.style || undefined;
  if (!opening.style) delete opening.style;
  opening.header = headerForSpan(opening.width);
  const wall = next.walls.find((item) => item.id === opening.wallId);
  const fit = wall ? openingFits(wall, next.openings, opening.offset, opening.width, opening.id) : { ok: false, reason: "lost" };
  if (!fit.ok) {
    return {
      house,
      warnings: [{
        id: `resize-${openingId}`,
        severity: "warn",
        message: fit.reason === "corner"
          ? "That size would sit too close to a corner."
          : "That size overlaps another opening.",
        target: { type: "opening", id: openingId },
      }],
    };
  }
  return { house: next, warnings: [] };
}

export function deleteOpening(house, openingId) {
  const next = cloneHouse(house);
  next.openings = next.openings.filter((opening) => opening.id !== openingId);
  return next;
}

export function placeOpening(house, wallId, catalogItem, offset) {
  const next = cloneHouse(house);
  const wall = next.walls.find((item) => item.id === wallId);
  if (!wall) return { house, warnings: [] };
  const fit = openingFits(wall, next.openings, offset, catalogItem.width);
  if (!fit.ok) {
    return {
      house,
      warnings: [{
        id: `opening-${fit.reason}`,
        severity: "warn",
        message: fit.reason === "corner"
          ? "Leave at least 6 inches between an opening and the corner."
          : "That opening overlaps another one.",
        target: { type: "wall", id: wallId },
      }],
    };
  }
  const opening = withHeader({
    id: nextId(catalogItem.type),
    wallId,
    type: catalogItem.type,
    offset,
    width: catalogItem.width,
    height: catalogItem.height,
    sill: catalogItem.sill,
    ...(catalogItem.style ? { style: catalogItem.style, hinge: "start", swingSide: "left" } : {}),
  });
  next.openings.push(opening);
  return { house: next, warnings: [], createdId: opening.id };
}

export function setWallAssembly(house, wallId, assemblyId) {
  const next = cloneHouse(house);
  const wall = next.walls.find((item) => item.id === wallId);
  if (!wall) return next;
  Object.assign(wall, applyAssembly(wall, assemblyId));
  return next;
}
