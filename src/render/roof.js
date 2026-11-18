import * as THREE from "three";
import { curveLift, roofFrame } from "../build/roofShape.js";

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

export { roofFootprints, roofFootprint } from "../build/roofShape.js";

/**
 * Any roof box from roofFootprints (hip-and-gable, hip, gable, flush gable,
 * ridge either way, straight or curved) as { roof, gables } geometries. The
 * gables are the wall triangles that close a gable roof's ends, standing on
 * the end walls' outer faces (box.inner). Heights match roofAt exactly: each
 * face is cut into small triangles that follow curveLift when curve > 0.
 */
export function createRoofGeometry(box, plate, pitch) {
  const frame = roofFrame(box, plate, pitch);
  const { u0, u1, v0, v1, run, rise, endRun } = frame;
  pitch = frame.pitch;
  const vc = (v0 + v1) / 2;
  const ridge = plate + rise;
  const roofPos = [];
  const gablePos = [];
  const levels = frame.curve > 0 ? 3 : 0;
  const lifted = (u, v, z, pin) => (pin && z <= plate + 1e-6 ? z : z + curveLift(frame, u, v, z - plate));
  const emit = (out, a, b, c, pin) => {
    for (const p of [a, b, c]) {
      const plan = frame.toPlan(p[0], p[1]);
      out.push(plan.x, lifted(p[0], p[1], p[2], pin), -plan.y);
    }
  };
  const split = (out, a, b, c, n, pin) => {
    if (n <= 0) {
      emit(out, a, b, c, pin);
      return;
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    split(out, a, ab, ca, n - 1, pin);
    split(out, ab, b, bc, n - 1, pin);
    split(out, ca, bc, c, n - 1, pin);
    split(out, ab, bc, ca, n - 1, pin);
  };
  const face = (points, out = roofPos, pin = false) => {
    for (let i = 1; i + 1 < points.length; i += 1) split(out, points[0], points[i], points[i + 1], levels, pin);
  };

  if (!Number.isFinite(endRun)) {
    // Gable: two slopes the full length, and a wall triangle on each end wall.
    face([[u0, v0, plate], [u1, v0, plate], [u1, vc, ridge], [u0, vc, ridge]]);
    face([[u1, v1, plate], [u0, v1, plate], [u0, vc, ridge], [u1, vc, ridge]]);
    const inner = box.inner ? frame.toLocal({ x: box.inner.x0, y: box.inner.y0 }) : null;
    const innerHi = box.inner ? frame.toLocal({ x: box.inner.x1, y: box.inner.y1 }) : null;
    if (inner && innerHi) {
      const wv0 = Math.max(v0, inner.v);
      const wv1 = Math.min(v1, innerHi.v);
      const at = (v) => plate + Math.min(Math.min(v - v0, v1 - v) * pitch, rise);
      for (const u of [Math.max(u0, inner.u), Math.min(u1, innerHi.u)]) {
        face([[u, wv0, plate - 0.02], [u, wv1, plate - 0.02], [u, wv1, at(wv1) - 0.05], [u, vc, ridge - 0.05], [u, wv0, at(wv0) - 0.05]], gablePos, true);
      }
    }
  } else {
    const r0 = u0 + endRun;
    const r1 = u1 - endRun;
    face([[u0, v0, plate], [u1, v0, plate], [r1, vc, ridge], [r0, vc, ridge]]);
    face([[u1, v1, plate], [u0, v1, plate], [r0, vc, ridge], [r1, vc, ridge]]);
    face([[u0, v0, plate], [r0, vc, ridge], [u0, v1, plate]]);
    face([[u1, v0, plate], [u1, v1, plate], [r1, vc, ridge]]);
    if (frame.style === "hip-and-gable") {
      // The small gable standing on each end of the ridge.
      const top = ridge + rise * 0.42;
      const half = run * 2 * 0.18;
      for (const [r, sign] of [[r0, 1], [r1, -1]]) {
        face([[r, vc - half, ridge], [r, vc + half, ridge], [r, vc, top]]);
        void sign;
      }
      face([[r0, vc - half, ridge], [r1, vc - half, ridge], [r1, vc, top], [r0, vc, top]]);
      face([[r0, vc + half, ridge], [r0, vc, top], [r1, vc, top], [r1, vc + half, ridge]]);
    }
  }
  const make = (positions) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  return { roof: make(roofPos), gables: gablePos.length ? make(gablePos) : null };
}


/**
 * The clerestory roof as meshes (see src/build/clerestory.js): two sloped
 * roof planes, the band of glass between them with mullions about every
 * 4 ft, a curb and a header in siding, and gable ends closing the sides.
 * Roof planes carry userData.roofSurface so skylights and the sun treat them
 * like the plain roof.
 */
export function createClerestoryRoof(g, roofMaterial) {
  const group = new THREE.Group();
  const at = (x, planY, h) => new THREE.Vector3(x, h, -planY);
  const quad = (a, b, c, d, material) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const { x0, x1 } = g.box;
  // Lower roof: front eave to the glass line.
  const lower = quad(at(x0, g.front, g.plate), at(x1, g.front, g.plate), at(x1, g.stepY, g.lowTop), at(x0, g.stepY, g.lowTop), roofMaterial);
  lower.userData.roofSurface = true;
  group.add(lower);
  // Upper roof: from its eave over the glass down to the back eave.
  const upper = quad(at(x0, g.upperEdgeY, g.eaveHeight), at(x1, g.upperEdgeY, g.eaveHeight), at(x1, g.backY, g.plate), at(x0, g.backY, g.plate), roofMaterial);
  upper.userData.roofSurface = true;
  group.add(upper);
  // The band: curb, glass, header, between the end walls.
  const siding = new THREE.MeshStandardMaterial({ color: 0x5b5048, roughness: 0.85, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0xa9d3e6, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.6 });
  const xa = g.glassX0;
  const xb = g.glassX1;
  const y = g.stepY;
  const band = (z0, z1, material, cast = true) => {
    const mesh = quad(at(xa, y, z0), at(xb, y, z0), at(xb, y, z1), at(xa, y, z1), material);
    mesh.castShadow = cast;
    mesh.userData.castsSun = cast;
    group.add(mesh);
  };
  band(g.lowTop, g.sill, siding);
  band(g.glassTop, g.top, siding);
  band(g.sill, g.glassTop, glass, false);
  const count = Math.max(1, Math.round((xb - xa) / 4));
  for (let i = 0; i <= count; i += 1) {
    const x = xa + ((xb - xa) * i) / count;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, g.glassTop - g.sill, 0.18), frame);
    post.position.set(x, (g.sill + g.glassTop) / 2, -y);
    post.castShadow = true;
    group.add(post);
  }
  // Gable ends at each end wall: the outline between plate height and the two roofs.
  for (const x of [g.faces.x0, g.faces.x1]) {
    const profile = [
      [g.frontFace, g.plate],
      [g.frontFace, g.plate + Math.abs(g.frontFace - g.front) * g.pitch],
      [g.stepY, g.lowTop],
      [g.stepY, g.top],
      [g.backFace, g.plate + Math.abs(g.backY - g.backFace) * g.upperPitch],
      [g.backFace, g.plate],
    ];
    const shape = new THREE.Shape(profile.map(([py, h]) => new THREE.Vector2(-py, h)));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateY(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, siding);
    mesh.position.x = x;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
