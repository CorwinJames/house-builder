/**
 * Turn a line drawing into walls and doors. No DOM.
 *
 * Two ways in, both giving line segments in image-normalized coordinates
 * (u, v from 0 to 1 across and down the image, `thick` as a fraction of the
 * image width):
 *  - `rasterSegments(image)`: a picture (RGBA pixels). Dark strokes running
 *    across or down the picture are found row by row and column by column.
 *    Only straight, square-on strokes are found this way.
 *  - `svgSegments(text)`: vector lines pasted from a drawing app (Affinity
 *    Designer with "Copy items as SVG" on, Illustrator, Figma). Lines,
 *    polylines, polygons, rectangles, and the straight parts of paths, at any
 *    angle, through nested transforms. Curves (door swings) are skipped.
 *
 * `planFromSegments(segments, options)` then works in feet:
 *  1. near-square angles snap square;
 *  2. parallel lines close together (a wall drawn with two lines, or a
 *     filled wall's two edges) become one wall down their middle;
 *  3. pieces on one line join; a gap of door width becomes a door (or a
 *     wide opening), when doors are on;
 *  4. ends that stop short of, or run past, another wall meet it;
 *  5. short loose bits (a door leaf, a label) are dropped.
 * It returns walls { start, end, thick, paired } and openings
 * { wall, offset, width }.
 */

// ------------------------------------------------------------------ raster

/** Which pixels are ink: dark and not see-through. The cut-off sits between the paper and the ink (Otsu). */
export function inkMask(image) {
  const { width, height, data } = image;
  const lum = new Uint8Array(width * height);
  const hist = new Array(256).fill(0);
  let opaque = 0;
  for (let i = 0; i < width * height; i += 1) {
    const a = data[i * 4 + 3];
    // See-through counts as paper (Affinity copies on a clear background).
    const l = a < 128 ? 255 : Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    lum[i] = l;
    hist[l] += 1;
    opaque += 1;
  }
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let cut = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = opaque - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      cut = t;
    }
  }
  cut = Math.max(60, Math.min(200, cut));
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) mask[i] = lum[i] <= cut ? 1 : 0;
  return mask;
}

/** Strokes along one axis: rows of runs that line up, each becoming one segment. */
function strokes(mask, width, height, along, { minRun, maxThick }) {
  const out = [];
  const lines = along === "x" ? height : width;
  const span = along === "x" ? width : height;
  const at = along === "x" ? (i, j) => mask[i * width + j] : (i, j) => mask[j * width + i];
  let active = [];
  const finish = (stroke) => {
    const rows = stroke.last - stroke.first + 1;
    if (rows > maxThick) return;
    const starts = stroke.starts.slice().sort((a, b) => a - b);
    const ends = stroke.ends.slice().sort((a, b) => a - b);
    const s0 = starts[Math.floor(starts.length / 2)];
    const s1 = ends[Math.floor(ends.length / 2)];
    const c = (stroke.first + stroke.last + 1) / 2;
    out.push({ along, c, s0, s1: s1 + 1, thick: rows });
  };
  for (let i = 0; i < lines; i += 1) {
    const runs = [];
    let start = -1;
    for (let j = 0; j <= span; j += 1) {
      const ink = j < span && at(i, j);
      if (ink && start < 0) start = j;
      if (!ink && start >= 0) {
        if (j - start >= minRun) runs.push([start, j - 1]);
        start = -1;
      }
    }
    const next = [];
    const used = new Set();
    for (const stroke of active) {
      let match = -1;
      for (let r = 0; r < runs.length; r += 1) {
        if (used.has(r)) continue;
        const [a, b] = runs[r];
        const overlap = Math.min(b, stroke.b) - Math.max(a, stroke.a);
        if (overlap >= 0.7 * Math.min(b - a, stroke.b - stroke.a)) {
          match = r;
          break;
        }
      }
      if (match < 0) {
        finish(stroke);
        continue;
      }
      used.add(match);
      const [a, b] = runs[match];
      stroke.starts.push(a);
      stroke.ends.push(b);
      stroke.a = a;
      stroke.b = b;
      stroke.last = i;
      next.push(stroke);
    }
    runs.forEach(([a, b], r) => {
      if (!used.has(r)) next.push({ a, b, first: i, last: i, starts: [a], ends: [b] });
    });
    active = next;
  }
  for (const stroke of active) finish(stroke);
  return out;
}

/**
 * Straight strokes across and down a picture, as normalized segments.
 * `pxPerFt` sizes the search: strokes thicker than `maxThickFt` (a filled
 * room, a hatch) are skipped, and runs must be longer than that to count.
 */
