/**
 * Furnishings: real-size fixtures, appliances, and a wardrobe to place like
 * The Sims. Each sits with its back to the nearest wall, facing into the
 * room. Fixtures that need water or a 240 V circuit, standing against a
 * wall, are also that plumbing fixture or electrical device: placing, moving, turning, copying, or
 * deleting the piece keeps its point in step (`syncFurnishings`), so pipes,
 * circuits, code checks, and cost follow it.
 *
 * Sizes are common published sizes in inches (width across the front, depth
 * from the wall, height), each from the cited guide. They are not a product
 * and not a price. Stored as plan furniture: { kind, name, x, y, rotation,
 * width, depth, link? }. Local +y is the front; rotation is degrees
 * counter-clockwise from east.
 */
import { nextId } from "./ids.js";
import { fixtureFromClick, nearestWall } from "../plumbing/design.js";
import { deviceFromClick } from "../electrical/design.js";

const SIZES = {
  wayfairBath: { name: "Wayfair: Bathroom layout dimensions", url: "https://www.wayfair.com/sca/ideas-and-advice/rooms/bathroom-layout-dimensions-your-guide-to-bathroom-space-planning-T808" },
  showerSize: { name: "Wayfair Canada: Bathroom space planning (shower 36 × 36 in.)", url: "https://www.wayfair.ca/sca/ideas-and-advice/rooms/bathroom-space-planning-guidelines-T808" },
  itemfits: { name: "ItemFits: Furniture and appliance dimensions", url: "https://itemfits.com/blog/furniture-dimensions-database-standard-sizes" },
  cabinets: { name: "Epic Home Ideas: base cabinets 24 in. deep, 34½–36 in. tall", url: "https://www.epichomeideas.com/?p=6203" },
};

const inch = (n) => n / 12;

export const FURNISHINGS = [
  { kind: "toilet", group: "Bath", name: "Toilet", icon: "🚽", w: 20, d: 30, h: 30, link: { system: "plumbing", kind: "toilet" }, source: "wayfairBath", note: "20 in. wide, 28–30 in. deep." },
  { kind: "bath-sink", group: "Bath", name: "Bathroom sink", icon: "🚰", w: 30, d: 21, h: 34, link: { system: "plumbing", kind: "lavatory" }, source: "wayfairBath", note: "Vanity 24–72 in. wide, 20–21 in. deep, 32–36 in. tall; 30 in. here." },
  { kind: "shower", group: "Bath", name: "Shower", icon: "🚿", w: 36, d: 36, h: 80, link: { system: "plumbing", kind: "shower" }, source: "showerSize", note: "Standing shower 36 × 36 in. inside. The glass height is drawn, not cited." },
  { kind: "kitchen-sink", group: "Kitchen", name: "Kitchen sink", icon: "🍽", w: 36, d: 24, h: 36, link: { system: "plumbing", kind: "kitchen-sink" }, source: "cabinets", note: "Sink base cabinet: 24 in. deep, 36 in. tall; 36 in. wide here." },
  { kind: "stove", group: "Kitchen", name: "Stove", icon: "🔥", w: 30, d: 27, h: 36, link: { system: "electrical", kind: "range" }, source: "itemfits", note: "Range 30 in. wide, 25–28 in. deep, 36 in. tall." },
  { kind: "dishwasher", group: "Kitchen", name: "Dishwasher", icon: "🫧", w: 24, d: 24, h: 34, link: { system: "plumbing", kind: "dishwasher" }, source: "itemfits", note: "24 × 24 in., 34 in. tall." },
  { kind: "fridge", group: "Kitchen", name: "Fridge", icon: "🧊", w: 36, d: 32, h: 70, link: null, source: "itemfits", note: "Standard fridge 30–36 in. wide, 30–35 in. deep, 65–71 in. tall." },
  { kind: "washer", group: "Laundry", name: "Washing machine", icon: "🌀", w: 27, d: 30, h: 38, link: { system: "plumbing", kind: "washer" }, source: "itemfits", note: "27 in. wide, 27–32 in. deep, 36–42 in. tall." },
  { kind: "dryer", group: "Laundry", name: "Dryer", icon: "♨", w: 27, d: 30, h: 38, link: { system: "electrical", kind: "dryer" }, source: "itemfits", note: "27 in. wide, 27–32 in. deep, 36–42 in. tall." },
  { kind: "wardrobe", group: "Bedroom", name: "Wardrobe", icon: "🚪", w: 42, d: 24, h: 72, link: null, source: "itemfits", note: "Armoire or wardrobe 36–48 in. wide, 20–24 in. deep, 60–72 in. tall." },
];

export const FURNISH_SOURCES = SIZES;

export function furnishing(kind) {
  return FURNISHINGS.find((item) => item.kind === kind) || null;
}

export function isFurnishing(item) {
  return !!furnishing(item?.kind);
}

/** Height in feet, for 3D. */
export function furnishingHeight(kind) {
  const spec = furnishing(kind);
  return spec ? inch(spec.h) : null;
}

