import { polygonArea } from "../lib/geom.js";

/** heated is conditioned floor. covered is a roofed outdoor area. site and study are drawn, not built. */
const KINDS = new Set(["heated", "covered", "site", "study"]);

export function areaKind(room) {
  if (KINDS.has(room?.areaKind)) return room.areaKind;
  if (room?.outdoor) return "covered";
  return "heated";
}

export function countsAsHeated(room) {
  return areaKind(room) === "heated";
}

/** A traced plan that separates the house from gardens, courtyards, and studies. */
export function separatesSite(house) {
  return (house?.rooms || []).some((room) => {
    const kind = room.areaKind;
    return kind === "site" || kind === "study" || kind === "covered";
  });
}

function pointInPoly(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const cross = (b.y - a.y) || 1e-12;
    const hit = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / cross + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

function distToSeg(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

export function nearRoom(room, point, tol = 1.25) {
  const polygon = room?.polygon || [];
  if (polygon.length < 3) return false;
  if (pointInPoly(point, polygon)) return true;
  for (let i = 0; i < polygon.length; i += 1) {
    if (distToSeg(point, polygon[i], polygon[(i + 1) % polygon.length]) <= tol) return true;
  }
  return false;
}

/** Outdoor, site, and study walls are not priced. A house with no such rooms keeps every wall. */
export function wallServesHeated(house, wall) {
  if (!separatesSite(house)) return true;
  const mid = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  };
  return (house.rooms || []).some((room) => countsAsHeated(room) && nearRoom(room, mid, 1.25));
}

/**
 * Square feet of the union, so overlapping rooms are counted once. Rooms
 * whose boxes don't overlap any other room add their exact area; only
 * clusters of overlapping rooms are sampled on a `step` grid, and only over
 * that cluster's box (sampling the whole plan's box was slow once rooms were
 * spread across the site).
 */
export function unionArea(polygons, step = 0.5) {
  const list = (polygons || []).filter((polygon) => polygon && polygon.length >= 3);
  if (!list.length) return 0;
  const boxes = list.map((polygon) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const point of polygon) {
      if (point.x < x0) x0 = point.x;
      if (point.y < y0) y0 = point.y;
      if (point.x > x1) x1 = point.x;
      if (point.y > y1) y1 = point.y;
    }
    return { x0, y0, x1, y1 };
  });
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const eps = 1e-6;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map();
  list.forEach((_, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  });
  let area = 0;
  for (const members of clusters.values()) {
    if (members.length === 1) {
      area += Math.abs(polygonArea(list[members[0]]));
      continue;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of members) {
      x0 = Math.min(x0, boxes[i].x0);
      y0 = Math.min(y0, boxes[i].y0);
      x1 = Math.max(x1, boxes[i].x1);
      y1 = Math.max(y1, boxes[i].y1);
    }
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;
    for (let y = y0; y < y1 - 1e-6; y += step) {
      const py = y + step / 2;
      for (let x = x0; x < x1 - 1e-6; x += step) {
        const px = x + step / 2;
        for (const i of members) {
          const box = boxes[i];
          if (px < box.x0 || px > box.x1 || py < box.y0 || py > box.y1) continue;
          if (pointInPoly({ x: px, y: py }, list[i])) {
            area += step * step;
            break;
          }
        }
      }
    }
  }
  return area;
}

function polygonsOf(rooms) {
  return rooms.map((room) => room.polygon).filter((polygon) => polygon && polygon.length >= 3);
}

/**
 * Heated is the main house only. The studio building is separate.
 * Covered outdoor is walkways, terraces, and courts. Site and studies are omitted.
 */
const areaCache = new WeakMap();

export function areaReport(house, step = 0.5) {
  // Read many times per redraw; the house object is replaced on every edit.
  if (house && step === 0.5 && areaCache.has(house)) return areaCache.get(house);
  const report = computeAreaReport(house, step);
  if (house && step === 0.5) areaCache.set(house, report);
  return report;
}

function computeAreaReport(house, step) {
  const rooms = house?.rooms || [];
  const heatedRooms = rooms.filter((room) => countsAsHeated(room) && (room.building || "main") !== "studio");
  const studioRooms = rooms.filter((room) => countsAsHeated(room) && room.building === "studio");
  const coveredRooms = rooms.filter((room) => areaKind(room) === "covered");
  const phaseRooms = heatedRooms.filter((room) => room.phase !== "future");
  return {
    heated: unionArea(polygonsOf(heatedRooms), step),
    studio: unionArea(polygonsOf(studioRooms), step),
    covered: unionArea(polygonsOf(coveredRooms), step),
    phase1Heated: unionArea(polygonsOf(phaseRooms), step),
    heatedShoelace: heatedRooms.reduce((sum, room) => sum + polygonArea(room.polygon || []), 0),
  };
}

export function boundsOf(rooms) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const room of rooms) {
    for (const point of room.polygon || []) {
      x0 = Math.min(x0, point.x);
      y0 = Math.min(y0, point.y);
      x1 = Math.max(x1, point.x);
      y1 = Math.max(y1, point.y);
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1, width: x1 - x0, depth: y1 - y0 };
}