export function rasterSegments(image, { pxPerFt = 10, maxThickFt = 2, minWallFt = 1.5 } = {}) {
  const { width, height } = image;
  const mask = inkMask(image);
  const maxThick = Math.max(3, Math.round(maxThickFt * pxPerFt));
  const minRun = Math.max(8, Math.ceil(Math.max(maxThick * 1.1, minWallFt * pxPerFt)));
  const segments = [];
  for (const along of ["x", "y"]) {
    for (const s of strokes(mask, width, height, along, { minRun, maxThick })) {
      const a = along === "x" ? { u: s.s0 / width, v: s.c / height } : { u: s.c / width, v: s.s0 / height };
      const b = along === "x" ? { u: s.s1 / width, v: s.c / height } : { u: s.c / width, v: s.s1 / height };
      segments.push({ a, b, thick: s.thick / width });
    }
  }
  return segments;
}

// ------------------------------------------------------------------ svg

const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function numbers(text) {
  return (String(text || "").match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
}

/** An SVG transform attribute as a matrix. */
export function parseTransform(text) {
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let found;
  while ((found = re.exec(String(text || "")))) {
    const n = numbers(found[2]);
    let t = IDENTITY;
    if (found[1] === "matrix" && n.length >= 6) t = n.slice(0, 6);
    if (found[1] === "translate") t = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    if (found[1] === "scale") t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    if (found[1] === "rotate") {
      const r = ((n[0] || 0) * Math.PI) / 180;
      const rot = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      t = n.length >= 3 ? multiply(multiply([1, 0, 0, 1, n[1], n[2]], rot), [1, 0, 0, 1, -n[1], -n[2]]) : rot;
    }
    if (found[1] === "skewX") t = [1, 0, Math.tan(((n[0] || 0) * Math.PI) / 180), 1, 0, 0];
    if (found[1] === "skewY") t = [1, Math.tan(((n[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}

function attr(attrs, name) {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return found ? (found[2] ?? found[3]) : null;
}

/** The straight pieces of a path's d attribute. Curves and arcs move the pen without drawing a wall. */
export function pathLines(d) {
  const out = [];
  const tokens = String(d || "").match(/[MmLlHhVvZzCcSsQqTtAa]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const counts = { C: 6, S: 4, Q: 4, T: 2, A: 7 };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) {
      i += 1;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      if (x !== sx || y !== sy) out.push([x, y, sx, sy]);
      x = sx;
      y = sy;
      continue;
    }
    if (!isNum()) continue;
    if (C === "M") {
      x = rel ? x + num() : num();
      y = rel ? y + num() : num();
      sx = x;
      sy = y;
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      const nx = rel ? x + num() : num();
      const ny = rel ? y + num() : num();
      out.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    } else if (C === "H") {
      const nx = rel ? x + num() : num();
      out.push([x, y, nx, y]);
      x = nx;
    } else if (C === "V") {
      const ny = rel ? y + num() : num();
      out.push([x, y, x, ny]);
      y = ny;
    } else if (counts[C]) {
      const n = [];
      for (let k = 0; k < counts[C] && isNum(); k += 1) n.push(num());
      if (n.length >= 2) {
        x = rel ? x + n[n.length - 2] : n[n.length - 2];
        y = rel ? y + n[n.length - 1] : n[n.length - 1];
      }
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * Straight lines in pasted SVG, normalized to its viewBox (or its drawn
 * extent), plus that box's size in SVG units.
 */
export function svgSegments(text) {
  const source = String(text || "");
  const raw = [];
  const stack = [IDENTITY];
  let viewBox = null;
  let skip = 0;
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let tag;
  while ((tag = tagRe.exec(source))) {
    const [, closing, nameRaw, attrs, selfClosing] = tag;
    const name = nameRaw.toLowerCase().replace(/^svg:/, "");
    if (closing) {
      if (name === "defs" || name === "clippath" || name === "mask" || name === "symbol" || name === "pattern") skip = Math.max(0, skip - 1);
      if (name === "g" || name === "svg" || name === "a") stack.pop();
      continue;
    }
    if (name === "defs" || name === "clippath" || name === "mask" || name === "symbol" || name === "pattern") {
      if (!selfClosing) skip += 1;
      continue;
    }
    const parent = stack[stack.length - 1] || IDENTITY;
    const own = multiply(parent, parseTransform(attr(attrs, "transform")));
    if (name === "svg" && !viewBox) {
      const vb = numbers(attr(attrs, "viewBox"));
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) viewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    }
    if (name === "g" || name === "svg" || name === "a") {
      if (!selfClosing) stack.push(own);
      continue;
    }
    if (skip) continue;
    const push = (x1, y1, x2, y2) => {
      const p = apply(own, x1, y1);
      const q = apply(own, x2, y2);
      if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-6) raw.push([p.x, p.y, q.x, q.y]);
    };
    if (name === "line") {
      push(Number(attr(attrs, "x1")) || 0, Number(attr(attrs, "y1")) || 0, Number(attr(attrs, "x2")) || 0, Number(attr(attrs, "y2")) || 0);
    } else if (name === "polyline" || name === "polygon") {
      const n = numbers(attr(attrs, "points"));
      for (let k = 0; k + 3 < n.length; k += 2) push(n[k], n[k + 1], n[k + 2], n[k + 3]);
      if (name === "polygon" && n.length >= 6) push(n[n.length - 2], n[n.length - 1], n[0], n[1]);
    } else if (name === "rect") {
      const x = Number(attr(attrs, "x")) || 0;
      const y = Number(attr(attrs, "y")) || 0;
      const w = Number(attr(attrs, "width")) || 0;
      const h = Number(attr(attrs, "height")) || 0;
      if (w > 0 && h > 0) {
        push(x, y, x + w, y);
        push(x + w, y, x + w, y + h);
        push(x + w, y + h, x, y + h);
        push(x, y + h, x, y);
      }
    } else if (name === "path") {
      for (const [x1, y1, x2, y2] of pathLines(attr(attrs, "d"))) push(x1, y1, x2, y2);
    }
  }
  let box = viewBox;
  if (!box && raw.length) {
    const xs = raw.flatMap((r) => [r[0], r[2]]);
    const ys = raw.flatMap((r) => [r[1], r[3]]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    box = { x: x0, y: y0, w: Math.max(1e-6, Math.max(...xs) - x0), h: Math.max(1e-6, Math.max(...ys) - y0) };
  }
  if (!box) return { segments: [], box: null };
  const segments = raw.map(([x1, y1, x2, y2]) => ({
    a: { u: (x1 - box.x) / box.w, v: (y1 - box.y) / box.h },
    b: { u: (x2 - box.x) / box.w, v: (y2 - box.y) / box.h },
    thick: 0,
  }));
  return { segments, box };
}

/** The SVG root sized to `width` × `height` pixels, so it draws at a known size. */
export function sizedSvg(text, width, height) {
  return String(text).replace(/<svg\b([^>]*)>/i, (all, attrs) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return `<svg${cleaned} width="${Math.round(width)}" height="${Math.round(height)}">`;
  });
}

// ------------------------------------------------------------------ plan

const DEG = Math.PI / 180;

function dirOf(seg) {
  let angle = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
  if (angle < 0) angle += Math.PI;
  if (angle >= Math.PI - 1e-9) angle -= Math.PI;
  return angle;
}

/** Square up lines within `tolDeg` of across or down. */
function squareUp(seg, tolDeg) {
  const angle = dirOf(seg);
  const targets = [0, Math.PI / 2, Math.PI];
  for (const target of targets) {
    if (Math.abs(angle - target) > tolDeg * DEG) continue;
    const mx = (seg.a.x + seg.b.x) / 2;
    const my = (seg.a.y + seg.b.y) / 2;
    const half = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) / 2;
    const ux = Math.cos(target);
    const uy = Math.sin(target);
    return { ...seg, a: { x: mx - ux * half, y: my - uy * half }, b: { x: mx + ux * half, y: my + uy * half } };
  }
  return seg;
}

/** A line as (angle, offset, interval) in its own frame. */
function frame(seg, angle) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const t0 = seg.a.x * ux + seg.a.y * uy;
  const t1 = seg.b.x * ux + seg.b.y * uy;
  const off = (seg.a.x * -uy + seg.a.y * ux + seg.b.x * -uy + seg.b.y * ux) / 2;
  return { angle, off, t0: Math.min(t0, t1), t1: Math.max(t0, t1), thick: seg.thick || 0 };
}

function mergeIntervals(list, join) {
  const sorted = list.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + join) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Walls and openings from segments in feet ({ a, b, thick }).
 * Options: doors (gaps become doors), minWall (ft), maxPair (widest wall
 * drawn as two lines, ft), doorMin / doorMax (ft), angleTol (degrees).
 */
export function planFromSegments(input, options = {}) {
  const {
    doors = true,
    minWall = 1.5,
    looseMax = 4,
    maxPair = 1.6,
    doorMin = 1.8,
    doorMax = 8,
    angleTol = 3,
    lineTol = 0.25,
  } = options;
  const segs = input
    .filter((seg) => Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) >= 0.25)
    .map((seg) => squareUp(seg, angleTol));
  // 1. Group by direction (within 1.5°).
  const groups = [];
  for (const seg of segs) {
    const angle = dirOf(seg);
    let group = groups.find((g) => Math.abs(g.angle - angle) < 1.5 * DEG || Math.abs(Math.abs(g.angle - angle) - Math.PI) < 1.5 * DEG);
    if (!group) {
      group = { angle, items: [] };
      groups.push(group);
    }
    group.items.push(seg);
  }
  const bands = [];
  for (const group of groups) {
    const lines = group.items.map((seg) => frame(seg, group.angle));
    // 2. Lines that run side by side, close together, are one wall's faces.
    const parent = lines.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < lines.length; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const a = lines[i];
        const b = lines[j];
        const gap = Math.abs(a.off - b.off);
        if (gap > maxPair) continue;
        const overlap = Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0);
        const shorter = Math.min(a.t1 - a.t0, b.t1 - b.t0);
        if (gap <= lineTol ? overlap > -0.5 : overlap >= Math.min(0.5 * shorter, 1)) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map();
    lines.forEach((line, i) => {
      const root = find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(line);
    });
    for (const members of clusters.values()) {
      const offs = members.map((line) => line.off);
      const lo = Math.min(...offs);
      const hi = Math.max(...offs);
      const stroke = Math.max(...members.map((line) => line.thick));
      bands.push({
        angle: group.angle,
        off: (lo + hi) / 2,
        thick: hi - lo > lineTol ? hi - lo + stroke : stroke,
        paired: hi - lo > lineTol,
        intervals: mergeIntervals(members.map((line) => [line.t0, line.t1]), 0.05),
      });
    }
  }
  // Pieces of one wall on the same line (split by a door) are one band.
  for (let i = 0; i < bands.length; i += 1) {
    for (let j = bands.length - 1; j > i; j -= 1) {
      const a = bands[i];
      const b = bands[j];
      const same = Math.abs(a.angle - b.angle) < 1.5 * DEG || Math.abs(Math.abs(a.angle - b.angle) - Math.PI) < 1.5 * DEG;
      if (!same || Math.abs(a.off - b.off) > Math.max(lineTol, Math.min(a.thick, b.thick) / 2)) continue;
      if (Math.abs(a.thick - b.thick) > 0.5) continue;
      a.intervals = mergeIntervals([...a.intervals, ...b.intervals], 0.05);
      a.thick = Math.max(a.thick, b.thick);
      a.paired = a.paired || b.paired;
      bands.splice(j, 1);
    }
  }
  // 3. Pieces along one line: join small gaps, turn door-sized gaps into openings.
  const walls = [];
  const openings = [];
  for (const band of bands) {
    const ux = Math.cos(band.angle);
    const uy = Math.sin(band.angle);
    const at = (t) => ({ x: ux * t - uy * band.off, y: uy * t + ux * band.off });
    const runs = mergeIntervals(band.intervals, 0.5);
    let current = null;
    const flush = () => {
      if (!current) return;
      const index = walls.length;
      walls.push({ start: at(current.t0), end: at(current.t1), thick: band.thick, paired: band.paired });
      for (const gap of current.gaps) openings.push({ wall: index, center: at((gap[0] + gap[1]) / 2), width: gap[1] - gap[0] });
      current = null;
    };
    for (const [t0, t1] of runs) {
      if (current && doors && t0 - current.t1 >= doorMin && t0 - current.t1 <= doorMax) {
        current.gaps.push([current.t1, t0]);
        current.t1 = t1;
        continue;
      }
      flush();
      current = { t0, t1, gaps: [] };
    }
    flush();
  }
  // 4. Ends meet the wall they stop short of or run past.
  const meet = (passes) => {
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 0; i < walls.length; i += 1) {
        for (const end of ["start", "end"]) {
          const p = walls[i][end];
          const q = walls[i][end === "start" ? "end" : "start"];
          let best = null;
          for (let j = 0; j < walls.length; j += 1) {
            if (j === i) continue;
            const w = walls[j];
            const hit = intersect(q, p, w.start, w.end);
            if (!hit) continue;
            const tol = Math.max(0.75, (walls[i].thick + w.thick) / 2 + 0.4);
            const reach = Math.hypot(hit.x - p.x, hit.y - p.y);
            if (reach > tol) continue;
            // The meeting point must sit on the other wall (or just past its end).
            const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
            const along = ((hit.x - w.start.x) * (w.end.x - w.start.x) + (hit.y - w.start.y) * (w.end.y - w.start.y)) / len;
            if (along < -tol || along > len + tol) continue;
            if (!best || reach < best.reach) best = { reach, hit };
          }
          if (best) walls[i][end] = best.hit;
        }
      }
    }
  };
  meet(2);
  // Walls that cross (an X) are cut where they cross, so the rooms on each side are found.
  const cuts = walls.map(() => []);
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const a = walls[i];
      const b = walls[j];
      const hit = intersect(a.start, a.end, b.start, b.end);
      if (!hit) continue;
      const ta = along(a, hit);
      const tb = along(b, hit);
      const la = length(a);
      const lb = length(b);
      const inA = ta > 0.3 && ta < la - 0.3;
      const inB = tb > 0.3 && tb < lb - 0.3;
      // Only a true crossing: a wall that stops on another (a tee) is found as it is.
      if (!inA || !inB) continue;
      cuts[i].push(ta);
      cuts[j].push(tb);
    }
  }
  const pieces = [];
  const moved = [];
  walls.forEach((wall, i) => {
    const len = length(wall);
    const stops = [0, ...cuts[i].sort((p, q) => p - q), len];
    const ids = [];
    for (let k = 0; k + 1 < stops.length; k += 1) {
      if (stops[k + 1] - stops[k] < 0.05) continue;
      ids.push({ index: pieces.length, t0: stops[k], t1: stops[k + 1] });
      pieces.push({ ...wall, start: at(wall, stops[k]), end: at(wall, stops[k + 1]) });
    }
    moved.push(ids);
  });
  for (const opening of openings) {
    const wall = walls[opening.wall];
    const t = along(wall, opening.center);
    const piece = moved[opening.wall].find((item) => t >= item.t0 && t <= item.t1) || moved[opening.wall][0];
    if (piece) opening.wall = piece.index;
  }
  walls.length = 0;
  walls.push(...pieces);
  // 5. Drop short bits, and loose short ones (door leaves, labels).
  const touches = (p, skip) => walls.some((w, j) => j !== skip && !w.dropped && distToSeg(p, w.start, w.end) <= 0.3);
  let changed = true;
  while (changed) {
    changed = false;
    walls.forEach((w, i) => {
      if (w.dropped) return;
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      const loose = !touches(w.start, i) || !touches(w.end, i);
      if (len < minWall || (len < looseMax && loose)) {
        w.dropped = true;
        changed = true;
      }
    });
  }
  const keep = [];
  const index = new Map();
  walls.forEach((w, i) => {
    if (w.dropped) return;
    index.set(i, keep.length);
    keep.push({ start: round(w.start), end: round(w.end), thick: w.thick, paired: w.paired });
  });
  const kept = [];
  for (const opening of openings) {
    if (!index.has(opening.wall)) continue;
    const wall = keep[index.get(opening.wall)];
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const along = ((opening.center.x - wall.start.x) * (wall.end.x - wall.start.x) + (opening.center.y - wall.start.y) * (wall.end.y - wall.start.y)) / (len || 1);
    const offset = along - opening.width / 2;
    if (offset < 0 || offset + opening.width > len) continue;
    kept.push({ wall: index.get(opening.wall), offset: Math.round(offset * 1000) / 1000, width: Math.round(opening.width * 1000) / 1000 });
  }
  return { walls: keep, openings: kept };
}

function length(w) {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
}

function along(w, p) {
  const len = length(w) || 1;
  return ((p.x - w.start.x) * (w.end.x - w.start.x) + (p.y - w.start.y) * (w.end.y - w.start.y)) / len;
}

function at(w, t) {
  const len = length(w) || 1;
  return { x: w.start.x + ((w.end.x - w.start.x) * t) / len, y: w.start.y + ((w.end.y - w.start.y) * t) / len };
}

function round(p) {
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
}

/** Where line p→q (extended) crosses line a→b (extended), or null if parallel. */
function intersect(p, q, a, b) {
  const d1x = q.x - p.x;
  const d1y = q.y - p.y;
  const d2x = b.x - a.x;
  const d2y = b.y - a.y;
  const den = d1x * d2y - d1y * d2x;
  const l1 = Math.hypot(d1x, d1y);
  const l2 = Math.hypot(d2x, d2y);
  if (!l1 || !l2 || Math.abs(den) / (l1 * l2) < Math.sin(10 * DEG)) return null;
  const t = ((a.x - p.x) * d2y - (a.y - p.y) * d2x) / den;
  return { x: p.x + d1x * t, y: p.y + d1y * t };
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
