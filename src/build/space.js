/**
 * Plan coordinates are feet, +x east and +y north.
 * The 3D scene uses the same x, and z = -y, so north stays up on the plan
 * and away from the default camera. Plan, split, and 3D all go through these
 * two functions. Do not negate y anywhere else.
 */
export function planToScene(point, height = 0) {
  return { x: point.x, y: height, z: -point.y };
}

export function sceneToPlan(x, _y, z) {
  return { x, y: -z };
}

export function pointInRing(point, ring) {
  let inside = false;
  const polygon = ring || [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    const xAt = ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (crosses && point.x < xAt) inside = !inside;
  }
  return inside;
}
