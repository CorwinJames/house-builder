import { wallLength } from "../lib/geom.js";
import { cornerClearance } from "./catalog.js";

export function openingFits(wall, openings, offset, width, ignoreId = null, clearance = cornerClearance()) {
  const length = wallLength(wall);
  if (width <= 0 || length <= 0) return { ok: false, reason: "too-small" };
  if (offset < clearance - 1e-4) return { ok: false, reason: "corner" };
  if (offset + width > length - clearance + 1e-4) return { ok: false, reason: "corner" };
  for (const opening of openings) {
    if (opening.wallId !== wall.id || opening.id === ignoreId) continue;
    const overlaps = offset < opening.offset + opening.width - 1e-4 && offset + width > opening.offset + 1e-4;
    if (overlaps) return { ok: false, reason: "overlap" };
  }
  return { ok: true };
}

/** Slide an opening onto the grid, then to the nearest slot that still fits. */
export function snapOpeningOffset(wall, openings, offset, width, grid, ignoreId = null) {
  const clearance = cornerClearance();
  const length = wallLength(wall);
  const min = clearance;
  const max = length - clearance - width;
  if (max < min - 1e-6) return { offset, ok: false, reason: "too-small" };
  const step = grid || 0.5;
  const start = Math.round(offset / step) * step;
  const limit = Math.ceil((max - min) / step) + 2;
  for (let i = 0; i <= limit; i += 1) {
    for (const candidate of i === 0 ? [start] : [start + i * step, start - i * step]) {
      if (candidate < min - 1e-6 || candidate > max + 1e-6) continue;
      const fit = openingFits(wall, openings, candidate, width, ignoreId, clearance);
      if (fit.ok) return { offset: candidate, ok: true };
    }
  }
  return { offset: Math.min(max, Math.max(min, offset)), ok: false, reason: "overlap" };
}
