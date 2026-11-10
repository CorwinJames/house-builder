import * as THREE from "three";

/**
 * Placeholder Chinese hip-and-gable massing.
 * Plan x/y in, Three.js Y-up out (plan y → −Z).
 * This is a shape, not a framing model.
 */
export function createHipAndGableGeometry({ x0, y0, x1, y1, plate, pitch }) {
  const positions = [];
  const push = (x, planY, height) => positions.push(x, height, -planY);

  function tri(a, b, c) {
    push(a[0], a[1], a[2]);
    push(b[0], b[1], b[2]);
    push(c[0], c[1], c[2]);
  }

  function quad(a, b, c, d) {
    tri(a, b, c);
    tri(a, c, d);
  }

  const depth = y1 - y0;
  const run = depth / 2;
  const rise = run * pitch;
  const midY = (y0 + y1) / 2;
  // A pure hip would inset the ridge by `run`. A hip-and-gable keeps a longer
  // ridge and stands a small gable on each end.
  const hip = run * 0.62;
  const rx0 = x0 + hip;
  const rx1 = x1 - hip;
  const ridge = plate + rise;

  const sw = [x0, y0, plate];
  const se = [x1, y0, plate];
  const ne = [x1, y1, plate];
  const nw = [x0, y1, plate];
  const r0 = [rx0, midY, ridge];
  const r1 = [rx1, midY, ridge];

  quad(sw, se, r1, r0);
  quad(ne, nw, r0, r1);
  tri(sw, r0, nw);
  tri(se, ne, r1);

  const gableRise = rise * 0.42;
  const half = depth * 0.18;
  const top = ridge + gableRise;
  const gws = [rx0, midY - half, ridge];
  const gwn = [rx0, midY + half, ridge];
  const gwt = [rx0, midY, top];
  const ges = [rx1, midY - half, ridge];
  const gen = [rx1, midY + half, ridge];
  const get = [rx1, midY, top];

  tri(gws, gwn, gwt);
  tri(ges, get, gen);
  quad(gws, ges, get, gwt);
  quad(gwn, gwt, get, gen);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function roofFootprint(house, futureShown) {
  const overhang = futureShown ? house.roof.overhang : 1.5;
  if (futureShown) {
    return {
      x0: -overhang,
      y0: -overhang,
      x1: house.footprint.width + overhang,
      y1: house.footprint.depth + overhang,
    };
  }
  const core = house.phases.phase1.bounds;
  return {
    x0: core.x0 - overhang,
    y0: core.y0 - overhang,
    x1: core.x1 + overhang,
    y1: core.y1 + overhang,
  };
}
