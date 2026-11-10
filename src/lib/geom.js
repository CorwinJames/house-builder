/** Plan geometry in feet. +x east, +y north. No Three.js here. */

export function wallLength(wall) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

export function pointAlong(wall, distance) {
  const len = wallLength(wall) || 1;
  const t = distance / len;
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  };
}

/** Quad around a centerline segment. Thickness is centered on the segment. */
export function segmentQuad(x0, y0, x1, y1, thickness) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (thickness / 2);
  const ny = ((x1 - x0) / len) * (thickness / 2);
  return [
    { x: x0 + nx, y: y0 + ny },
    { x: x1 + nx, y: y1 + ny },
    { x: x1 - nx, y: y1 - ny },
    { x: x0 - nx, y: y0 - ny },
  ];
}

export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonCentroid(polygon) {
  let areaTwice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    areaTwice += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(areaTwice) < 1e-8) {
    const n = polygon.length || 1;
    return {
      x: polygon.reduce((sum, p) => sum + p.x, 0) / n,
      y: polygon.reduce((sum, p) => sum + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * areaTwice), y: cy / (3 * areaTwice) };
}

export function openingsFor(house, wall) {
  return house.openings
    .filter((opening) => opening.wallId === wall.id)
    .slice()
    .sort((a, b) => a.offset - b.offset);
}

/**
 * Solid pieces of a wall, split by openings.
 * Each opening also contributes a sill (if any) and a header.
 */
export function wallPieces(wall, openings) {
  const len = wallLength(wall);
  const height = wall.height;
  const pieces = [];
  let cursor = 0;
  for (const opening of openings) {
    const start = opening.offset;
    const end = opening.offset + opening.width;
    if (start > cursor + 0.001) {
      pieces.push({ s0: cursor, s1: start, z0: 0, z1: height, kind: "solid" });
    }
    if (opening.sill > 0.001) {
      pieces.push({ s0: start, s1: end, z0: 0, z1: opening.sill, kind: "solid" });
    }
    const head = opening.sill + opening.height;
    if (head < height - 0.001) {
      pieces.push({ s0: start, s1: end, z0: head, z1: height, kind: "solid" });
    }
    const kind = opening.type === "window" ? "window" : opening.style || "swing";
    pieces.push({ s0: start, s1: end, z0: opening.sill, z1: head, kind, opening });
    cursor = end;
  }
  if (cursor < len - 0.001) {
    pieces.push({ s0: cursor, s1: len, z0: 0, z1: height, kind: "solid" });
  }
  return pieces;
}
