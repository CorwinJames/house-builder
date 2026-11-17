/**
 * Picture layers on the plan: an image pasted or dropped in (from Affinity
 * Designer or anywhere), placed and sized in feet, and the step that turns a
 * traced drawing into walls, doors, and rooms. No DOM.
 *
 * An image record: { id, name, x, y (middle, ft), width, height (ft),
 * rotation (degrees counter-clockwise), opacity, src (data URL), pxWidth,
 * pxHeight, lines? }. `lines` holds the straight lines of a pasted SVG,
 * normalized to the picture ([u1, v1, u2, v2], 0 to 1 across and down).
 */
import { makeWall } from "./walls.js";
import { DEFAULT_EXTERIOR_ID, INTERIOR_ID, headerForSpan, suggestAssemblyId } from "./catalog.js";
import { nextId } from "./ids.js";
import { clipTogether, endsAt, withJoins } from "./clips.js";
import { detectFaces, syncRooms } from "./rooms.js";
import { openingFits } from "./openings.js";
import { pointInPolygon } from "../lib/geom.js";

/** Plan point (ft) for a spot on the picture (u, v from 0 to 1, v down). */
export function imageToPlan(image, u, v) {
  const lx = (u - 0.5) * image.width;
  const ly = (0.5 - v) * image.height;
  const rad = ((image.rotation || 0) * Math.PI) / 180;
  return {
    x: image.x + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: image.y + lx * Math.sin(rad) + ly * Math.cos(rad),
  };
}

/** Spot on the picture (u, v) for a plan point. */
export function planToImage(image, point) {
  const rad = ((image.rotation || 0) * Math.PI) / 180;
  const dx = point.x - image.x;
  const dy = point.y - image.y;
  const lx = dx * Math.cos(rad) + dy * Math.sin(rad);
  const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
  return { u: lx / image.width + 0.5, v: 0.5 - ly / image.height };
}

/** The picture's four corners on the plan. */
export function imageCorners(image) {
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => imageToPlan(image, u, v));
}

export function pointOnImage(image, point) {
  const { u, v } = planToImage(image, point);
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** Pixels of the stored picture per foot on the plan. */
export function imagePxPerFt(image) {
  return (image.pxWidth || 1000) / Math.max(0.01, image.width);
}

/**
 * Rescale so the line from a to b (plan points on the picture) is `feet`
 * long, keeping point a where it is.
 */
export function rescaleImage(image, a, b, feet) {
  const now = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(now > 1e-6) || !(feet > 0)) return image;
  const k = feet / now;
  return {
    ...image,
    width: image.width * k,
    height: image.height * k,
    x: a.x + (image.x - a.x) * k,
    y: a.y + (image.y - a.y) * k,
  };
}

/** Normalized segments (from trace.js) to plan feet. */
export function segmentsToFeet(image, segments) {
  return segments.map((seg) => ({
    a: imageToPlan(image, seg.a.u, seg.a.v),
    b: imageToPlan(image, seg.b.u, seg.b.v),
    thick: (seg.thick || 0) * image.width,
  }));
}

/** A new image record sized to `width` ft across. */
export function makeImage({ src, pxWidth, pxHeight, name = "Pasted image", lines = null }, at, width, id = nextId("image")) {
  const height = width * (pxHeight / Math.max(1, pxWidth));
  const image = { id, name, x: at.x, y: at.y, width, height, rotation: 0, opacity: 0.6, src, pxWidth, pxHeight };
  if (lines?.length) image.lines = lines;
  return image;
}

/**
 * Put traced walls (and doors) into the house. Walls that face outside get
 * the exterior wall type (rammed earth on a south face, as when drawing a
 * room), walls between rooms the partition. Returns { house, picks, counts }.
 */
export function addTracedPlan(house, plan, { makeId = nextId } = {}) {
  const next = JSON.parse(JSON.stringify(house));
  withJoins(next);
  const level = next.levels?.[0]?.id || "main";
  const height = next.levels?.[0]?.plateHeight || 10;
  const made = plan.walls.map((wall) => {
    const created = makeWall(wall.start, wall.end, INTERIOR_ID, "phase1", level, height);
    created.id = makeId("wall");
    return created;
  });
  // Find the rooms the new walls close, to tell outside walls from partitions.
  const faces = detectFaces(made);
  const inside = (p) => faces.some((face) => pointInPolygon(p, face.polygon));
  for (const wall of made) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
    const reach = 0.9;
    const left = inside({ x: mid.x + nx * reach, y: mid.y + ny * reach });
    const right = inside({ x: mid.x - nx * reach, y: mid.y - ny * reach });
    if (left && right) continue;
    const outward = left ? { x: -nx, y: -ny } : { x: nx, y: ny };
    const id = suggestAssemblyId(wall.start, wall.end, DEFAULT_EXTERIOR_ID, false, outward);
    Object.assign(wall, makeWall(wall.start, wall.end, id, "phase1", level, height), { id: wall.id });
  }
  next.walls.push(...made);
  const ids = made.map((wall) => wall.id);
  for (const wall of made) {
    for (const end of ["start", "end"]) {
      const touching = endsAt(next, wall[end], { tolerance: 0.05 }).filter((ref) => ids.includes(ref.wall));
      if (touching.length > 1) clipTogether(next, touching);
    }
  }
  let doors = 0;
  let openings = 0;
  for (const item of plan.openings) {
    const wall = made[item.wall];
    if (!wall) continue;
    const width = Math.round(item.width * 12) / 12;
    if (!openingFits(wall, next.openings, item.offset, width).ok) continue;
    const door = width <= 4;
    next.openings.push({
      id: makeId("door"),
      wallId: wall.id,
      type: "door",
      style: door ? "swing" : "cased",
      offset: item.offset,
      width,
      height: 6.667,
      sill: 0,
      hinge: "start",
      swingSide: "left",
      header: headerForSpan(width),
    });
    if (door) doors += 1;
    else openings += 1;
  }
  const before = new Set(next.rooms.map((room) => room.id));
  const synced = syncRooms(next, detectFaces(next.walls));
  const picks = [
    ...ids.map((id) => ({ type: "wall", id })),
    ...synced.rooms.filter((room) => !before.has(room.id)).map((room) => ({ type: "room", id: room.id })),
  ];
  return {
    house: synced,
    picks,
    counts: { walls: made.length, doors, openings, rooms: picks.filter((pick) => pick.type === "room").length },
  };
}
