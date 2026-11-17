/**
 * Lining things up, like a design app: left, centre, or right edges, and
 * top, middle, or bottom edges. No DOM.
 *
 * A selection is first split into the pieces that move as one ("units"):
 *  - a group is one unit;
 *  - rooms and walls that share a wall or touch at a wall end are one unit
 *    (a section of house drawn as several rooms stays together);
 *  - every other picked thing (a picture, a piece of furniture, a label) is
 *    its own unit.
 * The unit holding the first thing picked stays still; the others move
 * straight across (or straight up or down) to line up with it.
 */
import { groupOf, groupMembers } from "./groups.js";
import { nudgeSelection, roomWallIds, selectionBounds, selectionSet, separateSelection } from "./transform.js";

export const ALIGNMENTS = [
  { id: "left", label: "Left edges", axis: "x" },
  { id: "center", label: "Centres, left to right", axis: "x" },
  { id: "right", label: "Right edges", axis: "x" },
  { id: "top", label: "Top edges", axis: "y" },
  { id: "middle", label: "Middles, top to bottom", axis: "y" },
  { id: "bottom", label: "Bottom edges", axis: "y" },
];

const key = (pick) => `${pick.type}:${pick.id}`;

function wallsOf(house, pick) {
  if (pick.type === "wall") return [pick.id];
  if (pick.type === "room") {
    const room = (house.rooms || []).find((item) => item.id === pick.id);
    return room ? [...roomWallIds(house, room)] : [];
  }
  return [];
}

/** The selection split into units, in the order their first thing was picked. */
export function selectionUnits(house, picks) {
  const usable = picks.filter((pick) => pick.type !== "opening" && pick.type !== "endpoint");
  const units = [];
  const placed = new Set();
  // Groups first, each whole.
  const groupUnit = new Map();
  for (const pick of usable) {
    const group = groupOf(house, pick);
    if (!group) continue;
    if (!groupUnit.has(group.id)) {
      const members = groupMembers(house, group).filter((m) => usable.some((p) => key(p) === key(m)));
      groupUnit.set(group.id, { order: usable.indexOf(pick), picks: members });
    }
    placed.add(key(pick));
  }
  // Rooms and walls that touch go together.
  const loose = usable.filter((pick) => !placed.has(key(pick)));
  const structural = loose.filter((pick) => pick.type === "room" || pick.type === "wall");
  const parent = structural.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const wallSets = structural.map((pick) => new Set(wallsOf(house, pick)));
  const ends = wallSets.map((ids) => [...ids].flatMap((id) => {
    const wall = (house.walls || []).find((item) => item.id === id);
    return wall ? [wall.start, wall.end] : [];
  }));
  for (let i = 0; i < structural.length; i += 1) {
    for (let j = i + 1; j < structural.length; j += 1) {
      const shared = [...wallSets[i]].some((id) => wallSets[j].has(id));
      const touching = shared || ends[i].some((a) => ends[j].some((b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05));
      if (touching) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map();
  structural.forEach((pick, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, { order: usable.indexOf(pick), picks: [] });
    const cluster = clusters.get(root);
    cluster.order = Math.min(cluster.order, usable.indexOf(pick));
    cluster.picks.push(pick);
  });
  // Things inside a picked room ride with that room (selectionSet brings them).
  const inside = new Set();
  for (const cluster of clusters.values()) {
    const set = selectionSet(house, cluster.picks);
    for (const piece of set.pieces) inside.add(`${piece.type}:${piece.id}`);
  }
  for (const pick of loose) {
    if (pick.type === "room" || pick.type === "wall" || inside.has(key(pick))) continue;
    units.push({ order: usable.indexOf(pick), picks: [pick] });
  }
  units.push(...groupUnit.values(), ...clusters.values());
  return units.sort((a, b) => a.order - b.order).map((unit) => unit.picks).filter((list) => list.length);
}

function edge(box, how) {
  if (how === "left") return box.x0;
  if (how === "right") return box.x1;
  if (how === "center") return (box.x0 + box.x1) / 2;
  if (how === "top") return box.y1;
  if (how === "bottom") return box.y0;
  return (box.y0 + box.y1) / 2;
}

/**
 * Line the selection's units up with the first one. Top is north (+y).
 * Returns { house, moved, detached, units }, or { house } unchanged when
 * there is fewer than two units.
 */
export function alignSelection(house, picks, how) {
  const spec = ALIGNMENTS.find((item) => item.id === how);
  if (!spec) return { house, moved: 0, units: 0 };
  // A room picked on its own takes only its stretch of a shared wall.
  let doc = separateSelection(house, picks).house;
  const units = selectionUnits(doc, picks);
  if (units.length < 2) return { house, moved: 0, units: units.length };
  const boxOf = (unit) => selectionBounds(doc, selectionSet(doc, unit));
  const keyBox = boxOf(units[0]);
  if (!keyBox) return { house, moved: 0, units: units.length };
  const target = edge(keyBox, how);
  let moved = 0;
  let detached = 0;
  for (const unit of units.slice(1)) {
    const box = boxOf(unit);
    if (!box) continue;
    const delta = target - edge(box, how);
    if (Math.abs(delta) < 1e-6) continue;
    const result = nudgeSelection(doc, selectionSet(doc, unit), spec.axis === "x" ? delta : 0, spec.axis === "y" ? delta : 0);
    doc = result.house;
    detached += result.detached || 0;
    moved += 1;
  }
  return { house: moved ? doc : house, moved, detached, units: units.length };
}
