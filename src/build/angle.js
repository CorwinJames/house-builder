import { formatFeetFine } from "../lib/format.js";
import { moveEnd } from "./walls.js";

/** Endpoints this close are the same point and move together. */
export const JOIN_FT = 0.35;

/** A corner still counts when the wall centerlines stop short by about a wall thickness. */
export const CORNER_FT = 1.25;

/** Compass heading: 0° points east, and the angle turns counterclockwise. */
export function headingDeg(from, to) {
  const deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Degrees to the nearest tenth: 37°, 37.4°. A whole number drops the ".0". */
export function formatDegrees(deg) {
  const tenths = Math.round(Number(deg) * 10) / 10;
  const text = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
  return `${text === "-0" ? "0" : text}°`;
}

export function formatHeading(deg) {
  let value = Math.round((((Number(deg) % 360) + 360) % 360) * 10) / 10;
  if (value >= 360) value = 0;
  return formatDegrees(value);
}

/** Smaller angle between two compass headings, from 0 to 180. */
export function angleBetweenHeadings(a, b) {
  let delta = Math.abs(a - b) % 360;
  if (delta > 180) delta = 360 - delta;
  return delta;
}

/** "12'-4\"" becomes "12 ft 4 in". */
export function plainFeet(feet) {
  return formatFeetFine(feet).construction
    .replace("'-", " ft ")
    .replace("'", " ft")
    .replace('"', " in")
    .replace(/\s+/g, " ")
    .trim();
}

export function measureLabel(length, angle, joinAngle) {
  const base = `${plainFeet(length)} at ${formatHeading(angle)}`;
  if (joinAngle == null) return base;
  return `${base}, ${formatDegrees(joinAngle)} from the wall it meets`;
}

/**
 * Feet from a typed length. Accepts 12.5, 12 ft 4 in, 12' 4", or 12 4.
 */
export function parseLength(text) {
  const raw = String(text ?? "").trim().toLowerCase().replace(/−/g, "-");
  if (!raw) return null;
  const feetInches = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?\s*$/);
  if (feetInches) {
    return Number(feetInches[1]) + (feetInches[2] ? Number(feetInches[2]) / 12 : 0);
  }
  const spaced = raw.match(/^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")?$/);
  if (spaced) return Number(spaced[1]) + Number(spaced[2]) / 12;
  const inches = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inches) return Number(inches[1]) / 12;
  const plain = raw.match(/^(-?\d+(?:\.\d+)?)$/);
  if (plain) return Number(plain[1]);
  return null;
}

export function parseAngle(text) {
  const raw = String(text ?? "").trim().replace("°", "");
  if (!raw || Number.isNaN(Number(raw))) return null;
  return Number(raw);
}

export function pointAt(origin, length, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: origin.x + Math.cos(rad) * length,
    y: origin.y + Math.sin(rad) * length,
  };
}

function neighborsAt(house, joint, ignoreId, radius) {
  const found = [];
  for (const wall of house?.walls || []) {
    if (!wall?.start || !wall?.end || wall.id === ignoreId) continue;
    const startDist = Math.hypot(wall.start.x - joint.x, wall.start.y - joint.y);
    const endDist = Math.hypot(wall.end.x - joint.x, wall.end.y - joint.y);
    if (startDist > radius && endDist > radius) continue;
    const far = startDist <= endDist ? wall.end : wall.start;
    found.push({
      heading: headingDeg(joint, far),
      dist: Math.min(startDist, endDist),
    });
  }
  return found;
}

/** Prefer a real corner over a wall that simply continues straight. */
function bestJoin(leaving, neighbors) {
  let best = null;
  for (const neighbor of neighbors) {
    const degrees = angleBetweenHeadings(leaving, neighbor.heading);
    const straight = degrees > 170;
    const candidate = { ...neighbor, degrees, straight };
    if (!best || (best.straight && !straight) || (best.straight === straight && degrees < best.degrees)) {
      best = candidate;
    }
  }
  return best;
}

/** Compass heading of another wall leaving this corner, if one meets it. */
export function joinedHeading(house, joint, ignoreId, radius = CORNER_FT) {
  if (!joint) return null;
  return bestJoin(0, neighborsAt(house, joint, ignoreId, radius))?.heading ?? null;
}

/**
 * Length, compass angle, and the angle at a joined corner.
 * The angle is from the wall's start toward its end.
 */
export function describeWall(start, end, house, ignoreId) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const angle = headingDeg(start, end);
  const startJoin = bestJoin(angle, neighborsAt(house, start, ignoreId, CORNER_FT));
  const endJoin = bestJoin((angle + 180) % 360, neighborsAt(house, end, ignoreId, CORNER_FT));
  const startCorner = startJoin && !startJoin.straight;
  const endCorner = endJoin && !endJoin.straight;
  const useEnd = !startCorner && (endCorner || (!startJoin && endJoin));
  const chosen = useEnd ? endJoin : startJoin;
  const origin = useEnd ? end : start;
  const leaving = useEnd ? (angle + 180) % 360 : angle;
  const joinHeading = chosen?.heading ?? null;
  const joinAngle = chosen?.degrees ?? null;
  return {
    length,
    angle,
    joinAngle,
    text: measureLabel(length, angle, joinAngle),
    arc: { x: start.x, y: start.y, from: 0, to: angle },
    join: joinHeading == null ? null : {
      x: origin.x,
      y: origin.y,
      from: leaving,
      to: joinHeading,
      degrees: joinAngle,
    },
  };
}

/** Move the free end. The other end stays, and corners that meet it stay joined. */
export function setWallMeasure(house, wallId, length, angleDeg, endName = "end") {
  const wall = (house.walls || []).find((item) => item.id === wallId);
  if (!wall?.start || !wall?.end || !(length > 0) || angleDeg == null) return house;
  if (endName === "start") return moveEnd(house, wall.id, "start", pointAt(wall.end, length, angleDeg + 180));
  return moveEnd(house, wall.id, "end", pointAt(wall.start, length, angleDeg));
}

/** The end that is not holding a corner, or the end when both do. */
export function freeEndName(wall, house) {
  const startJoined = joinedHeading(house, wall.start, wall.id) != null;
  const endJoined = joinedHeading(house, wall.end, wall.id) != null;
  if (startJoined && !endJoined) return "end";
  if (endJoined && !startJoined) return "start";
  return "end";
}
