import { polygonArea, polygonCentroid } from "../lib/geom.js";
import { nextId } from "./ids.js";

/**
 * Find enclosed rooms from wall centerlines.
 * Endpoints within `joinTol` feet of another wall are treated as joined,
 * which is how the sample's butt joints still close a room.
 * The outer face (largest area) is dropped.
 */
export function detectFaces(walls, joinTol = 1) {
  const segments = atomicSegments(walls, joinTol);
  if (segments.length < 3) return [];
  const faces = traceFaces(segments);
  const rooms = [];
  for (const face of faces) {
    const signed = signedArea(face.poly);
    if (signed < 8) continue;
    const polygon = insetCycle(face);
    if (polygon.length < 3) continue;
    const area = polygonArea(polygon);
    if (area < 8) continue;
    rooms.push({ polygon, area, edges: face.edges });
  }
  if (rooms.length <= 1) return rooms;
  // The outer boundary is the one face that contains every other centroid.
  const centers = rooms.map((room) => polygonCentroid(room.polygon));
  const outer = rooms.find((room, index) => rooms.every((other, otherIndex) => {
    if (index === otherIndex) return true;
    return pointInPoly(centers[otherIndex], room.polygon);
  }));
  if (!outer) return rooms;
  return rooms.filter((room) => room !== outer);
}

function signedArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function keyOf(point) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function project(point, wall) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return null;
  const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / len2;
  return {
    t,
    x: wall.start.x + dx * t,
    y: wall.start.y + dy * t,
    length: Math.sqrt(len2),
  };
}

function atomicSegments(walls, joinTol) {
  const cuts = new Map(walls.map((wall) => [wall.id, [0, 1]]));
  for (const wall of walls) {
    const list = cuts.get(wall.id);
    for (const other of walls) {
      if (other.id === wall.id) continue;
      for (const point of [other.start, other.end]) {
        const hit = project(point, wall);
        if (!hit) continue;
        const gap = Math.hypot(point.x - hit.x, point.y - hit.y);
        if (gap > joinTol) continue;
        if (hit.t > 0.02 && hit.t < 0.98) list.push(hit.t);
      }
    }
  }
  const segments = [];
  for (const wall of walls) {
    const unique = [...new Set(cuts.get(wall.id).map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
    for (let i = 0; i < unique.length - 1; i += 1) {
      const t0 = unique[i];
      const t1 = unique[i + 1];
      if (t1 - t0 < 0.01) continue;
      const a = {
        x: wall.start.x + (wall.end.x - wall.start.x) * t0,
        y: wall.start.y + (wall.end.y - wall.start.y) * t0,
      };
      const b = {
        x: wall.start.x + (wall.end.x - wall.start.x) * t1,
        y: wall.start.y + (wall.end.y - wall.start.y) * t1,
      };
      segments.push({ a, b, wallId: wall.id, thickness: wall.thickness || 0 });
    }
  }
  return weld(segments, joinTol);
}

/** Pull nearby endpoints together so a butt joint becomes one graph node. */
function weld(segments, joinTol) {
  const points = [];
  for (const segment of segments) {
    points.push(segment.a, segment.b);
  }
  const parent = points.map((_, index) => index);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    let y = i;
    while (parent[y] !== y) {
      const next = parent[y];
      parent[y] = x;
      y = next;
    }
    return x;
  };
  const unite = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <= joinTol) unite(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < points.length; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(points[i]);
  }
  const canonical = new Map();
  for (const [root, group] of groups) {
    const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
    const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
    canonical.set(root, { x, y });
  }
  let cursor = 0;
  return segments.map((segment) => {
    const a = canonical.get(find(cursor));
    cursor += 1;
    const b = canonical.get(find(cursor));
    cursor += 1;
    return { ...segment, a, b };
  }).filter((segment) => Math.hypot(segment.a.x - segment.b.x, segment.a.y - segment.b.y) > 0.15);
}