/** The nearest wall face within `reach` feet of a point, and which side the point is on. */
function wallFace(house, point, reach) {
  let best = null;
  for (const wall of house.walls || []) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    const ux = dx / length;
    const uy = dy / length;
    const t = (point.x - wall.start.x) * ux + (point.y - wall.start.y) * uy;
    if (t < -0.25 || t > length + 0.25) continue;
    const side = (point.x - wall.start.x) * -uy + (point.y - wall.start.y) * ux;
    const distance = Math.abs(side) - (Number(wall.thickness) || 0.5) / 2;
    if (distance > reach) continue;
    if (!best || distance < best.distance) {
      const sign = side >= 0 ? 1 : -1;
      best = { wall, t: Math.max(0, Math.min(length, t)), length, ux, uy, nx: -uy * sign, ny: ux * sign, distance };
    }
  }
  return best;
}

/**
 * Where a piece of `kind` sits when the pointer is at `point`: back against
 * the nearest wall within reach, facing into the room, slid along the wall so
 * it stays on it. Away from walls it keeps `rotation`.
 * Returns { x, y, rotation, wallId }.
 */
export function furnishPose(house, kind, point, rotation = 0, reach = 3) {
  const spec = furnishing(kind);
  if (!spec) return { x: point.x, y: point.y, rotation, wallId: null };
  const width = inch(spec.w);
  const depth = inch(spec.d);
  const face = wallFace(house, point, reach + depth / 2);
  if (!face) return { x: point.x, y: point.y, rotation, wallId: null };
  const half = (Number(face.wall.thickness) || 0.5) / 2;
  const t = face.length > width ? Math.max(width / 2, Math.min(face.length - width / 2, face.t)) : face.length / 2;
  const x = face.wall.start.x + face.ux * t + face.nx * (half + depth / 2 + 0.02);
  const y = face.wall.start.y + face.uy * t + face.ny * (half + depth / 2 + 0.02);
  // Local +y (the front) points along the wall's room-side normal.
  const turn = (Math.atan2(-face.nx, face.ny) * 180) / Math.PI;
  return { x: round(x), y: round(y), rotation: round(((turn % 360) + 360) % 360), wallId: face.wall.id };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** A new furnishing as a furniture record. */
export function makeFurnishing(house, kind, point, rotation = 0, id = nextId("furniture")) {
  const spec = furnishing(kind);
  const pose = furnishPose(house, kind, point, rotation);
  return {
    id,
    kind,
    name: spec.name,
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
    width: inch(spec.w),
    depth: inch(spec.d),
  };
}

/** The middle of the piece's back edge, where its water or power point goes. */
export function backPoint(item) {
  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const back = (item.depth || 2) / 2;
  return { x: item.x + Math.sin(rad) * back, y: item.y - Math.cos(rad) * back };
}

/**
 * Keep each furnishing's plumbing fixture or 240 V device with it. Makes a
 * point for a piece that has none (or shares one with a copy), moves it to
 * the wall behind the piece, and removes points whose piece is gone. Mutates.
 */
export function syncFurnishings(house) {
  house.plumbing = house.plumbing || { fixtures: [] };
  house.plumbing.fixtures = house.plumbing.fixtures || [];
  house.electrical = house.electrical || { devices: [] };
  house.electrical.devices = house.electrical.devices || [];
  const lists = { plumbing: house.plumbing.fixtures, electrical: house.electrical.devices };
  const claimed = new Set();
  for (const item of house.furniture || []) {
    const spec = furnishing(item.kind);
    if (!spec?.link) {
      delete item.link;
      continue;
    }
    const list = lists[spec.link.system];
    // Only a piece standing against a wall gets its pipe or circuit.
    if (!nearestWall(house, backPoint(item), 1.5)) {
      delete item.link;
      continue;
    }
    let point = item.link ? list.find((entry) => entry.id === item.link.id) : null;
    if (point && (point.furnitureId !== item.id || claimed.has(point.id))) point = null;
    const at = backPoint(item);
    const fresh = spec.link.system === "plumbing"
      ? fixtureFromClick(house, at, spec.link.kind)
      : deviceFromClick(house, at, spec.link.kind);
    if (point) {
      const { id, ...rest } = fresh;
      void id;
      Object.assign(point, rest, { furnitureId: item.id });
    } else {
      fresh.furnitureId = item.id;
      list.push(fresh);
      point = fresh;
    }
    claimed.add(point.id);
    item.link = { system: spec.link.system, id: point.id };
  }
  const alive = new Set((house.furniture || []).map((item) => item.id));
  house.plumbing.fixtures = house.plumbing.fixtures.filter((entry) => !entry.furnitureId || (alive.has(entry.furnitureId) && claimed.has(entry.id)));
  house.electrical.devices = house.electrical.devices.filter((entry) => !entry.furnitureId || (alive.has(entry.furnitureId) && claimed.has(entry.id)));
  return house;
}
