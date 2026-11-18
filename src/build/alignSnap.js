/**
 * Alignment snapping while dragging, like a design app. No DOM.
 *
 * While a corner is dragged, it clicks onto:
 *  - the left, right, top, or bottom edge of anything else on the plan
 *    (rooms with their walls, a room's own outline, walls, pictures, furniture,
 *    columns, groups, and whole connected sections of house), when it comes
 *    within a few screen pixels of that line;
 *  - the same width or the same depth as another of those things.
 * Each snap returns guide lines for the plan to draw, so it's clear what lined up.
 */
import { groupMembers } from "./groups.js";
import { selectionBounds, selectionSet } from "./transform.js";
import { formatFeetFine } from "../lib/format.js";

const PIECE_TYPES = [
  ["images", "image", "Picture"],
  ["furniture", "furniture", "Furniture"],
  ["columns", "column", "Column"],
];

function touches(set, moving) {
  for (const id of set.walls) if (moving.walls.has(id)) return true;
  for (const id of set.rooms) if (moving.rooms.has(id)) return true;
  for (const piece of set.pieces) if ([...moving.pieces].some((m) => m.type === piece.type && m.id === piece.id)) return true;
  return false;
}

/**
 * Everything the moving selection can line up with: a list of boxes, each
 * { box, name, sized }. `sized` boxes also offer "same width / same depth".
 * `moving` is a selection set (walls, rooms, pieces); `visible(pick)` hides
 * things that aren't shown.
 */
export function alignTargets(house, moving, { visible = () => true } = {}) {
  const out = [];
  const add = (picks, name, sized = true, rawBox = null) => {
    if (rawBox) {
      out.push({ box: rawBox, name, sized });
      return;
    }
    const set = selectionSet(house, picks);
    if (moving && touches(set, moving)) return;
    const box = selectionBounds(house, set);
    if (box && (box.width > 0.05 || box.depth > 0.05)) out.push({ box, name, sized });
  };
  for (const room of house.rooms || []) {
    if (!visible({ type: "room", id: room.id })) continue;
    if (moving?.rooms.has(room.id)) continue;
    const name = room.name || "room";
    add([{ type: "room", id: room.id }], name);
    // The room's own outline too (inside its walls).
    const xs = (room.polygon || []).map((p) => p.x);
    const ys = (room.polygon || []).map((p) => p.y);
    if (xs.length >= 3) {
      const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      Object.assign(box, { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, width: box.x1 - box.x0, depth: box.y1 - box.y0 });
      out.push({ box, name: `${name} (inside)`, sized: true });
    }
  }
  for (const wall of house.walls || []) {
    if (!visible({ type: "wall", id: wall.id })) continue;
    if (moving?.walls.has(wall.id)) continue;
    add([{ type: "wall", id: wall.id }], "a wall", true);
  }
  for (const [key, type, label] of PIECE_TYPES) {
    for (const item of house[key] || []) {
      if (!visible({ type, id: item.id })) continue;
      add([{ type, id: item.id }], item.name || item.label || label);
    }
  }
  for (const group of house.groups || []) {
    add(groupMembers(house, group), group.name || "group");
  }
  // Whole sections: rooms joined by shared walls.
  for (const section of sections(house, moving, visible)) add(section.picks, section.name);
  return out;
}

/** Rooms that share walls, as sections of house. */
function sections(house, moving, visible) {
  const rooms = (house.rooms || []).filter((room) => visible({ type: "room", id: room.id }) && !moving?.rooms.has(room.id));
  if (rooms.length < 2) return [];
  const wallSets = rooms.map((room) => selectionSet(house, [{ type: "room", id: room.id }]).walls);
  const parent = rooms.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      if ([...wallSets[i]].some((id) => wallSets[j].has(id))) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  rooms.forEach((room, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(room);
  });
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({ picks: list.map((room) => ({ type: "room", id: room.id })), name: `the section with ${list[0].name || "a room"}` }));
}

const near = (a, b) => Math.abs(a - b) < 1e-4;
const length = (feet) => formatFeetFine(feet).construction;

/**
 * Snap a corner resize. The box keeps its proportions: corner = anchor + k (from - anchor).
 * `from` is the box corner being dragged (before the resize), `box` the box
 * before the resize, `k` the factor under the cursor, `tolerance` in feet.
 * Returns { k, guides, said } (k unchanged and no guides when nothing is near).
 */
export function snapScale({ anchor, from, box, k, targets, tolerance }) {
  const dx = from.x - anchor.x;
  const dy = from.y - anchor.y;
  const candidates = [];
  const offer = (value, reach, guide) => {
    if (!Number.isFinite(value) || value <= 0.05) return;
    const miss = Math.abs(value - k) * reach;
    if (miss <= tolerance) candidates.push({ k: value, miss, guide });
  };
  for (const target of targets) {
    const t = target.box;
    if (Math.abs(dx) > 0.05) {
      for (const [edge, word] of [[t.x0, "left"], [t.x1, "right"]]) {
        offer((edge - anchor.x) / dx, Math.abs(dx), { kind: "x", at: edge, target, word });
      }
    }
    if (Math.abs(dy) > 0.05) {
      for (const [edge, word] of [[t.y0, "bottom"], [t.y1, "top"]]) {
        offer((edge - anchor.y) / dy, Math.abs(dy), { kind: "y", at: edge, target, word });
      }
    }
    if (target.sized) {
      if (box.width > 0.05 && t.width > 0.5) offer(t.width / box.width, box.width, { kind: "width", target });
      if (box.depth > 0.05 && t.depth > 0.5) offer(t.depth / box.depth, box.depth, { kind: "depth", target });
    }
  }
  if (!candidates.length) return { k, guides: [], said: "" };
  candidates.sort((a, b) => a.miss - b.miss);
  const best = candidates[0].k;
  const reach = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const hits = candidates.filter((item) => Math.abs(item.k - best) * reach < 0.01);
  const corner = { x: anchor.x + dx * best, y: anchor.y + dy * best };
  const next = {
    x0: Math.min(anchor.x, corner.x),
    x1: Math.max(anchor.x, corner.x),
    y0: Math.min(anchor.y, corner.y),
    y1: Math.max(anchor.y, corner.y),
  };
  next.width = box.width * best;
  next.depth = box.depth * best;
  // A corner resize scales the whole box about the anchor, so the far box edges are these:
  const scaled = {
    x0: anchor.x + (box.x0 - anchor.x) * best,
    x1: anchor.x + (box.x1 - anchor.x) * best,
    y0: anchor.y + (box.y0 - anchor.y) * best,
    y1: anchor.y + (box.y1 - anchor.y) * best,
  };
  const { guides, said } = describe(hits.map((item) => item.guide), corner, scaled);
  return { k: best, guides, said };
}

