import { buildPlumbing } from "../plumbing/design.js";

/**
 * The parcel is the level. Coordinates stay in plan feet: +x east, +y north.
 * Setback numbers come from the cited tables. A sample lot is not a real parcel.
 */

export const SQFT_PER_ACRE = 43560;

/** 2021-era Table VIII gravity column, lowest suitable rate. The row match is not confirmed. */
export const FALLBACK_LOADING_RATE = 0.2;

export const SETBACKS = {
  zone: {
    section: "JCC 18.30.050 Table 6-1",
    url: "https://www.codepublishing.com/WA/JeffersonCounty/html/JeffersonCounty18/JeffersonCounty1830.html",
    frontLocalFt: 20,
    sideFt: 5,
    rearFt: 5,
  },
  well: {
    section: "WAC 173-160-171",
    url: "https://app.leg.wa.gov/WAC/default.aspx?cite=173-160-171",
    guide: "https://apps.ecology.wa.gov/publications/documents/swr9690.pdf",
    buildingFt: 5,
    // 100 ft well to the edge of the soil dispersal component and reserve,
    // and 50 ft well to the sewage tank, are WAC 246-272A-0210 Table IV
    // (nonpublic drinking water well). Checked 2026-11-12 against the adopted
    // table. WSR 26-15-117 proposes surface-water edits and leaves this well
    // row at 100 ft / 50 ft. A public well is 100 ft from the tank.
    // https://app.leg.wa.gov/wac/default.aspx?cite=246-272A-0210
    tankFt: 50,
    drainfieldFt: 100,
    publicTankFt: 100,
  },
  septic: {
    section: "WAC 246-272A-0210 Table IV",
    url: "https://app.leg.wa.gov/wac/default.aspx?cite=246-272A-0210",
    drainfieldLineFt: 5,
    tankLineFt: 5,
    drainfieldBuildingFt: 10,
    tankBuildingFt: 5,
    designFlowSection: "WAC 246-272A-0230(2)",
    designFlowUrl: "https://app.leg.wa.gov/Wac/default.aspx?cite=246-272A-0230",
    gallonsPerBedroom: 120,
    minimumGallons: 240,
    reserveSection: "WAC 246-272A-0234(8)",
    reserveUrl: "https://app.leg.wa.gov/wac/default.aspx?cite=246-272A-0234",
    loadingSection: "WAC 246-272A-0234 Table VIII",
  },
  sewerSlope: {
    section: "UPC 708.1",
    inchesPerFoot: 0.25,
    confirmSection: true,
    url: "https://www.iapmo.org/uniform-codes/upc",
  },
};

export const WELL_KINDS = [
  { id: "drilled", label: "Drilled well" },
  { id: "shared", label: "Shared well" },
  { id: "public", label: "Public water" },
];

export const SEPTIC_KINDS = [
  { id: "gravity", label: "Gravity" },
  { id: "pressure", label: "Pressure" },
  { id: "mound", label: "Mound" },
];

export function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function acres(ring) {
  return ringArea(ring) / SQFT_PER_ACRE;
}

function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function ccw(ring) {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring.slice();
}

function intersect(p, r, q, s) {
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denom;
  return { x: p.x + r.x * t, y: p.y + r.y * t };
}

/** Inset a convex ring. `distance(edgeIndex)` is the inward setback in feet. */
export function insetRing(ring, distance) {
  const poly = ccw(ring);
  const n = poly.length;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const d = distance(i, a, b);
    lines.push({ x: a.x + nx * d, y: a.y + ny * d, dx, dy });
  }
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = lines[(i - 1 + n) % n];
    const curr = lines[i];
    const hit = intersect(
      { x: prev.x, y: prev.y },
      { x: prev.dx, y: prev.dy },
      { x: curr.x, y: curr.y },
      { x: curr.dx, y: curr.dy },
    );
    out.push(hit || { x: curr.x, y: curr.y });
  }
  return out;
}

export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    const x = ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (crosses && point.x < x) inside = !inside;
  }
  return inside;
}

