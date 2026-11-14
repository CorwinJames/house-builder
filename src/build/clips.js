/**
 * Which wall ends are clipped together. No DOM.
 *
 * Two walls whose ends sit on the same spot can be either:
 * - clipped on: one piece. Moving one end moves the other with it.
 * - laid on: they only touch. Each still moves on its own.
 * Both draw the same (see joins.js). Only clipped ends are listed here.
 *
 * `house.joins` is a list of groups: { id, ends: [{ wall, end }] }, where `end`
 * is "start" or "end". A file saved before schema 8 has no `joins`; its ends
 * that already touch are treated as clipped, so old plans behave as before.
 */

import { nextId } from "./ids.js";

export const CLIP_TOL = 0.25;

function pointOf(house, ref) {
  const wall = (house.walls || []).find((item) => item.id === ref.wall);
  return wall ? wall[ref.end] : null;
}

const same = (a, b) => a.wall === b.wall && a.end === b.end;

/** Group ends that already touch. Used for files saved before clips existed. */
export function inferJoins(walls, tolerance = CLIP_TOL) {
  const ends = [];
  for (const wall of walls || []) {
    if (!wall?.start || !wall?.end) continue;
    ends.push({ wall: wall.id, end: "start", at: wall.start }, { wall: wall.id, end: "end", at: wall.end });
  }
  const parent = ends.map((_, index) => index);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      if (ends[i].wall === ends[j].wall) continue;
      if (Math.hypot(ends[i].at.x - ends[j].at.x, ends[i].at.y - ends[j].at.y) <= tolerance) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  ends.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push({ wall: item.wall, end: item.end });
  });
  return [...groups.values()].filter((group) => group.length > 1).map((group, index) => ({ id: `join-${index + 1}`, ends: group }));
}

/** Give a house its clip list. Old files infer one; newer files keep theirs. */
export function withJoins(house) {
  if (!Array.isArray(house.joins)) house.joins = inferJoins(house.walls);
  return house;
}

/** Ends clipped to this one (not including itself). */
export function partnersOf(house, wallId, end) {
  const me = { wall: wallId, end };
  const group = (house.joins || []).find((item) => item.ends.some((ref) => same(ref, me)));
  return group ? group.ends.filter((ref) => !same(ref, me)) : [];
}

export function isClipped(house, wallId, end) {
  return partnersOf(house, wallId, end).length > 0;
}

/** Clip these ends into one group, merging any groups they were already in. Mutates. */
export function clipTogether(house, refs) {
  withJoins(house);
  const list = refs.filter(Boolean);
  if (list.length < 2) return house;
  const touched = house.joins.filter((group) => group.ends.some((ref) => list.some((item) => same(ref, item))));
  const ends = [];
  for (const ref of [...touched.flatMap((group) => group.ends), ...list]) {
    if (!ends.some((item) => same(item, ref))) ends.push({ wall: ref.wall, end: ref.end });
  }
  house.joins = house.joins.filter((group) => !touched.includes(group));
  house.joins.push({ id: touched[0]?.id || nextId("join"), ends });
  return house;
}

/** Take one wall end out of its clip group. Mutates. */
export function unclipEnd(house, wallId, end) {
  withJoins(house);
  const me = { wall: wallId, end };
  for (const group of house.joins) group.ends = group.ends.filter((ref) => !same(ref, me));
  house.joins = house.joins.filter((group) => group.ends.length > 1);
  return house;
}

/** Ends of other walls sitting on this point (within `tolerance`). */
export function endsAt(house, point, { exclude = [], tolerance = 0.05 } = {}) {
  const out = [];
  for (const wall of house.walls || []) {
    if (exclude.includes(wall.id)) continue;
    for (const end of ["start", "end"]) {
      const at = wall[end];
      if (at && Math.hypot(at.x - point.x, at.y - point.y) <= tolerance) out.push({ wall: wall.id, end });
    }
  }
  return out;
}

/** Drop clips to walls that are gone, and ends that drifted apart. Mutates. */
export function pruneJoins(house, tolerance = CLIP_TOL + 0.1) {
  if (!Array.isArray(house.joins)) return house;
  for (const group of house.joins) {
    group.ends = group.ends.filter((ref) => pointOf(house, ref));
    const anchor = group.ends[0] && pointOf(house, group.ends[0]);
    if (anchor) {
      group.ends = group.ends.filter((ref) => {
        const at = pointOf(house, ref);
        return Math.hypot(at.x - anchor.x, at.y - anchor.y) <= tolerance;
      });
    }
  }
  house.joins = house.joins.filter((group) => group.ends.length > 1);
  return house;
}

/** A wall was cut in two: its old far end now belongs to the new piece. Mutates. */
export function remapSplit(house, wallId, bornId) {
  for (const group of house.joins || []) {
    for (const ref of group.ends) {
      if (ref.wall === wallId && ref.end === "end") ref.wall = bornId;
    }
  }
  return house;
}
