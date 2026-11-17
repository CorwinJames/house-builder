import * as THREE from "three";
import { furnishingHeight } from "../build/furnish.js";

const FURN_MATS = {};
function furnMat(color, opacity = 1) {
  const key = `${color}:${opacity}`;
  if (!FURN_MATS[key]) FURN_MATS[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.55, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  return FURN_MATS[key];
}

/**
 * A fixture or appliance in 3D at its real size: simple shapes that read
 * as what they are. Built in the piece's own frame (front is plan +y,
 * which is Three.js −Z), then turned and moved into place.
 */
export function furnishingModel(item) {
  const W = item.width || 2;
  const D = item.depth || 2;
  const H = furnishingHeight(item.kind) || 3;
  const group = new THREE.Group();
  const add = (geometry, material, x, y, planY) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, -planY);
    mesh.castShadow = material.transparent !== true;
    mesh.receiveShadow = true;
    mesh.userData.pick = { type: "furniture", id: item.id };
    group.add(mesh);
    return mesh;
  };
  const block = (w, h, d, x, y0, planY, color, opacity = 1) => add(new THREE.BoxGeometry(w, h, d), furnMat(color, opacity), x, y0 + h / 2, planY);
  const disc = (r, h, x, y0, planY, color) => add(new THREE.CylinderGeometry(r, r, h, 24), furnMat(color), x, y0 + h / 2, planY);
  const back = -D / 2;
  const white = 0xf6f6f2;
  const steel = 0xc9cdd1;
  switch (item.kind) {
    case "toilet": {
      const tank = Math.min(0.75, D * 0.28);
      block(W * 0.9, H, tank, 0, 0, back + tank / 2, white);
      const bowl = add(new THREE.CylinderGeometry(W * 0.36, W * 0.28, 1.25, 24), furnMat(white), 0, 0.625, back + tank + (D - tank) / 2);
      bowl.scale.set(1, 1, ((D - tank) / 2) / (W * 0.36));
      break;
    }
    case "bath-sink":
      block(W, H - 0.1, D, 0, 0, 0, 0xe9dfcf);
      block(W, 0.1, D, 0, H - 0.1, 0, white);
      disc(Math.min(W, D) * 0.28, 0.02, 0, H, 0.05, 0xb8cdd6);
      break;
    case "kitchen-sink":
      block(W, H - 0.12, D, 0, 0, 0, 0xe4c79a);
      block(W, 0.12, D, 0, H - 0.12, 0, 0xd9d4ca);
      block(W * 0.4, 0.02, D * 0.6, -W * 0.22, H, 0.05, 0xa9b4ba);
      block(W * 0.4, 0.02, D * 0.6, W * 0.22, H, 0.05, 0xa9b4ba);
      break;
    case "shower":
      block(W, 0.25, D, 0, 0, 0, white);
      block(W, H - 0.25, 0.04, 0, 0.25, D / 2, 0xbfe0ec, 0.3);
      block(0.04, H - 0.25, D, W / 2, 0.25, 0, 0xbfe0ec, 0.3);
      disc(0.25, 0.05, 0, H - 0.6, back + 0.4, steel);
      break;
    case "stove":
      block(W, H - 0.05, D, 0, 0, 0, steel);
      block(W, 0.05, D, 0, H - 0.05, 0, 0x2d2d2d);
      for (const [bx, by] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) disc(Math.min(W, D) * 0.15, 0.02, bx * W * 0.24, H, by * D * 0.22, 0x555555);
      block(W * 0.9, H * 0.45, 0.03, 0, H * 0.15, D / 2, 0x2d2d2d);
      break;
    case "dishwasher":
      block(W, H, D, 0, 0, 0, steel);
      block(W * 0.8, 0.06, 0.08, 0, H - 0.35, D / 2 + 0.04, 0x6b6b6b);
      break;
    case "fridge":
      block(W, H, D, 0, 0, 0, 0xeef1f3);
      block(0.02, H * 0.98, 0.02, 0, 0, D / 2 + 0.01, 0x9aa1a7);
      block(0.06, H * 0.35, 0.08, -0.15, H * 0.4, D / 2 + 0.04, 0x9aa1a7);
      block(0.06, H * 0.35, 0.08, 0.15, H * 0.4, D / 2 + 0.04, 0x9aa1a7);
      break;
    case "washer":
    case "dryer": {
      block(W, H, D, 0, 0, 0, 0xf2f4f6);
      const door = add(new THREE.CylinderGeometry(W * 0.3, W * 0.3, 0.05, 28), furnMat(item.kind === "washer" ? 0x9fc3d3 : 0xc9c2b4), 0, H * 0.45, D / 2 + 0.025);
      door.rotation.x = Math.PI / 2;
      break;
    }
    case "wardrobe":
      block(W, H, D, 0, 0, 0, 0xb38a5e);
      block(0.03, H * 0.95, 0.03, 0, H * 0.02, D / 2 + 0.01, 0x6e4b32);
      break;
    default:
      block(W, H, D, 0, 0, 0, 0xd9cfc2);
  }
  group.position.set(item.x, 0, -item.y);
  group.rotation.y = ((item.rotation || 0) * Math.PI) / 180;
  group.userData.pick = { type: "furniture", id: item.id };
  return group;
}