function traceFaces(segments) {
  const adj = new Map();
  const add = (from, to, segment) => {
    const key = keyOf(from);
    if (!adj.has(key)) adj.set(key, []);
    adj.get(key).push({
      from,
      to,
      wallId: segment.wallId,
      thickness: segment.thickness,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
    });
  };
  for (const segment of segments) {
    add(segment.a, segment.b, segment);
    add(segment.b, segment.a, segment);
  }
  for (const list of adj.values()) list.sort((a, b) => a.angle - b.angle);
  const used = new Set();
  const edgeKey = (edge) => `${keyOf(edge.from)}>${keyOf(edge.to)}`;
  const faces = [];
  for (const list of adj.values()) {
    for (const start of list) {
      if (used.has(edgeKey(start))) continue;
      const poly = [];
      const edges = [];
      let edge = start;
      let guard = 0;
      while (guard < 500) {
        guard += 1;
        if (used.has(edgeKey(edge))) break;
        used.add(edgeKey(edge));
        poly.push(edge.from);
        edges.push(edge);
        const outs = adj.get(keyOf(edge.to)) || [];
        if (outs.length === 0) break;
        const rev = Math.atan2(edge.from.y - edge.to.y, edge.from.x - edge.to.x);
        let idx = 0;
        let best = 99;
        for (let i = 0; i < outs.length; i += 1) {
          let diff = Math.abs(outs[i].angle - rev);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff < best) {
            best = diff;
            idx = i;
          }
        }
        edge = outs[(idx - 1 + outs.length) % outs.length];
        if (edgeKey(edge) === edgeKey(start)) break;
      }
      if (poly.length >= 3) faces.push({ poly, edges });
    }
  }
  return faces;
}

function insetCycle(face) {
  const { poly, edges } = face;
  if (signedArea(poly) < 0) return [];
  const lines = poly.map((from, index) => {
    const to = poly[(index + 1) % poly.length];
    const edge = edges[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const leftx = -dy / len;
    const lefty = dx / len;
    const shift = (edge?.thickness || 0) / 2;
    return {
      x: from.x + leftx * shift,
      y: from.y + lefty * shift,
      dx,
      dy,
    };
  });
  const polygon = [];
  for (let i = 0; i < lines.length; i += 1) {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const curr = lines[i];
    const hit = lineIntersect(
      { x: prev.x, y: prev.y },
      { x: prev.x + prev.dx, y: prev.y + prev.dy },
      { x: curr.x, y: curr.y },
      { x: curr.x + curr.dx, y: curr.y + curr.dy },
    );
    polygon.push(hit || { x: curr.x, y: curr.y });
  }
  return polygon;
}

function lineIntersect(a, b, c, d) {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-8) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pointInPoly(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const hit = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

/**
 * Keep names and phases when the walls move. New enclosed faces become rooms.
 * If detection finds nothing, the previous rooms stay put.
 */
export function syncRooms(house, faces = detectFaces(house.walls)) {
  if (!faces.length) return house;
  const used = new Set();
  const rooms = [];
  for (const face of faces) {
    const center = polygonCentroid(face.polygon);
    let match = null;
    for (const room of house.rooms) {
      if (used.has(room.id)) continue;
      const oldCenter = room.labelAt || polygonCentroid(room.polygon);
      const linked = pointInPoly(oldCenter, face.polygon) || pointInPoly(center, room.polygon);
      if (linked) {
        match = room;
        break;
      }
    }
    if (match) {
      used.add(match.id);
      const labelAt = match.labelAt && pointInPoly(match.labelAt, face.polygon) ? match.labelAt : undefined;
      const kept = { ...match, polygon: face.polygon };
      if (labelAt) kept.labelAt = labelAt;
      else delete kept.labelAt;
      rooms.push(kept);
    } else {
      rooms.push({
        id: nextId("room"),
        levelId: house.levels[0]?.id || "main",
        name: "Room",
        phase: "phase1",
        polygon: face.polygon,
        finish: "wood",
        conditioned: true,
      });
    }
  }
  for (const room of house.rooms) {
    if (!used.has(room.id)) rooms.push(room);
  }
  return { ...house, rooms };
}