export function distPointSeg(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

export function distToBoundary(point, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    best = Math.min(best, distPointSeg(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

function edgeMid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** South-most edge is the front until a parcel says otherwise. */
export function frontEdgeIndex(ring, site) {
  if (Number.isInteger(site?.zone?.frontEdge)) return site.zone.frontEdge;
  const poly = ccw(ring);
  let best = 0;
  let bestY = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const mid = edgeMid(poly[i], poly[(i + 1) % poly.length]);
    if (mid.y < bestY) {
      bestY = mid.y;
      best = i;
    }
  }
  return best;
}

export function setbackForEdge(index, ring, front, zone) {
  const frontFt = zone?.frontFt ?? SETBACKS.zone.frontLocalFt;
  const sideFt = zone?.sideFt ?? SETBACKS.zone.sideFt;
  const rearFt = zone?.rearFt ?? SETBACKS.zone.rearFt;
  if (index === front) return frontFt;
  const frontMid = edgeMid(ring[front], ring[(front + 1) % ring.length]);
  let rear = front;
  let best = -1;
  for (let i = 0; i < ring.length; i += 1) {
    const mid = edgeMid(ring[i], ring[(i + 1) % ring.length]);
    const distance = Math.hypot(mid.x - frontMid.x, mid.y - frontMid.y);
    if (distance > best) {
      best = distance;
      rear = i;
    }
  }
  return index === rear ? rearFt : sideFt;
}

export function buildableRing(site) {
  const ring = site?.parcel?.ring;
  if (!ring || ring.length < 3) return [];
  const poly = ccw(ring);
  const front = frontEdgeIndex(poly, site);
  return insetRing(poly, (index) => setbackForEdge(index, poly, front, site.zone));
}

export function elevationAt(terrain, x, y) {
  if (!terrain) return 0;
  if (terrain.plane) {
    const plane = terrain.plane;
    return (plane.base || 0) + (plane.east || 0) * x + (plane.north || 0) * y;
  }
  const grid = terrain.grid;
  if (!grid?.elevations?.length) return 0;
  const col = (x - grid.origin.x) / grid.stepX;
  const row = (y - grid.origin.y) / grid.stepY;
  const c0 = Math.max(0, Math.min(grid.cols - 2, Math.floor(col)));
  const r0 = Math.max(0, Math.min(grid.rows - 2, Math.floor(row)));
  const tx = Math.min(1, Math.max(0, col - c0));
  const ty = Math.min(1, Math.max(0, row - r0));
  const at = (c, r) => grid.elevations[r * grid.cols + c] || 0;
  const a = at(c0, r0);
  const b = at(c0 + 1, r0);
  const c = at(c0, r0 + 1);
  const d = at(c0 + 1, r0 + 1);
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

export function contourLines(terrain, bounds, interval = 2) {
  if (!terrain || !bounds) return [];
  if (terrain.grid) return gridContours(terrain.grid, bounds, interval);
  if (!terrain.plane) return [];
  const lines = [];
  const z0 = elevationAt(terrain, bounds.x0, bounds.y0);
  const z1 = elevationAt(terrain, bounds.x1, bounds.y1);
  const north = terrain.plane.north || 0;
  const east = terrain.plane.east || 0;
  if (Math.abs(north) < 1e-9 && Math.abs(east) < 1e-9) return [];
  const low = Math.min(z0, z1, elevationAt(terrain, bounds.x0, bounds.y1), elevationAt(terrain, bounds.x1, bounds.y0));
  const high = Math.max(z0, z1, elevationAt(terrain, bounds.x0, bounds.y1), elevationAt(terrain, bounds.x1, bounds.y0));
  let level = Math.ceil(low / interval) * interval;
  while (level < high - 1e-6) {
    if (Math.abs(north) >= Math.abs(east)) {
      const yAt = (x) => (level - (terrain.plane.base || 0) - east * x) / north;
      const y0 = yAt(bounds.x0);
      const y1 = yAt(bounds.x1);
      if (y0 >= bounds.y0 - 1 && y0 <= bounds.y1 + 1 && y1 >= bounds.y0 - 1 && y1 <= bounds.y1 + 1) {
        lines.push([{ x: bounds.x0, y: y0, level }, { x: bounds.x1, y: y1, level }]);
      }
    }
    level += interval;
  }
  return lines;
}

function gridContours(grid, bounds, interval) {
  const lines = [];
  const at = (c, r) => grid.elevations[r * grid.cols + c];
  for (let r = 0; r < grid.rows - 1; r += 1) {
    for (let c = 0; c < grid.cols - 1; c += 1) {
      const corners = [
        { x: grid.origin.x + c * grid.stepX, y: grid.origin.y + r * grid.stepY, z: at(c, r) },
        { x: grid.origin.x + (c + 1) * grid.stepX, y: grid.origin.y + r * grid.stepY, z: at(c + 1, r) },
        { x: grid.origin.x + (c + 1) * grid.stepX, y: grid.origin.y + (r + 1) * grid.stepY, z: at(c + 1, r + 1) },
        { x: grid.origin.x + c * grid.stepX, y: grid.origin.y + (r + 1) * grid.stepY, z: at(c, r + 1) },
      ];
      const low = Math.min(...corners.map((point) => point.z));
      const high = Math.max(...corners.map((point) => point.z));
      for (let level = Math.ceil(low / interval) * interval; level < high - 1e-6; level += interval) {
        const pts = [];
        for (let i = 0; i < 4; i += 1) {
          const a = corners[i];
          const b = corners[(i + 1) % 4];
          if ((a.z - level) * (b.z - level) >= 0) continue;
          const t = (level - a.z) / (b.z - a.z);
          pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, level });
        }
        if (pts.length >= 2) lines.push([pts[0], pts[1]]);
      }
    }
  }
  return lines.filter((line) => line[0].x >= bounds.x0 - 1 && line[0].x <= bounds.x1 + 1);
}

export function ringBounds(ring) {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function bedroomCount(house) {
  return (house.rooms || []).filter((room) => /bed/i.test(room.name || "") && !/bath/i.test(room.name || "")).length;
}

export function designFlowGallons(house) {
  const bedrooms = Math.max(1, bedroomCount(house));
  return Math.max(SETBACKS.septic.minimumGallons, bedrooms * SETBACKS.septic.gallonsPerBedroom);
}

export function requiredFieldArea(house, site) {
  const rate = site?.septic?.loadingRate || FALLBACK_LOADING_RATE;
  return designFlowGallons(house) / rate;
}

/** Width and depth of one drainfield, from the required area. The click is the center. */
export function fieldFootprint(house) {
  const area = Math.max(120, requiredFieldArea(house, house.site || {}));
  const width = Math.sqrt(area * 2);
  const depth = area / width;
  return { width, depth };
}

const SITE_NO_FIT = "No well and drain field fit on this lot at the distances this check uses: 100 ft from the well to the drain field (WAC 246-272A-0210 Table IV), 50 ft from the well to the tank, 10 ft from the drain field to the house, and 5 ft from the property line. Options: public or shared water, or a smaller pressure or mound system. The county health department decides.";

function occupiedRect(house) {
  const walls = (house.walls || []).filter((wall) => wall.phase !== "future");
  if (!walls.length) return buildingRect(house);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wall of walls) {
    minX = Math.min(minX, wall.start.x, wall.end.x);
    minY = Math.min(minY, wall.start.y, wall.end.y);
    maxX = Math.max(maxX, wall.start.x, wall.end.x);
    maxY = Math.max(maxY, wall.start.y, wall.end.y);
  }
  if (!Number.isFinite(minX) || maxX - minX < 1) return buildingRect(house);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rectAt(center, field) {
  return {
    x: center.x - field.width / 2,
    y: center.y - field.depth / 2,
    width: field.width,
    depth: field.depth,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.depth && a.y + a.depth > b.y;
}

function pullInside(corner, center, field, pad) {
  const dx = Math.sign(center.x - corner.x) || 1;
  const dy = Math.sign(center.y - corner.y) || 1;
  return {
    x: corner.x + dx * (field.width / 2 + pad),
    y: corner.y + dy * (field.depth / 2 + pad),
  };
}

function tankBeside(fieldCenter, well, center, field) {
  const dx = Math.sign(center.x - fieldCenter.x) || 1;
  const dy = Math.sign(center.y - fieldCenter.y) || 1;
  const tank = {
    x: fieldCenter.x + dx * (field.width / 2 + 8),
    y: fieldCenter.y + dy * (field.depth / 2 + 8),
  };
  const awayX = Math.sign(tank.x - well.x) || 1;
  const awayY = Math.sign(tank.y - well.y) || 1;
  let guard = 0;
  while (Math.hypot(tank.x - well.x, tank.y - well.y) < SETBACKS.well.tankFt + 1 && guard < 16) {
    tank.x += awayX * 6;
    tank.y += awayY * 6;
    guard += 1;
  }
  return tank;
}

function layoutFits(site, layout) {
  const ring = site.parcel.ring;
  const buildable = buildableRing(site);
  const inside = buildable.length >= 3 ? buildable : ring;
  const field = rectAt(layout.fieldCenter, layout.field);
  const reserve = rectAt(layout.reserveCenter, layout.field);
  const building = layout.building;
  if (rectsOverlap(field, reserve)) return false;
  if (!pointInRing(layout.well, inside) || distToBoundary(layout.well, ring) < 5) return false;
  if (!pointInRing(layout.tank, inside) || distToBoundary(layout.tank, ring) < SETBACKS.septic.tankLineFt) return false;
  if (rectBoundaryClearance(field, ring) < SETBACKS.septic.drainfieldLineFt) return false;
  if (rectBoundaryClearance(reserve, ring) < SETBACKS.septic.drainfieldLineFt) return false;
  if (distPointRect(layout.well, field) < SETBACKS.well.drainfieldFt) return false;
  if (distPointRect(layout.well, reserve) < SETBACKS.well.drainfieldFt) return false;
  if (Math.hypot(layout.well.x - layout.tank.x, layout.well.y - layout.tank.y) < SETBACKS.well.tankFt) return false;
  if (distPointRect(layout.well, { ...building, depth: building.height ?? building.depth }) < SETBACKS.well.buildingFt) return false;
  if (distPointRect(layout.tank, { ...building, depth: building.height ?? building.depth }) < SETBACKS.septic.tankBuildingFt) return false;
  if (distRectToRect(field, { ...building, depth: building.height ?? building.depth }) < SETBACKS.septic.drainfieldBuildingFt) return false;
  if (distRectToRect(reserve, { ...building, depth: building.height ?? building.depth }) < SETBACKS.septic.drainfieldBuildingFt) return false;
  return true;
}

/**
 * Opposite corners of the buildable lot, and only a layout that meets the
 * cited setbacks. The returned x/y for a field is its center, which is what
 * placeSite expects. An empty list means no layout fit; `.note` says why.
 */
export function suggestSite(house) {
  const site = house.site || {};
  const ring = site.parcel?.ring;
  const empty = (note) => {
    const spots = [];
    spots.note = note;
    return spots;
  };
  if (!ring || ring.length < 3) return empty("Draw the property line first. This check needs a lot outline.");
  const buildable = buildableRing(site);
  const bounds = ringBounds(buildable.length >= 3 ? buildable : ring);
  if (!bounds) return empty(SITE_NO_FIT);
  const field = fieldFootprint(house);
  const building = occupiedRect(house);
  const center = { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 };
  const pad = 4;
  const corners = [
    { x: bounds.x0 + pad, y: bounds.y0 + pad },
    { x: bounds.x1 - pad, y: bounds.y0 + pad },
    { x: bounds.x1 - pad, y: bounds.y1 - pad },
    { x: bounds.x0 + pad, y: bounds.y1 - pad },
    { x: center.x, y: bounds.y0 + pad },
    { x: bounds.x1 - pad, y: center.y },
    { x: center.x, y: bounds.y1 - pad },
    { x: bounds.x0 + pad, y: center.y },
  ];
  const opposite = [2, 3, 0, 1, 6, 7, 4, 5];
  for (let i = 0; i < corners.length; i += 1) {
    const well = { ...corners[i] };
    const far = corners[opposite[i]];
    const fieldCenter = pullInside(far, center, field, pad);
    let reserveCenter = pullInside(
      { x: far.x + Math.sign(center.x - far.x) * (field.width + 8), y: far.y },
      center,
      field,
      pad,
    );
    if (rectsOverlap(rectAt(fieldCenter, field), rectAt(reserveCenter, field))) {
      reserveCenter = {
        x: fieldCenter.x + Math.sign(center.x - fieldCenter.x || 1) * (field.width + 6),
        y: fieldCenter.y,
      };
    }
    const tank = tankBeside(fieldCenter, well, center, field);
    const candidate = { well, tank, fieldCenter, reserveCenter, field, building };
    if (!layoutFits(site, candidate)) continue;
    const spots = [
      { kind: "well", label: "Well", x: well.x, y: well.y },
      { kind: "tank", label: "Septic tank", x: tank.x, y: tank.y },
      { kind: "drainfield", label: "Drain field", x: fieldCenter.x, y: fieldCenter.y, width: field.width, depth: field.depth },
      { kind: "reserve", label: "Reserve area", x: reserveCenter.x, y: reserveCenter.y, width: field.width, depth: field.depth },
    ];
    spots.note = "Well and drain field sit on opposite corners, at least 100 ft apart. That distance is WAC 246-272A-0210 Table IV (checked 2026-11-12). The circle is that 100 ft.";
    return spots;
  }
  return empty(SITE_NO_FIT);
}

export function rectArea(rect) {
  if (!rect) return 0;
  return Math.abs(rect.width * rect.depth);
}

export function distPointRect(point, rect) {
  if (!rect) return Infinity;
  const x = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const y = Math.max(rect.y, Math.min(point.y, rect.y + rect.depth));
  return Math.hypot(point.x - x, point.y - y);
}

export function buildingRect(house) {
  const box = house.footprint || { width: 0, depth: 0 };
  return { x: 0, y: 0, width: box.width || 0, height: box.depth || 0 };
}

export function distRectToRect(a, b) {
  if (!a || !b) return Infinity;
  const ax1 = a.x + a.width;
  const ay1 = a.y + (a.depth ?? a.height);
  const bx1 = b.x + b.width;
  const by1 = b.y + (b.depth ?? b.height);
  const gapX = a.x > bx1 ? a.x - bx1 : (b.x > ax1 ? b.x - ax1 : 0);
  const gapY = a.y > by1 ? a.y - by1 : (b.y > ay1 ? b.y - ay1 : 0);
  return Math.hypot(gapX, gapY);
}

export function rectCorners(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.depth },
    { x: rect.x, y: rect.y + rect.depth },
  ];
}

export function rectBoundaryClearance(rect, ring) {
  if (!rect || !ring?.length) return Infinity;
  return Math.min(...rectCorners(rect).map((point) => (pointInRing(point, ring) ? distToBoundary(point, ring) : 0)));
}

export function gradePad(house) {
  const terrain = house.site?.terrain;
  const pad = buildingRect(house);
  if (!terrain || !(pad.width > 0)) return { cutYd: 0, fillYd: 0, padFt: 0, samples: 0 };
  const cell = 2;
  const heights = [];
  for (let x = pad.x + cell / 2; x < pad.x + pad.width; x += cell) {
    for (let y = pad.y + cell / 2; y < pad.y + pad.height; y += cell) {
      heights.push(elevationAt(terrain, x, y));
    }
  }
  if (!heights.length) return { cutYd: 0, fillYd: 0, padFt: 0, samples: 0 };
  const padFt = typeof house.site?.pad?.elevation === "number"
    ? house.site.pad.elevation
    : heights.reduce((sum, value) => sum + value, 0) / heights.length;
  let cut = 0;
  let fill = 0;
  const area = cell * cell;
  for (const height of heights) {
    const delta = height - padFt;
    if (delta > 0) cut += delta * area;
    else fill += -delta * area;
  }
  return {
    cutYd: cut / 27,
    fillYd: fill / 27,
    padFt,
    samples: heights.length,
  };
}

export function gravityCheck(house) {
  const site = house.site;
  const tank = site?.septic?.tank;
  const plumbing = buildPlumbing(house);
  const stub = plumbing.septic || house.plumbing?.septic;
  const stubInches = plumbing.building?.slope?.inches || 0;
  if (!tank || !stub) {
    return { ok: false, reason: "missing", stubInches, needInches: 0, groundInches: 0, runFt: 0 };
  }
  const runFt = Math.hypot(tank.x - stub.x, tank.y - stub.y);
  const needInches = runFt * SETBACKS.sewerSlope.inchesPerFoot;
  const groundInches = (elevationAt(site.terrain, stub.x, stub.y) - elevationAt(site.terrain, tank.x, tank.y)) * 12;
  const pumped = site.septic.kind === "pressure" || site.septic.kind === "mound";
  return {
    ok: pumped || groundInches + 1e-6 >= needInches,
    pumped,
    stubInches,
    needInches,
    groundInches,
    runFt,
    shortInches: Math.max(0, needInches - groundInches),
  };
}

export function buildSite(house) {
  const site = house.site;
  if (!site?.parcel?.ring) return null;
  const ring = ccw(site.parcel.ring);
  const bounds = ringBounds(ring);
  const buildable = buildableRing(site);
  const flow = designFlowGallons(house);
  const needed = requiredFieldArea(house, site);
  return {
    ring,
    bounds,
    acres: acres(ring),
    buildable,
    contours: contourLines(site.terrain, bounds, site.terrain?.contourFt || 2),
    flow,
    bedrooms: bedroomCount(house),
    fieldSqFt: needed,
    reserveSqFt: rectArea(site.septic?.reserve),
    primarySqFt: rectArea(site.septic?.drainfield),
    grade: gradePad(house),
    gravity: gravityCheck(house),
    soilName: site.soil?.mapUnitName || "Not mapped",
  };
}

export function wallMid(wall) {
  return { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
}

export function outsideBuildable(house) {
  const view = buildSite(house);
  if (!view?.buildable?.length) return [];
  return (house.walls || []).filter((wall) => wall.role === "exterior" && !pointInRing(wallMid(wall), view.buildable));
}

export function hitSite(house, point, limit = 8) {
  const site = house.site;
  if (!site) return null;
  const hits = [];
  if (site.well) {
    hits.push({ type: "well", id: site.well.id || "well", distance: Math.hypot(site.well.x - point.x, site.well.y - point.y) });
  }
  if (site.septic?.tank) {
    hits.push({ type: "septic", id: "tank", distance: Math.hypot(site.septic.tank.x - point.x, site.septic.tank.y - point.y) });
  }
  for (const [type, rect] of [["drainfield", site.septic?.drainfield], ["reserve", site.septic?.reserve]]) {
    if (!rect) continue;
    const inside = point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.depth;
    hits.push({ type, id: type, distance: inside ? 0 : distPointRect(point, rect) });
  }
  const near = hits.filter((hit) => hit.distance <= limit).sort((a, b) => a.distance - b.distance);
  return near[0] || null;
}

export function siteBom(house) {
  const view = buildSite(house);
  if (!view) return [];
  const rows = [];
  if (house.site?.well && house.site.well.kind !== "public") {
    rows.push({
      id: house.site.well.kind === "shared" ? "well-shared" : "well-drilled",
      category: "site",
      quantity: 1,
      unit: "each",
      kind: "material",
      basis: "One well. No published drilling price was found, so the line stays price needed.",
    });
  }
  if (house.site?.septic?.tank) {
    rows.push({
      id: "septic-tank",
      category: "site",
      quantity: 1,
      unit: "each",
      kind: "material",
      basis: "One sewage tank. No published tank price was found.",
    });
  }
  if (view.primarySqFt > 0) {
    rows.push({
      id: "drainfield",
      category: "site",
      quantity: Math.round(view.primarySqFt + view.reserveSqFt),
      unit: "square foot",
      kind: "material",
      basis: "Primary drainfield plus the reserve area. No published install price was found.",
    });
  }
  if (view.grade.samples) {
    rows.push({
      id: "grading",
      category: "site",
      quantity: Math.round((view.grade.cutYd + view.grade.fillYd) * 10) / 10,
      unit: "cubic yard",
      kind: "material",
      basis: "Cut plus fill on the house pad, from the terrain grid. No published excavation price was found.",
    });
  }
  return rows.filter((row) => row.quantity > 0);
}

export function placeSite(house, point, kind) {
  const next = structuredClone(house);
  next.site = next.site || {};
  if (kind === "well") {
    next.site.well = { id: "well-1", kind: next.site.well?.kind || "drilled", x: point.x, y: point.y };
    return { house: next, selection: { type: "well", id: "well-1" } };
  }
  if (kind === "tank" || kind === "septic") {
    next.site.septic = {
      ...(next.site.septic || { kind: "gravity", loadingRate: FALLBACK_LOADING_RATE, loadingConfirm: true }),
      tank: { x: point.x, y: point.y },
    };
    return { house: next, selection: { type: "septic", id: "tank" } };
  }
  if (kind === "drainfield" || kind === "reserve") {
    const area = requiredFieldArea(next, next.site);
    const width = Math.sqrt(area * 2);
    const depth = area / width;
    next.site.septic = {
      ...(next.site.septic || { kind: "gravity", loadingRate: FALLBACK_LOADING_RATE, loadingConfirm: true }),
      [kind]: { x: point.x - width / 2, y: point.y - depth / 2, width, depth },
    };
    return { house: next, selection: { type: kind, id: kind } };
  }
  return { house: next, selection: null };
}
