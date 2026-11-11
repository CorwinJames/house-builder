import { geometryWarnings } from "./geometry.js";

/**
 * Pluggable checks. Each rule is `(house) => warning[]`.
 * Stage 7 should register code rules here. Do not invent code numbers;
 * a code rule has to carry a citation (title, section, URL, date checked).
 */
const rules = [geometryWarnings];

export function registerRule(rule) {
  rules.push(rule);
}

export function evaluateRules(house) {
  return rules.flatMap((rule) => rule(house));
}

export function warningTargets(warnings) {
  const walls = new Set();
  const openings = new Set();
  for (const warning of warnings) {
    if (warning.target?.type === "wall") walls.add(warning.target.id);
    if (warning.target?.type === "opening") openings.add(warning.target.id);
  }
  return { walls, openings };
}
