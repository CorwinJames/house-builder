import { pointAlong } from "../lib/geom.js";
import { geometryWarnings } from "./geometry.js";
import { applyFix, codeWarnings } from "./code.js";
import { siteWarnings } from "./site.js";

/**
 * One list of warnings. Geometry checks and code rules both return findings.
 * A code finding carries title, why, severity, citation, and an optional fix.
 */
const rules = [geometryWarnings, codeWarnings, siteWarnings];

export function registerRule(rule) {
  rules.push(rule);
}

export function evaluateRules(house) {
  return rules.flatMap((rule) => rule(house).map((item) => normalize(house, item)));
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

export function citationLine(citation) {
  if (!citation) return "";
  const mark = citation.confirmSection ? " · confirm section" : "";
  return `${citation.code} ${citation.section}${mark}`;
}

export { applyFix };

function normalize(house, item) {
  const geometry = String(item.code || "").startsWith("geometry");
  const severity = item.severity === "warn" ? "warning" : (item.severity || "warning");
  const target = item.target || null;
  return {
    ...item,
    severity,
    ruleId: item.ruleId || item.code || item.id,
    code: item.code || item.ruleId || item.id,
    title: item.title || item.message || "Check this",
    message: item.message || item.title || "Check this",
    why: item.why || (geometry ? "The drawing has to be a buildable shape before a code check means anything." : ""),
    target,
    point: item.point || pointFor(house, target),
    phase: item.phase || phaseFor(house, target),
  };
}

function phaseFor(house, target) {
  if (!target) return null;
  if (target.type === "wall") return house.walls?.find((item) => item.id === target.id)?.phase || null;
  if (target.type === "opening") {
    const opening = house.openings?.find((item) => item.id === target.id);
    const wall = opening && house.walls?.find((item) => item.id === opening.wallId);
    return wall?.phase || null;
  }
  if (target.type === "room") return house.rooms?.find((item) => item.id === target.id)?.phase || null;
  if (target.type === "device") return house.electrical?.devices?.find((item) => item.id === target.id)?.phase || null;
  if (target.type === "fixture") return house.plumbing?.fixtures?.find((item) => item.id === target.id)?.phase || null;
  return null;
}

function pointFor(house, target) {
  if (!target) return null;
  if (target.type === "wall") {
    const wall = house.walls?.find((item) => item.id === target.id);
    if (!wall) return null;
    return { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  }
  if (target.type === "opening") {
    const opening = house.openings?.find((item) => item.id === target.id);
    const wall = opening && house.walls?.find((item) => item.id === opening.wallId);
    if (!wall) return null;
    return pointAlong(wall, (opening.offset || 0) + (opening.width || 0) / 2);
  }
  if (target.type === "room") {
    const room = house.rooms?.find((item) => item.id === target.id);
    const poly = room?.polygon || [];
    if (!poly.length) return null;
    return {
      x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
      y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
    };
  }
  if (target.type === "device") {
    const device = house.electrical?.devices?.find((item) => item.id === target.id);
    if (!device) return null;
    return { x: device.x, y: device.y };
  }
  if (target.type === "fixture") {
    const fixture = house.plumbing?.fixtures?.find((item) => item.id === target.id);
    if (!fixture) return null;
    return { x: fixture.x, y: fixture.y };
  }
  return null;
}
