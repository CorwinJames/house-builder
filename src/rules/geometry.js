import { wallLength } from "../lib/geom.js";
import { wallsOverlap } from "../build/walls.js";
import { openingFits } from "../build/openings.js";

/** Geometry-only checks. Stage 7 adds code rules through the same shape. */
export function geometryWarnings(house) {
  const warnings = [];
  for (let i = 0; i < house.walls.length; i += 1) {
    const wall = house.walls[i];
    if (wallLength(wall) < 0.4) {
      warnings.push({
        id: `short-${wall.id}`,
        severity: "warn",
        code: "geometry.short-wall",
        message: "This wall is too short.",
        target: { type: "wall", id: wall.id },
      });
    }
    for (let j = i + 1; j < house.walls.length; j += 1) {
      const other = house.walls[j];
      if (!wallsOverlap(wall, other)) continue;
      warnings.push({
        id: `overlap-${wall.id}-${other.id}`,
        severity: "warn",
        code: "geometry.overlap",
        message: "Two walls overlap.",
        target: { type: "wall", id: wall.id },
      });
    }
  }
  for (const opening of house.openings) {
    const wall = house.walls.find((item) => item.id === opening.wallId);
    if (!wall) {
      warnings.push({
        id: `lost-${opening.id}`,
        severity: "warn",
        code: "geometry.opening-wall",
        message: "An opening is not on a wall.",
        target: { type: "opening", id: opening.id },
      });
      continue;
    }
    const fit = openingFits(wall, house.openings, opening.offset, opening.width, opening.id);
    if (!fit.ok) {
      warnings.push({
        id: `fit-${opening.id}`,
        severity: "warn",
        code: fit.reason === "corner" ? "geometry.corner-clearance" : "geometry.opening-overlap",
        message: fit.reason === "corner"
          ? "This opening is too close to a corner."
          : "This opening overlaps another opening.",
        target: { type: "opening", id: opening.id },
      });
    }
  }
  return warnings;
}