/**
 * Snap one dragged point (a wall end). Its x and y each click onto the edges of
 * other things; with `other` (the wall's far end), a near-straight wall can
 * also click to the same length as another thing's width or depth.
 * Returns { point, guides, said }.
 */
export function snapPoint({ point, other = null, targets, tolerance }) {
  let bestX = null;
  let bestY = null;
  const tryX = (value, guide) => {
    const miss = Math.abs(value - point.x);
    if (miss <= tolerance && (!bestX || miss < bestX.miss - 1e-6)) bestX = { value, miss, guides: [guide] };
    else if (bestX && Math.abs(value - bestX.value) < 1e-4) bestX.guides.push(guide);
  };
  const tryY = (value, guide) => {
    const miss = Math.abs(value - point.y);
    if (miss <= tolerance && (!bestY || miss < bestY.miss - 1e-6)) bestY = { value, miss, guides: [guide] };
    else if (bestY && Math.abs(value - bestY.value) < 1e-4) bestY.guides.push(guide);
  };
  const across = other ? Math.abs(point.x - other.x) >= Math.abs(point.y - other.y) : null;
  for (const target of targets) {
    const t = target.box;
    for (const [edge, word] of [[t.x0, "left"], [t.x1, "right"]]) tryX(edge, { kind: "x", at: edge, target, word });
    for (const [edge, word] of [[t.y0, "bottom"], [t.y1, "top"]]) tryY(edge, { kind: "y", at: edge, target, word });
    if (other && target.sized) {
      // Same length as another thing, along the way the wall runs.
      if (across === true && t.width > 0.5) {
        const sign = point.x >= other.x ? 1 : -1;
        tryX(other.x + sign * t.width, { kind: "width", target, from: other });
      }
      if (across === false && t.depth > 0.5) {
        const sign = point.y >= other.y ? 1 : -1;
        tryY(other.y + sign * t.depth, { kind: "depth", target, from: other });
      }
    }
  }
  const next = { x: bestX ? bestX.value : point.x, y: bestY ? bestY.value : point.y };
  const guides = [...(bestX?.guides || []), ...(bestY?.guides || [])];
  if (!guides.length) return { point, guides: [], said: "" };
  const span = other
    ? { x0: Math.min(other.x, next.x), x1: Math.max(other.x, next.x), y0: Math.min(other.y, next.y), y1: Math.max(other.y, next.y) }
    : { x0: next.x, x1: next.x, y0: next.y, y1: next.y };
  const out = describe(guides, next, span);
  return { point: next, guides: out.guides, said: out.said };
}

/** Lines to draw and a sentence to say, for the snaps that happened. */
function describe(hits, corner, moved) {
  const guides = [];
  const words = [];
  const seen = new Set();
  for (const hit of hits) {
    const t = hit.target.box;
    if (hit.kind === "x") {
      const id = `x${hit.at.toFixed(3)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      guides.push({ kind: "line", a: { x: hit.at, y: Math.min(t.y0, corner.y, moved.y0) }, b: { x: hit.at, y: Math.max(t.y1, corner.y, moved.y1) } });
      words.push(`lines up with the ${hit.word} edge of ${hit.target.name}`);
    } else if (hit.kind === "y") {
      const id = `y${hit.at.toFixed(3)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      guides.push({ kind: "line", a: { x: Math.min(t.x0, corner.x, moved.x0), y: hit.at }, b: { x: Math.max(t.x1, corner.x, moved.x1), y: hit.at } });
      words.push(`lines up with the ${hit.word === "top" ? "top" : "bottom"} edge of ${hit.target.name}`);
    } else if (hit.kind === "width") {
      if (seen.has("width")) continue;
      seen.add("width");
      const label = `${length(t.width)} — same width`;
      guides.push({ kind: "span", a: { x: t.x0, y: t.y1 }, b: { x: t.x1, y: t.y1 }, label });
      guides.push({ kind: "span", a: { x: moved.x0, y: moved.y1 }, b: { x: moved.x1, y: moved.y1 }, label });
      words.push(`same width as ${hit.target.name} (${length(t.width)})`);
    } else if (hit.kind === "depth") {
      if (seen.has("depth")) continue;
      seen.add("depth");
      const label = `${length(t.depth)} — same depth`;
      guides.push({ kind: "span", a: { x: t.x1, y: t.y1 }, b: { x: t.x1, y: t.y0 }, label });
      guides.push({ kind: "span", a: { x: moved.x1, y: moved.y1 }, b: { x: moved.x1, y: moved.y0 }, label });
      words.push(`same depth as ${hit.target.name} (${length(t.depth)})`);
    }
  }
  guides.push({ kind: "dot", a: corner });
  return { guides, said: words.length ? `Snapped: ${words.join("; ")}.` : "" };
}
