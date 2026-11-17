/**
 * Groups: things that select, move, turn, and resize as one, like a group in
 * a design app. A traced drawing and a placed template are grouped; any
 * selection can be grouped or ungrouped from the Arrange bar.
 * house.groups = [{ id, name, members: [{ type, id }] }]. No DOM.
 */

const KEYS = { wall: "walls", room: "rooms", column: "columns", furniture: "furniture", image: "images", skylight: "skylights", siteFeature: "siteFeatures", planLabel: "planLabels" };

/** Can this kind of pick be in a group? */
export function groupable(pick) {
  return !!KEYS[pick?.type];
}

function exists(house, pick) {
  return (house[KEYS[pick.type]] || []).some((item) => item.id === pick.id);
}

export function groupOf(house, pick) {
  if (!pick) return null;
  return (house.groups || []).find((group) => group.members.some((m) => m.type === pick.type && m.id === pick.id)) || null;
}

/** The members of a group that are still in the house. */
export function groupMembers(house, group) {
  return (group?.members || []).filter((m) => exists(house, m)).map((m) => ({ type: m.type, id: m.id }));
}

/** True when these picks are exactly the group's (living) members. */
export function isWholeGroup(house, group, picks) {
  const members = groupMembers(house, group);
  if (!members.length || members.length !== picks.length) return false;
  return members.every((m) => picks.some((p) => p.type === m.type && p.id === m.id));
}

/** Group these picks (taking them out of any other group). Mutates; returns the new group. */
export function makeGroup(house, picks, name, id) {
  const members = picks.filter(groupable).map((p) => ({ type: p.type, id: p.id }));
  if (members.length < 2) return null;
  const taken = (m) => members.some((p) => p.type === m.type && p.id === m.id);
  house.groups = (house.groups || [])
    .map((group) => ({ ...group, members: group.members.filter((m) => !taken(m)) }))
    .filter((group) => group.members.length > 1);
  const group = { id, name: name || "Group", members };
  house.groups.push(group);
  return group;
}

/** Drop a group (its members stay). Mutates. */
export function ungroup(house, groupId) {
  house.groups = (house.groups || []).filter((group) => group.id !== groupId);
  return house;
}

/** Forget members that were deleted, and groups left with fewer than two. Mutates. */
export function pruneGroups(house) {
  if (!Array.isArray(house.groups)) return house;
  house.groups = house.groups
    .map((group) => ({ ...group, members: group.members.filter((m) => exists(house, m)) }))
    .filter((group) => group.members.length > 1);
  return house;
}
