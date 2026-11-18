import { ASSEMBLY_2D, FINISH_2D, INK, MUTED } from "../theme.js";
import { formatArea, formatFeet, formatFeetFine } from "../lib/format.js";
import { constraintReadout } from "../build/constraints.js";
import { pickReadableTicks, roomProportion } from "../build/ratios.js";

const RATIO_FONT = '"Noto Sans Math", "Noto Sans", "Segoe UI Symbol", "DejaVu Sans", sans-serif';
const RATIO_GLYPHS = "φδρ√·−+0123456789.% ";
import {
  openingsFor,
  pointAlong,
  polygonArea,
  polygonCentroid,
  segmentQuad,
  wallLength,
  wallPieces,
} from "../lib/geom.js";
import { isFutureShown, isPhaseVisible } from "./visibility.js";
import { wallLayerId } from "../layers.js";
import { offsetSegment, planDimensions } from "./dimensions.js";
import { assemblyById } from "../build/catalog.js";
import { pieceOutline, wallJoints } from "../build/joins.js";
import { endsAt, isClipped } from "../build/clips.js";
import { roofShadows, roofed, sunPatches, wallShadows } from "../sun/light.js";
import { skylightFootprint } from "../build/skylights.js";
import { foldingPanels } from "../build/catalog.js";
import { awningPieces } from "../build/awnings.js";
import { platformRect, roofFootprints, roofLines } from "../build/roofShape.js";
import { isFurnishing } from "../build/furnish.js";
import { imageCorners } from "../build/images.js";
import { clerestoryBox, clerestoryGeometry } from "../build/clerestory.js";
import { plainFeet } from "../build/angle.js";
import { furnitureFootprint, roomGroundLine } from "../build/annotations.js";
import { areaKind, boundsOf } from "../build/areas.js";
import { CIRCUIT_COLORS, buildElectrical, devicePoint, panelPoint } from "../electrical/design.js";
import { plainPlaceLabel } from "../electrical/design.js";
import { buildPlumbing } from "../plumbing/design.js";
import { buildSite, SETBACKS } from "../site/design.js";

function pickSpot(house, pick) {
  if (pick.type === "column") return (house.columns || []).find((item) => item.id === pick.id);
  if (pick.type === "siteFeature") return (house.siteFeatures || []).find((item) => item.id === pick.id);
  if (pick.type === "planLabel") return (house.planLabels || []).find((item) => item.id === pick.id);
  if (pick.type === "device") {
    const item = (house.electrical?.devices || []).find((entry) => entry.id === pick.id);
    return item ? devicePoint(house, item) : null;
  }
  if (pick.type === "panel") return panelPoint(house);
  if (pick.type === "fixture") {
    const item = (house.plumbing?.fixtures || []).find((entry) => entry.id === pick.id);
    return item ? devicePoint(house, item) : null;
  }
  if (pick.type === "entry") return house.plumbing?.entry ? devicePoint(house, house.plumbing.entry) : null;
  if (pick.type === "well") return house.site?.well;
  if (pick.type === "septic") return house.site?.septic?.tank;
  return null;
}

/**
 * 2D plan. North is up. Walls are drawn at their real thickness.
 * Build mode hands pointer events to a hook so drawing doesn't also pan.
 */
export function createPlanView(canvas, initialHouse) {
  let house = initialHouse;
  const ctx = canvas.getContext("2d");
  let state = null;
  let overlay = null;
  // A bay module (jian, kan, ken) drawn as its own grid while it is the snap step.
  let bayGrid = 0;
  let markers = [];
  let badgeHits = [];
  let badgeNote = null;
  let pinnedBadge = null;
  let buildHooks = null;
  let buildGesture = false;
  let onChange = () => {};
  let camera = { cx: 38, cy: 23.5, pxPerFt: 8 };
  let labelBoxes = [];
  let measureLabelHit = null;
  let cameraReady = false;
  let openedFrame = false;
  // Screen pixels on the left covered by the floating layer panel. Fit frames the house beside it.
  let insetLeft = 0;
  // Where you stand in the 3D walk-through, and which way you face. Null when not walking.
  let walker = null;
  // The sun when the Sun and shade layer is showing, else null.
  let sun = null;
  let sunDrag = null;
  let onSunDrag = () => {};
  let shadeCanvas = null;
  let showRoofEdges = false;
  let walkerDrag = null;
  let onWalkerMove = () => {};
  let ratioFontReady = false;
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let hoverCircuitId = null;
  let hoverPipeId = null;
  let renderQueued = false;
  let cameraSaveTimer = 0;
  let electricalCache = null;
  let plumbingCache = null;
  let siteCache = null;

  let phoneLocked = false;

  function layoutCanvas() {
    const frame = canvas.parentElement;
    const viewport = frame?.parentElement;
    const phone = window.matchMedia("(max-width: 860px)").matches;
    if (!phone || !frame || !viewport) {
      if (phoneLocked) {
        frame?.style.removeProperty("width");
        frame?.style.removeProperty("height");
        canvas.style.removeProperty("width");
        canvas.style.removeProperty("height");
        phoneLocked = false;
      }
      return;
    }
    frame.style.width = "100%";
    canvas.style.width = "100%";
    const w = Math.min(viewport.clientWidth, window.innerWidth);
    const h = Math.max(120, Math.min(viewport.clientHeight, window.innerHeight));
    const nextW = `${w}px`;
    const nextH = `${h}px`;
    if (frame.style.width !== nextW) frame.style.width = nextW;
    if (frame.style.height !== nextH) frame.style.height = nextH;
    if (canvas.style.width !== nextW) canvas.style.width = nextW;
    if (canvas.style.height !== nextH) canvas.style.height = nextH;
    phoneLocked = true;
  }

  function size() {
    return { w: canvas.clientWidth, h: canvas.clientHeight };
  }

  function worldToScreen(x, y) {
    const { w, h } = size();
    return {
      x: w / 2 + (x - camera.cx) * camera.pxPerFt,
      y: h / 2 - (y - camera.cy) * camera.pxPerFt,
    };
  }

  function screenToWorld(sx, sy) {
    const { w, h } = size();
    return {
      x: camera.cx + (sx - w / 2) / camera.pxPerFt,
      y: camera.cy - (sy - h / 2) / camera.pxPerFt,
    };
  }

  function usableCamera(next) {
    return !!next
      && Number.isFinite(next.cx)
      && Number.isFinite(next.cy)
      && Number.isFinite(next.pxPerFt)
      && next.pxPerFt >= 0.5
      && next.pxPerFt <= 200;
  }

  function applyCameraFromState() {
    if (!usableCamera(state?.plan)) return;
    camera = { cx: state.plan.cx, cy: state.plan.cy, pxPerFt: state.plan.pxPerFt };
    cameraReady = true;
  }

  function contentOnScreen() {
    const { w, h } = size();
    if (w < 20 || h < 20) return true;
    const points = [];
    for (const wall of house.walls || []) {
      if (wall?.start) points.push(wall.start);
      if (wall?.end) points.push(wall.end);
    }
    if (!points.length && house.footprint?.width && house.footprint?.depth) {
      points.push({ x: 0, y: 0 }, { x: house.footprint.width, y: house.footprint.depth });
    }
    if (!points.length) return true;
    return points.some((point) => {
      const screen = worldToScreen(point.x, point.y);
      return screen.x > -80 && screen.y > -80 && screen.x < w + 80 && screen.y < h + 80;
    });
  }

  function fit(notify) {
    const { w, h } = size();
    if (w < 20 || h < 20) return;
    const future = state ? isFutureShown(state) : true;
    const siteMode = state?.focus === "site";
    const siteView = siteMode && state?.layers?.site !== false ? cachedSite() : null;
    const footW = Number(house.footprint?.width);
    const footD = Number(house.footprint?.depth);
    const phaseBox = house.phases?.phase1?.bounds;
    let bounds;
    if (siteView?.bounds) {
      bounds = {
        x0: siteView.bounds.x0 - 20,
        y0: siteView.bounds.y0 - 20,
        x1: siteView.bounds.x1 + 20,
        y1: siteView.bounds.y1 + 20,
      };
    } else if (!future && phaseBox) {
      bounds = {
        x0: phaseBox.x0 - 6,
        y0: phaseBox.y0 - 6,
        x1: phaseBox.x1 + 6,
        y1: phaseBox.y1 + 6,
      };
    } else if (footW > 0 && footD > 0) {
      bounds = { x0: -6, y0: -8, x1: footW + 6, y1: footD + 8 };
    } else {
      bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    }
    for (const wall of house.walls || []) {
      for (const point of [wall.start, wall.end]) {
        if (!point) continue;
        bounds.x0 = Math.min(bounds.x0, point.x - 6);
        bounds.y0 = Math.min(bounds.y0, point.y - 6);
        bounds.x1 = Math.max(bounds.x1, point.x + 6);
        bounds.y1 = Math.max(bounds.y1, point.y + 6);
      }
    }
    if (!Number.isFinite(bounds.x0) || bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) return;
    const inset = insetLeft > 0 && w - insetLeft > 240 ? insetLeft : 0;
    camera.pxPerFt = Math.max(
      2,
      Math.min((w - 48 - inset) / (bounds.x1 - bounds.x0), (h - 120) / (bounds.y1 - bounds.y0)),
    );
    camera.cx = (bounds.x0 + bounds.x1) / 2 - inset / 2 / camera.pxPerFt;
    camera.cy = (bounds.y0 + bounds.y1) / 2;
    cameraReady = true;
    if (state) state.plan = { cx: camera.cx, cy: camera.cy, pxPerFt: camera.pxPerFt };
    if (notify) onChange({ ...camera });
    render();
  }

  function wallVisible(wall) {
    if (!state) return true;
    if (!isPhaseVisible(wall.phase, state)) return false;
    return !!state.layers[wallLayerId(wall)];
  }

  function trace(points) {
    ctx.beginPath();
    points.forEach((point, index) => {
      const s = worldToScreen(point.x, point.y);
      if (index === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  function drawGrid() {
    const scale = camera.pxPerFt;
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    const { w, h } = size();
    const corners = [
      screenToWorld(0, 0),
      screenToWorld(w, 0),
      screenToWorld(0, h),
      screenToWorld(w, h),
    ];
    const x0 = Math.min(...corners.map((c) => c.x));
    const x1 = Math.max(...corners.map((c) => c.x));
    const y0 = Math.min(...corners.map((c) => c.y));
    const y1 = Math.max(...corners.map((c) => c.y));
    if (![x0, x1, y0, y1].every(Number.isFinite)) return;
    const strokeLines = (step, style, skipMultiplesOf) => {
      if (!(step > 0)) return;
      ctx.beginPath();
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      let count = 0;
      for (let x = Math.ceil(x0 / step) * step; x <= x1 && count < 2000; x += step) {
        count += 1;
        if (skipMultiplesOf && x % skipMultiplesOf === 0) continue;
        const a = worldToScreen(x, y0);
        const b = worldToScreen(x, y1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1 && count < 4000; y += step) {
        count += 1;
        if (skipMultiplesOf && y % skipMultiplesOf === 0) continue;
        const a = worldToScreen(x0, y);
        const b = worldToScreen(x1, y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    };
    ctx.save();
    if (bayGrid >= 4) {
      strokeLines(bayGrid, "rgba(31, 111, 139, 0.22)", 0);
    } else {
      if (camera.pxPerFt >= 9) strokeLines(1, "rgba(90, 70, 40, 0.07)", 5);
      strokeLines(5, "rgba(90, 70, 40, 0.18)", 0);
    }
    ctx.restore();
  }

  function siteOn() {
    return state?.layers?.site !== false && !!house.site?.parcel;
  }

  function drawRing(ring) {
    if (!ring?.length) return;
    ctx.beginPath();
    ring.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.y);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    ctx.closePath();
  }

  function drawSiteGround() {
    if (!siteOn()) return;
    const view = cachedSite();
    if (!view) return;
    ctx.save();
    drawRing(view.ring);
    ctx.fillStyle = "rgba(214, 196, 166, 0.55)";
    ctx.fill();
    drawRing(view.buildable);
    ctx.fillStyle = "rgba(47, 93, 69, 0.14)";
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#2F5D45";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(122, 96, 64, 0.45)";
    ctx.lineWidth = 1;
    for (const line of view.contours) {
      const a = worldToScreen(line[0].x, line[0].y);
      const b = worldToScreen(line[1].x, line[1].y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#6B4A2A";
    ctx.lineWidth = 2;
    drawRing(view.ring);
    ctx.stroke();
    const front = view.ring.slice().sort((a, b) => a.y - b.y)[0];
    const label = worldToScreen(front.x + 30, front.y + (SETBACKS.zone.frontLocalFt / 2));
    ctx.fillStyle = "#6B4A2A";
    ctx.font = "600 12px Outfit, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${house.site.zone?.frontFt || 20} ft road`, label.x, label.y);
    ctx.restore();
  }

  function drawSitePieces() {
    if (!siteOn()) return;
    const site = house.site;
    ctx.save();
    ctx.globalAlpha = systemAlpha("site");
    const path = (points) => {
      ctx.beginPath();
      points.forEach((point, index) => {
        const screen = worldToScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      });
    };
    if (site.driveway?.points?.length > 1) {
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "#8A5A12";
      ctx.lineWidth = 3;
      path(site.driveway.points);
      ctx.stroke();
    }
    if (site.power?.points?.length > 1) {
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = "#3D4C7A";
      ctx.lineWidth = 2;
      path(site.power.points);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const hatch = (rect, dashed) => {
      if (!rect) return;
      drawRing([
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.depth },
        { x: rect.x, y: rect.y + rect.depth },
      ]);
      ctx.fillStyle = dashed ? "rgba(90, 122, 90, 0.18)" : "rgba(90, 122, 70, 0.35)";
      ctx.fill();
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.strokeStyle = "#2F5D45";
      ctx.stroke();
      ctx.setLineDash([]);
    };
    hatch(site.septic?.drainfield, false);
    hatch(site.septic?.reserve, true);
    if (site.septic?.tank) {
      const tank = worldToScreen(site.septic.tank.x, site.septic.tank.y);
      ctx.fillStyle = "#2F5D45";
      ctx.beginPath();
      ctx.arc(tank.x, tank.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#F7F3EB";
      ctx.font = "700 10px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("S", tank.x, tank.y + 0.5);
    }
    if (site.well) {
      const well = worldToScreen(site.well.x, site.well.y);
      ctx.strokeStyle = "rgba(31, 111, 139, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(well.x, well.y, (SETBACKS.well.drainfieldFt) * (camera.pxPerFt || 8), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#1F6F8B";
      ctx.font = "600 11px Outfit, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("100 ft to drain field", well.x + 10, well.y - (SETBACKS.well.drainfieldFt) * (camera.pxPerFt || 8));
      ctx.fillStyle = "#1F6F8B";
      ctx.beginPath();
      ctx.arc(well.x, well.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#F7F3EB";
      ctx.font = "700 11px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("W", well.x, well.y + 0.5);
      if (house.plumbing?.entry) {
        const entry = worldToScreen(house.plumbing.entry.x, house.plumbing.entry.y);
        ctx.strokeStyle = "#1F6F8B";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(well.x, well.y);
        ctx.lineTo(entry.x, entry.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawRooms() {
    if (state?.layers && state.layers.finishes === false) return;
    for (const room of house.rooms || []) {
      if (!room?.polygon || room.polygon.length < 3) continue;
      if (state && !isPhaseVisible(room.phase, state)) continue;
      const future = room.phase === "future";
      ctx.save();
      trace(room.polygon);
      ctx.clip();
      ctx.globalAlpha = future ? 0.55 : 0.95;
      ctx.fillStyle = FINISH_2D[room.finish] || FINISH_2D.wood;
      ctx.fillRect(-10000, -10000, 20000, 20000);
      if (future) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#6E5C48";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const { w, h } = size();
        for (let x = -h; x < w + h; x += 10) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x + h, h);
        }
        ctx.stroke();
      }
      ctx.restore();
      trace(room.polygon);
      ctx.save();
      ctx.globalAlpha = future ? 0.7 : 0.35;
      ctx.setLineDash(future ? [5, 4] : []);
      ctx.strokeStyle = future ? "#6E5C48" : INK;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Solid stretches of a wall, outlined with its corner joints. */
  function wallQuads(wall, joints) {
    const quads = [];
    for (const piece of wallPieces(wall, openingsFor(house, wall))) {
      if (piece.kind !== "solid") continue;
      quads.push(pieceOutline(wall, piece.s0, piece.s1, joints.get(wall.id)));
    }
    return quads;
  }

  function fillWallQuad(wall, quad, future) {
    const colors = ASSEMBLY_2D[wall.assembly] || ASSEMBLY_2D.framed;
    ctx.save();
    trace(quad);
    ctx.clip();
    ctx.globalAlpha = future ? 0.42 : 1;
    ctx.fillStyle = colors.fill;
    ctx.fillRect(-10000, -10000, 20000, 20000);
    if (wall.assembly === "rammed-earth") {
      const ys = quad.map((point) => worldToScreen(point.x, point.y).y);
      const top = Math.min(...ys);
      const bot = Math.max(...ys);
      const step = Math.max(3, 0.42 * camera.pxPerFt);
      ctx.globalAlpha = future ? 0.28 : 0.45;
      ctx.strokeStyle = "#6A301C";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = top; y < bot; y += step) {
        ctx.moveTo(-20, y);
        ctx.lineTo(4000, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Walls that touch read as one wall. Every outline is stroked twice as wide
   * first, then every fill goes on top. A seam between two walls is covered by
   * their fills, so only the outside edge of the joined shape stays visible.
   * Later wings are see-through, so they keep their own dashed outlines.
   */
  function drawWalls(walls) {
    const joints = wallJoints(walls);
    const solid = [];
    const later = [];
    for (const wall of walls) {
      const quads = wallQuads(wall, joints);
      (wall.phase === "future" ? later : solid).push({ wall, quads });
    }
    for (const { wall, quads } of solid) {
      const colors = ASSEMBLY_2D[wall.assembly] || ASSEMBLY_2D.framed;
      for (const quad of quads) {
        trace(quad);
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 2;
        ctx.lineJoin = "miter";
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const { wall, quads } of solid) {
      for (const quad of quads) fillWallQuad(wall, quad, false);
    }
    for (const { wall, quads } of later) {
      const colors = ASSEMBLY_2D[wall.assembly] || ASSEMBLY_2D.framed;
      for (const quad of quads) {
        fillWallQuad(wall, quad, true);
        trace(quad);
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function strokeWorld(a, b, color, width, dash = []) {
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }

  function drawOpening(wall, opening) {
    const len = wallLength(wall);
    const a = pointAlong(wall, opening.offset);
    const b = pointAlong(wall, opening.offset + opening.width);
    if (opening.type === "window") {
      strokeWorld(a, b, "#6E98A6", 2);
      return;
    }
    if (opening.style === "cased") return;
    if (opening.style === "overhead") {
      strokeWorld(a, b, "#5C5148", 1.5, [4, 3]);
      return;
    }
    if (opening.style === "folding") {
      // Glass panels folded part-open, as a zigzag inside the opening.
      strokeWorld(a, b, "#6E98A6", 1.25, [3, 3]);
      const panels = foldingPanels(opening.width);
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const nx = -dy / len;
      const ny = dx / len;
      const step = opening.width / panels;
      const depth = Math.min(1.2, step * 0.45);
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= panels; i += 1) {
        const p = pointAlong(wall, opening.offset + i * step);
        const out = i % 2 ? depth : 0;
        const s = worldToScreen(p.x + nx * out, p.y + ny * out);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.strokeStyle = "#4F8297";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (opening.style === "sliding") {
      strokeWorld(a, b, "#6E98A6", 2);
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const ox = (-dy / len) * 0.28;
      const oy = (dx / len) * 0.28;
      strokeWorld(
        { x: a.x + ox, y: a.y + oy },
        { x: b.x + ox, y: b.y + oy },
        "#6E98A6",
        1.25,
      );
      return;
    }
    const hingeAt = opening.hinge === "end" ? opening.offset + opening.width : opening.offset;
    const hinge = pointAlong(wall, hingeAt);
    const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
    const closed = opening.hinge === "end" ? angle + Math.PI : angle;
    const open = angle + (opening.swingSide === "right" ? -Math.PI / 2 : Math.PI / 2);
    const tip = {
      x: hinge.x + Math.cos(open) * opening.width,
      y: hinge.y + Math.sin(open) * opening.width,
    };
    strokeWorld(hinge, tip, "#5C5148", 1.25);
    let delta = open - closed;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    ctx.beginPath();
    for (let i = 0; i <= 14; i += 1) {
      const t = closed + delta * (i / 14);
      const p = worldToScreen(
        hinge.x + Math.cos(t) * opening.width,
        hinge.y + Math.sin(t) * opening.width,
      );
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(44, 36, 22, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  function drawDimensions() {
    if (!state?.layers.dimensions) return;
    const dims = planDimensions(house, isFutureShown(state));
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 1;
    ctx.font = "600 12px Outfit, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const shortest = Math.min(...dims.map((dim) => Math.abs(dim.dist)));
    if (shortest * camera.pxPerFt < 28) {
      const bump = 28 / camera.pxPerFt - shortest;
      for (const dim of dims) dim.dist += Math.sign(dim.dist || 1) * bump;
    }
    const drawing = drawingScreenBox(dims);
    for (const dim of dims) {
      const seg = offsetSegment(dim);
      const ext = 0.7;
      const a = { x: seg.x0, y: seg.y0 };
      const b = { x: seg.x1, y: seg.y1 };
      const aOut = { x: a.x + seg.rx * ext, y: a.y + seg.ry * ext };
      const bOut = { x: b.x + seg.rx * ext, y: b.y + seg.ry * ext };
      strokeWorld({ x: dim.x0, y: dim.y0 }, aOut, "rgba(42,36,27,0.55)", 1);
      strokeWorld({ x: dim.x1, y: dim.y1 }, bOut, "rgba(42,36,27,0.55)", 1);
      strokeWorld(a, b, INK, 1);
      for (const point of [a, b]) {
        const tick = 0.45;
        strokeWorld(
          {
            x: point.x + (seg.tx + seg.rx) * tick,
            y: point.y + (seg.ty + seg.ry) * tick,
          },
          {
            x: point.x - (seg.tx + seg.rx) * tick,
            y: point.y - (seg.ty + seg.ry) * tick,
          },
          INK,
          1,
        );
      }
      const mid = worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
      const origin = worldToScreen((dim.x0 + dim.x1) / 2, (dim.y0 + dim.y1) / 2);
      const sa = worldToScreen(a.x, a.y);
      const sb = worldToScreen(b.x, b.y);
      let ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const detail = formatFeetFine(seg.len);
      const estimated = String(house.disclaimer || "").toLowerCase().includes("scale estimated");
      const label = estimated ? `est. ${detail.construction}` : detail.construction;
      const note = dimensionNote(dim, detail);
      const boxW = Math.max(ctx.measureText(label).width, note ? ctx.measureText(note).width : 0) + 12;
      const boxH = note ? 28 : 16;
      const awayX = mid.x - origin.x;
      const awayY = mid.y - origin.y;
      const away = Math.hypot(awayX, awayY) || 1;
      const clearOfHouse = {
        x: drawing.x - 6,
        y: drawing.y - 6,
        w: drawing.w + 12,
        h: drawing.h + 12,
      };
      let shift = 0;
      let box = { x: mid.x - boxW / 2, y: mid.y - boxH / 2, w: boxW, h: boxH };
      const crowded = () => labelBoxes.some((item) => rectsOverlap(item, box)) || rectsOverlap(box, clearOfHouse);
      while (crowded() && shift < 96) {
        shift += 12;
        box = {
          x: mid.x + (awayX / away) * shift - boxW / 2,
          y: mid.y + (awayY / away) * shift - boxH / 2,
          w: boxW,
          h: boxH,
        };
      }
      labelBoxes.push(box);
      ctx.save();
      ctx.translate(box.x + boxW / 2, box.y + boxH / 2);
      ctx.rotate(ang);
      const width = boxW;
      ctx.fillStyle = "rgba(243, 235, 221, 0.92)";
      ctx.fillRect(-width / 2, note ? -18 : -11, width, note ? 28 : 16);
      ctx.fillStyle = INK;
      ctx.fillText(label, 0, note ? -8 : -3);
      if (note) {
        ctx.font = "600 10px Outfit, 'Segoe UI', sans-serif";
        ctx.fillStyle = "#2F5D45";
        ctx.fillText(note, 0, 6);
      }
      ctx.restore();
    }
    ctx.restore();
    drawScale();
  }

  function drawScale() {
    const choices = [1, 2, 5, 10, 20, 40];
    const feet = choices.reduce((best, choice) =>
      Math.abs(choice * camera.pxPerFt - 110) < Math.abs(best * camera.pxPerFt - 110) ? choice : best,
    );
    const bar = feet * camera.pxPerFt;
    const { h } = size();
    const x = 18;
    const y = h - 26;
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + bar, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + bar, y - 5);
    ctx.lineTo(x + bar, y + 5);
    ctx.stroke();
    ctx.font = "600 12px Outfit, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatFeet(feet), x + bar / 2, y - 7);
    ctx.restore();
  }

  /**
   * The selection frame, like design software: a dashed box around what is
   * selected, a round handle above it to turn it, and the angle while turning.
   */
  function drawFrame(frame) {
    if (!frame?.box) return;
    const { box } = frame;
    const a = worldToScreen(box.x0, box.y1);
    const b = worldToScreen(box.x1, box.y0);
    const pad = 6;
    const left = Math.min(a.x, b.x) - pad;
    const top = Math.min(a.y, b.y) - pad;
    const right = Math.max(a.x, b.x) + pad;
    const bottom = Math.max(a.y, b.y) + pad;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = "rgba(47, 93, 69, 0.85)";
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.setLineDash([]);
    if (frame.corners) {
      // Corner squares: drag one to make the selection bigger or smaller.
      for (const [x, y] of [[left, top], [right, top], [right, bottom], [left, bottom]]) {
        ctx.beginPath();
        ctx.rect(x - 5, y - 5, 10, 10);
        ctx.fillStyle = "#FFF8F4";
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "#2F5D45";
        ctx.stroke();
      }
    }
    if (frame.handle) {
      const h = worldToScreen(frame.handle.x, frame.handle.y);
      const mid = (left + right) / 2;
      ctx.beginPath();
      ctx.moveTo(mid, top);
      ctx.lineTo(h.x, h.y);
      ctx.strokeStyle = "rgba(47, 93, 69, 0.6)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.x, h.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = frame.active ? "#2F5D45" : "#FFF8F4";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#2F5D45";
      ctx.stroke();
      // A small turning arrow inside the handle.
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3.6, -Math.PI * 0.15, Math.PI * 1.3);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = frame.active ? "#FFF8F4" : "#2F5D45";
      ctx.stroke();
    }
    if (frame.label) {
      ctx.font = "700 12px system-ui, sans-serif";
      const w = ctx.measureText(frame.label).width + 14;
      const x = (left + right) / 2 - w / 2;
      const y = bottom + 10;
      ctx.fillStyle = "rgba(47, 93, 69, 0.92)";
      ctx.beginPath();
      ctx.roundRect?.(x, y, w, 22, 11);
      if (!ctx.roundRect) ctx.rect(x, y, w, 22);
      ctx.fill();
      ctx.fillStyle = "#FFF8F4";
      ctx.fillText(frame.label, x + 7, y + 15);
    }
    ctx.restore();
  }

  /** Window awnings: a board on the outside face, drawn as a hatched strip. */
  function drawAwnings() {
    ctx.save();
    for (const piece of awningPieces(house)) {
      if (state && !isPhaseVisible(piece.wall.phase, state)) continue;
      trace(piece.polygon);
      ctx.fillStyle = "rgba(122, 90, 62, 0.28)";
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "#7A5A3E";
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** The roof edge (eaves), dashed, while the sun layer or the solar tool is on. */
  function drawRoofEdges() {
    if (!showRoofEdges && !sun) return;
    const full = !!state && isFutureShown(state);
    ctx.save();
    ctx.setLineDash([10, 5]);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "rgba(140, 70, 52, 0.7)";
    const stepped = house.roof?.clerestory ? clerestoryBox(roofFootprints(house, full)) : null;
    for (const box of roofFootprints(house, full)) {
      trace([{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }]);
      ctx.stroke();
      if (box === stepped) continue;
      // Ridge and hips, thin, so the roof form reads from above.
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of roofLines(box)) {
        const a = worldToScreen(line.a.x, line.a.y);
        const b = worldToScreen(line.b.x, line.b.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    // A clerestory: the glass line, and the high roof's edge over it.
    const g = house.roof?.clerestory ? clerestoryGeometry(house, clerestoryBox(roofFootprints(house, full)), full) : null;
    if (g) {
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(79, 130, 151, 0.9)";
      const a = worldToScreen(g.glassX0, g.stepY);
      const b = worldToScreen(g.glassX1, g.stepY);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(140, 70, 52, 0.7)";
      const c = worldToScreen(g.box.x0, g.upperEdgeY);
      const d = worldToScreen(g.box.x1, g.upperEdgeY);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.fillStyle = "rgba(79, 130, 151, 0.95)";
      ctx.fillText(`clerestory · ${plainFeet(g.glass)} glass`, a.x + 6, a.y - 6);
    }
    ctx.restore();
  }

  /** Skylights: overhead glass, drawn dashed with the usual cross. */
  /** Pictures under the plan, at their size, turn, and see-through setting. */
  const pictureCache = new Map();
  function pictureFor(item) {
    const key = `${item.src.length}:${item.src.slice(-48)}`;
    let entry = pictureCache.get(item.id);
    if (!entry || entry.key !== key) {
      const img = new Image();
      entry = { key, img, ready: false };
      img.onload = () => {
        entry.ready = true;
        render();
      };
      img.src = item.src;
      pictureCache.set(item.id, entry);
    }
    return entry.ready ? entry.img : null;
  }

  function drawImages() {
    if (state?.layers?.images === false) return;
    for (const item of house.images || []) {
      if (!item?.src) continue;
      const img = pictureFor(item);
      const at = worldToScreen(item.x, item.y);
      const w = item.width * camera.pxPerFt;
      const h = item.height * camera.pxPerFt;
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.rotate((-(item.rotation || 0) * Math.PI) / 180);
      ctx.globalAlpha = Number.isFinite(item.opacity) ? item.opacity : 0.6;
      if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h);
      else {
        ctx.fillStyle = "rgba(90, 70, 40, 0.08)";
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      // A thin outline: the edge is where a click picks the picture.
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#5A4632";
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  /** Building platforms: a stone band out past the walls, under the eaves. */
  function drawPlatforms() {
    const boxes = roofFootprints(house, true).filter((box) => box.platform > 0);
    if (!boxes.length) return;
    ctx.save();
    for (const box of boxes) {
      const r = platformRect(box);
      trace([{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }]);
      ctx.fillStyle = "rgba(167, 159, 146, 0.45)";
      ctx.fill();
      ctx.strokeStyle = "#7D766B";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Timber columns: dark posts, round or square, drawn at true size (at least a dot). */
  function drawColumns() {
    ctx.save();
    for (const column of house.columns || []) {
      if (state && !isPhaseVisible(column.phase, state)) continue;
      const spot = worldToScreen(column.x, column.y);
      const r = Math.max(3, ((Number(column.size) || 0.75) / 2) * camera.pxPerFt);
      ctx.beginPath();
      if (column.shape === "square") ctx.rect(spot.x - r, spot.y - r, r * 2, r * 2);
      else ctx.arc(spot.x, spot.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = column.phase === "future" ? 0.45 : 1;
      ctx.fillStyle = "#6B3A26";
      ctx.fill();
      ctx.strokeStyle = "#2A1A10";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * A fixture or appliance from above, in its own frame (feet, +y is the
   * front, back against the wall): a body, and the detail that says what it
   * is, a bowl, a basin, burners, a drum, doors.
   */
  function drawFurnishing(item, ghost) {
    const W = item.width || 2;
    const D = item.depth || 2;
    const at = worldToScreen(item.x, item.y);
    const k = camera.pxPerFt;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate((-(item.rotation || 0) * Math.PI) / 180);
    ctx.scale(k, -k);
    ctx.lineWidth = 1.2 / k;
    ctx.lineJoin = "round";
    if (ghost) ctx.globalAlpha = 0.6;
    const fills = { toilet: "#FBFBF8", "bath-sink": "#F4EEE4", "kitchen-sink": "#F3E2B8", shower: "#DDEFF5", stove: "#E6E8EA", dishwasher: "#E6E8EA", fridge: "#EEF1F3", washer: "#F2F4F6", dryer: "#F2F4F6", wardrobe: "#C9A27C" };
    const ink = "#3F342C";
    const box = (x0, y0, x1, y1, fill) => {
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = ink;
      ctx.stroke();
    };
    const oval = (cx, cy, rx, ry, fill) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = ink;
      ctx.stroke();
    };
    const line = (x0, y0, x1, y1) => {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = ink;
      ctx.stroke();
    };
    const x0 = -W / 2;
    const x1 = W / 2;
    const y0 = -D / 2;
    const y1 = D / 2;
    const kind = item.kind;
    if (kind === "toilet") {
      const tank = Math.min(0.75, D * 0.28);
      box(x0, y0, x1, y0 + tank, fills.toilet);
      oval(0, (y0 + tank + y1) / 2, W * 0.4, (y1 - y0 - tank) / 2, fills.toilet);
      oval(0, (y0 + tank + y1) / 2 + 0.05, W * 0.26, (y1 - y0 - tank) / 2 * 0.62, "#DCE7EC");
    } else if (kind === "bath-sink") {
      box(x0, y0, x1, y1, fills["bath-sink"]);
      oval(0, 0.05, W * 0.3, D * 0.28, "#DCE7EC");
    } else if (kind === "kitchen-sink") {
      box(x0, y0, x1, y1, fills["kitchen-sink"]);
      box(x0 + 0.25, y0 + 0.3, -0.06, y1 - 0.3, "#DCE7EC");
      box(0.06, y0 + 0.3, x1 - 0.25, y1 - 0.3, "#DCE7EC");
    } else if (kind === "shower") {
      box(x0, y0, x1, y1, fills.shower);
      line(x0, y0, x1, y1);
      line(x0, y1, x1, y0);
      oval(0, 0, 0.18, 0.18, "#FFFFFF");
    } else if (kind === "stove") {
      box(x0, y0, x1, y1, fills.stove);
      for (const [bx, by] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) oval(bx * W * 0.24, by * D * 0.22, Math.min(W, D) * 0.17, Math.min(W, D) * 0.17, "#3B3B3B");
    } else if (kind === "dishwasher") {
      box(x0, y0, x1, y1, fills.dishwasher);
      line(x0 + 0.15, y1 - 0.25, x1 - 0.15, y1 - 0.25);
    } else if (kind === "fridge") {
      box(x0, y0, x1, y1, fills.fridge);
      line(0, y1 - 0.4, 0, y1);
      line(x0, y1 - 0.12, x1, y1 - 0.12);
    } else if (kind === "washer" || kind === "dryer") {
      box(x0, y0, x1, y1, fills[kind]);
      oval(0, 0.1, Math.min(W, D) * 0.33, Math.min(W, D) * 0.33, kind === "washer" ? "#CFE3EC" : "#E8E2D6");
    } else if (kind === "wardrobe") {
      box(x0, y0, x1, y1, fills.wardrobe);
      line(0, y0, 0, y1);
      line(x0, y1 - 0.1, x1, y1 - 0.1);
    } else {
      box(x0, y0, x1, y1, "#E7DDD0");
    }
    if (ghost) {
      ctx.setLineDash([0.3, 0.2]);
      ctx.lineWidth = 2 / k;
      ctx.strokeStyle = "#1F6F8B";
      ctx.strokeRect(x0 - 0.05, y0 - 0.05, W + 0.1, D + 0.1);
    }
    ctx.restore();
  }

  /** A template following the pointer before it is placed: rooms, walls, and posts, see-through. */
  function drawTemplateGhost(ghost) {
    if (!ghost) return;
    ctx.save();
    const tint = ghost.ok === false ? "196, 69, 54" : "31, 111, 139";
    for (const room of ghost.rooms || []) {
      trace(room.polygon);
      ctx.fillStyle = room.kind === "site" ? `rgba(${tint}, 0.06)` : `rgba(${tint}, 0.16)`;
      ctx.fill();
    }
    for (const wall of ghost.walls || []) {
      trace(segmentQuad(wall.start.x, wall.start.y, wall.end.x, wall.end.y, wall.thickness || 0.5));
      ctx.fillStyle = `rgba(${tint}, 0.55)`;
      ctx.fill();
    }
    ctx.fillStyle = `rgba(${tint}, 0.8)`;
    for (const column of ghost.columns || []) {
      const spot = worldToScreen(column.x, column.y);
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, Math.max(2.5, ((column.size || 0.75) / 2) * camera.pxPerFt), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = `rgba(${tint}, 0.9)`;
    ctx.lineWidth = 1.5;
    if (ghost.box) {
      trace([{ x: ghost.box.x0, y: ghost.box.y0 }, { x: ghost.box.x1, y: ghost.box.y0 }, { x: ghost.box.x1, y: ghost.box.y1 }, { x: ghost.box.x0, y: ghost.box.y1 }]);
      ctx.stroke();
      if (ghost.label) {
        const at = worldToScreen((ghost.box.x0 + ghost.box.x1) / 2, ghost.box.y1);
        ctx.setLineDash([]);
        ctx.font = "600 13px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const w = ctx.measureText(ghost.label).width + 16;
        ctx.fillStyle = "rgba(247, 243, 235, 0.95)";
        ctx.fillRect(at.x - w / 2, at.y - 30, w, 22);
        ctx.fillStyle = `rgb(${tint})`;
        ctx.fillText(ghost.label, at.x, at.y - 12);
      }
    }
    ctx.restore();
  }

  function drawSkylights() {
    ctx.save();
    for (const item of house.skylights || []) {
      if (state && !isPhaseVisible(item.phase, state)) continue;
      const corners = skylightFootprint(item, house, !!state && isFutureShown(state));
      trace(corners);
      ctx.fillStyle = "rgba(196, 226, 240, 0.55)";
      ctx.fill();
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#3D7A97";
      ctx.stroke();
      ctx.setLineDash([]);
      const p = corners.map((point) => worldToScreen(point.x, point.y));
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      ctx.lineTo(p[2].x, p[2].y);
      ctx.moveTo(p[1].x, p[1].y);
      ctx.lineTo(p[3].x, p[3].y);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "rgba(61, 122, 151, 0.55)";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAnnotations() {
    ctx.save();
    ctx.lineJoin = "round";
    for (const item of house.furniture || []) {
      if (!markVisible(item.roomId)) continue;
      if (item.kind === "person") {
        drawPersonTop(item);
        continue;
      }
      if (isFurnishing(item)) {
        drawFurnishing(item, false);
        continue;
      }
      const footprint = furnitureFootprint(item);
      trace(footprint);
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = furnitureFill(item.kind);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#3F342C";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const feature of house.siteFeatures || []) {
      const screen = worldToScreen(feature.x, feature.y);
      const radius = Math.max(7, Math.min(22, (feature.size || 6) * camera.pxPerFt * 0.35));
      ctx.beginPath();
      if (feature.kind === "pond") {
        ctx.ellipse(screen.x, screen.y, radius * 1.4, radius * 0.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(47, 111, 139, 0.45)";
        ctx.fill();
      } else if (feature.kind === "pavilion") {
        ctx.strokeStyle = "#6E3A28";
        ctx.lineWidth = 2;
        ctx.strokeRect(screen.x - radius, screen.y - radius, radius * 2, radius * 2);
      } else if (feature.kind === "wind") {
        ctx.strokeStyle = "#1F6F8B";
        ctx.lineWidth = 1.5;
        ctx.moveTo(screen.x - 10, screen.y);
        ctx.lineTo(screen.x + 10, screen.y);
        ctx.stroke();
      } else {
        ctx.arc(screen.x, screen.y, radius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = feature.kind === "tree" ? "#2F5D45" : "#6E5C48";
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawAnnotationLabels() {
    if (!state?.layers.labels) return;
    const important = (text) => text === "ERV" || String(text).includes("天井") || /north facing/i.test(text);
    const labels = [...(house.planLabels || [])].sort((a, b) => Number(important(b.text)) - Number(important(a.text)));
    for (const label of labels) {
      const screen = worldToScreen(label.x, label.y);
      drawFadedLabel(label.text, screen.x, screen.y, important(label.text) ? 12 : 18, "#8A5A2B");
    }
    for (const feature of house.siteFeatures || []) {
      const screen = worldToScreen(feature.x, feature.y);
      const radius = Math.max(7, Math.min(22, (feature.size || 6) * camera.pxPerFt * 0.35));
      drawFadedLabel(feature.name, screen.x, screen.y - radius - 10, feature.kind === "wind" ? 12 : 16, INK);
    }
    for (const item of house.furniture || []) {
      if (!markVisible(item.roomId)) continue;
      const span = Math.max(item.width || 2, item.depth || 2) * camera.pxPerFt;
      if (span < 36) continue;
      const screen = worldToScreen(item.x, item.y);
      drawFadedLabel(item.name, screen.x, screen.y, 20, INK);
    }
  }

  function drawFadedLabel(text, x, y, minZoom, color) {
    const zoom = camera.pxPerFt || 0;
    if (zoom < minZoom) return;
    ctx.font = "600 11px Outfit, 'Segoe UI', sans-serif";
    const width = ctx.measureText(text).width + 8;
    const box = { x: x - width / 2, y: y - 8, w: width, h: 16 };
    if (labelBoxes.some((item) => rectsOverlap(item, box))) return;
    const fade = Math.min(1, (zoom - minZoom) / 8);
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.72 * fade;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
    labelBoxes.push(box);
  }

  function markVisible(roomId) {
    if (!roomId) return true;
    const room = house.rooms.find((item) => item.id === roomId);
    return !room || isPhaseVisible(room.phase, state);
  }

  /** A person seen from above: shoulders and a head, at true size. */
  function drawPersonTop(item) {
    const at = worldToScreen(item.x, item.y);
    const scale = camera.pxPerFt;
    const rad = -((item.rotation || 0) * Math.PI) / 180;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(rad);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(3, 0.875 * scale), Math.max(2, 0.5 * scale), 0, 0, Math.PI * 2);
    ctx.fillStyle = "#5C6F7D";
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, 0.36 * scale), 0, Math.PI * 2);
    ctx.fillStyle = "#D9B48F";
    ctx.fill();
    ctx.strokeStyle = "#3F342C";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function furnitureFill(kind) {
    if (kind === "sofa") return "#B9A58C";
    if (kind === "bed") return "#B7D4EA";
    if (kind === "counter") return "#F3E2B8";
    if (kind === "appliance") return "#F0B7C4";
    if (kind === "car") return "#9AA89A";
    if (kind === "table") return "#E4C09A";
    return "#E7DDD0";
  }

  function drawLabels() {
    if (!state?.layers.labels) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const room of house.rooms) {
      if (!isPhaseVisible(room.phase, state)) continue;
      const kind = areaKind(room);
      if (kind !== "heated" && (camera.pxPerFt || 0) < 14) continue;
      const xs = room.polygon.map((point) => point.x);
      const ys = room.polygon.map((point) => point.y);
      const boxW = (Math.max(...xs) - Math.min(...xs)) * camera.pxPerFt;
      const boxH = (Math.max(...ys) - Math.min(...ys)) * camera.pxPerFt;
      if (boxW < 52 || boxH < 36) continue;
      const roomTop = worldToScreen(Math.min(...xs), Math.max(...ys));
      const roomScreen = { x: roomTop.x, y: roomTop.y, w: boxW, h: boxH };
      const insideRoom = (rect) => rect.x >= roomScreen.x + 2
        && rect.y >= roomScreen.y + 2
        && rect.x + rect.w <= roomScreen.x + roomScreen.w - 2
        && rect.y + rect.h <= roomScreen.y + roomScreen.h - 2;
      const at = room.labelAt || polygonCentroid(room.polygon);
      const s = worldToScreen(at.x, at.y);
      const future = room.phase === "future";
      const nameSize = Math.max(11, Math.min(18, camera.pxPerFt * 1.05));
      ctx.font = `600 ${nameSize}px Outfit, 'Segoe UI', sans-serif`;
      ctx.fillStyle = future ? "#6A5E52" : INK;
      let nameY = boxH < 78 ? s.y : s.y - nameSize * 0.55;
      const nameW = ctx.measureText(room.name).width + 8;
      let nameBox = { x: s.x - nameW / 2, y: nameY - nameSize * 0.7, w: nameW, h: nameSize * 1.3 };
      let guard = 0;
      while (labelBoxes.some((item) => rectsOverlap(item, nameBox)) && guard < 4) {
        nameY -= nameSize;
        nameBox = { ...nameBox, y: nameY - nameSize * 0.7 };
        guard += 1;
      }
      if (labelBoxes.some((item) => rectsOverlap(item, nameBox)) && room.phase !== "phase1") continue;
      const nameFade = kind === "heated" ? 1 : Math.min(1, ((camera.pxPerFt || 0) - 14) / 8);
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.6 * nameFade;
      labelBoxes.push(nameBox);
      ctx.fillText(room.name, s.x, nameY);
      ctx.restore();
      const ground = roomGroundLine(room);
      if (ground && boxH >= 48 && kind === "heated") {
        ctx.font = `500 ${Math.max(10, nameSize - 3)}px Outfit, 'Segoe UI', sans-serif`;
        ctx.fillStyle = "#8A5A2B";
        ctx.fillText(ground, s.x, nameY + nameSize);
      }
      if (kind !== "heated" || boxW < 78 || boxH < 78) continue;
      ctx.font = `500 ${Math.max(10, nameSize - 3)}px Outfit, 'Segoe UI', sans-serif`;
      const estimated = String(house.disclaimer || "").toLowerCase().includes("scale estimated");
      const areaText = `${estimated ? "about " : ""}${formatArea(polygonArea(room.polygon))} sq ft`;
      const areaW = ctx.measureText(areaText).width + 8;
      const areaBox = { x: s.x - areaW / 2, y: s.y + nameSize * 0.55 - nameSize * 0.6, w: areaW, h: nameSize };
      if (insideRoom(areaBox) && !labelBoxes.some((item) => rectsOverlap(item, areaBox))) {
        labelBoxes.push(areaBox);
        ctx.fillStyle = MUTED;
        ctx.fillText(areaText, s.x, s.y + nameSize * 0.55);
      }
      let proportionDrawn = false;
      if (camera.pxPerFt >= 20 && boxW > 130 && boxH > 96) {
        const line = roomProportion(room, house.customRatios || []).phrase;
        const lineSize = Math.max(13, Math.min(16, nameSize - 2));
        ctx.font = `400 ${lineSize}px ${RATIO_FONT}`;
        ctx.letterSpacing = "0.06em";
        const lineWidth = ctx.measureText(line).width;
        if (line && lineWidth < boxW - 16) {
          ctx.fillStyle = "#1d3d2e";
          ctx.fillText(line, s.x, s.y + nameSize * 1.85);
          proportionDrawn = true;
        }
        ctx.letterSpacing = "0px";
      }
      if (future) {
        ctx.font = `500 ${Math.max(11, nameSize - 4)}px Outfit, 'Segoe UI', sans-serif`;
        const later = "later";
        const laterW = ctx.measureText(later).width + 8;
        const laterY = s.y + nameSize * (proportionDrawn ? 3.05 : 1.7);
        const laterBox = { x: s.x - laterW / 2, y: laterY - nameSize * 0.55, w: laterW, h: nameSize };
        if (insideRoom(laterBox) && !labelBoxes.some((item) => rectsOverlap(item, laterBox))) {
          labelBoxes.push(laterBox);
          ctx.fillStyle = "#8A7360";
          ctx.fillText(later, s.x, laterY);
        }
      }
    }
    ctx.restore();
  }

  function drawCompass() {
    const { w } = size();
    ctx.save();
    ctx.translate(w - 42, 48);
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(247, 243, 235, 0.94)";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(4.5, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-4.5, 7);
    ctx.closePath();
    ctx.fillStyle = "#C4654A";
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = "700 11px Outfit, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", 0, -24);
    ctx.restore();
  }

  function drawWatermark() {
    const { w, h } = size();
    const estimated = String(house.disclaimer || "").toLowerCase().includes("scale estimated");
    if (!house.sample && !estimated) return;
    ctx.save();
    ctx.font = "600 11px Outfit, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(90, 74, 58, 0.82)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const line = house.sample
      ? "SAMPLE LAYOUT — not a final design"
      : "scale estimated from drawing, confirm one real measurement. Windows are not drawn.";
    ctx.fillText(line, w / 2, h - 8);
    ctx.restore();
  }

  function pixelRatio(w, h) {
    const area = (w || 0) * (h || 0);
    const cap = area > 700_000 ? 1.25 : 1.5;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function scheduleCameraSave() {
    window.clearTimeout(cameraSaveTimer);
    cameraSaveTimer = window.setTimeout(() => onChange({ ...camera }), 180);
  }

  function cachedSite() {
    if (!siteCache || siteCache.house !== house) siteCache = { house, design: buildSite(house) };
    return siteCache.design;
  }

  function cachedPlumbing() {
    const phase = electricalPhase();
    if (!plumbingCache || plumbingCache.house !== house || plumbingCache.phase !== phase) {
      plumbingCache = { house, phase, design: buildPlumbing(house, { phase }) };
    }
    return plumbingCache.design;
  }

  function cachedElectrical() {
    const phase = electricalPhase();
    if (!electricalCache || electricalCache.house !== house || electricalCache.phase !== phase) {
      electricalCache = { house, phase, design: buildElectrical(house, { phase }) };
    }
    return electricalCache.design;
  }

  function render() {
    try {
    layoutCanvas();
    if (!ratioFontReady && document.fonts?.load) {
      ratioFontReady = true;
      Promise.all([
        document.fonts.load(`400 16px "Noto Sans Math"`, RATIO_GLYPHS),
        document.fonts.load(`500 16px "Noto Sans"`, RATIO_GLYPHS),
      ]).then(() => render());
    }
    const { w, h } = size();
    if (w < 2 || h < 2) return;
    if (!usableCamera(camera)) camera = { cx: Number.isFinite(camera.cx) ? camera.cx : 0, cy: Number.isFinite(camera.cy) ? camera.cy : 0, pxPerFt: 8 };
    if (!openedFrame && w > 20 && h > 20 && !contentOnScreen()) {
      openedFrame = true;
      fit(false);
      return;
    }
    if (!openedFrame && w > 20 && h > 20) openedFrame = true;
    labelBoxes = [];
    measureLabelHit = null;
    const dpr = pixelRatio(w, h);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#F3EBDD";
    ctx.fillRect(0, 0, w, h);
    drawGrid();
    drawSiteGround();
    drawPlatforms();
    drawRooms();
    // Pictures sit over the room colours (see-through) and under the walls, like tracing paper.
    drawImages();
    drawSunLight();
    drawWalls((house.walls || []).filter((wall) => wall?.start && wall?.end && wallVisible(wall)));
    for (const wall of house.walls || []) {
      if (!wallVisible(wall)) continue;
      for (const opening of openingsFor(house, wall)) drawOpening(wall, opening);
    }
    if (state?.layers.framing) {
      for (const wall of house.walls || []) {
        if (isPhaseVisible(wall.phase, state)) drawStuds(wall);
      }
    }
    drawColumns();
    drawElectrical();
    drawPlumbing();
    drawAnnotations();
    drawSkylights();
    drawAwnings();
    drawRoofEdges();
    drawSitePieces();
    drawOverlay();
    drawDimensions();
    drawLabels();
    drawAnnotationLabels();
    drawConstraintBadges();
    drawGuides();
    drawCompass();
    drawWatermark();
    drawMarkers();
    drawSunRing();
    drawWalker();
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Sun and shade, top down. Roofed rooms sit in shade, walls throw shadows on
   * the ground, and warm patches show where sun comes in through glass.
   * Shade and shadows go into one mask first, so overlaps don't get darker.
   */
  function drawSunLight() {
    if (!sun) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (!shadeCanvas) shadeCanvas = document.createElement("canvas");
    if (shadeCanvas.width !== Math.round(w * dpr) || shadeCanvas.height !== Math.round(h * dpr)) {
      shadeCanvas.width = Math.round(w * dpr);
      shadeCanvas.height = Math.round(h * dpr);
    }
    const mask = shadeCanvas.getContext("2d");
    mask.setTransform(dpr, 0, 0, dpr, 0, 0);
    mask.clearRect(0, 0, w, h);
    const traceOn = (g, points) => {
      g.beginPath();
      points.forEach((point, index) => {
        const p = worldToScreen(point.x, point.y);
        if (index) g.lineTo(p.x, p.y);
        else g.moveTo(p.x, p.y);
      });
      g.closePath();
    };
    const visibleRoom = (room) => room?.polygon?.length >= 3 && (!state || isPhaseVisible(room.phase, state));
    mask.fillStyle = "#000";
    if (!sun.up) {
      mask.fillRect(0, 0, w, h);
    } else {
      for (const quad of wallShadows(house, sun, { wallVisible })) {
        traceOn(mask, quad);
        mask.fill();
      }
      // The roof's shadow: eaves, rakes and ridge, so the shadow on the ground matches the 3D roof.
      for (const outline of roofShadows(house, sun, { full: !!state && isFutureShown(state) })) {
        traceOn(mask, outline);
        mask.fill();
      }
      for (const room of house.rooms || []) {
        if (!visibleRoom(room) || !roofed(room)) continue;
        traceOn(mask, room.polygon);
        mask.fill();
      }
      // Skylights bring daylight in even without direct sun: lighter shade under them.
      mask.save();
      mask.globalCompositeOperation = "destination-out";
      for (const item of house.skylights || []) {
        if (state && !isPhaseVisible(item.phase, state)) continue;
        const corners = skylightFootprint(item, house, !!state && isFutureShown(state));
        const middle = worldToScreen(item.x, item.y);
        const reach = Math.max(item.width, item.depth) * camera.pxPerFt * 1.4;
        const glow = mask.createRadialGradient(middle.x, middle.y, 0, middle.x, middle.y, reach);
        glow.addColorStop(0, "rgba(0,0,0,0.55)");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        mask.fillStyle = glow;
        mask.fillRect(middle.x - reach, middle.y - reach, reach * 2, reach * 2);
        traceOn(mask, corners);
        mask.fillStyle = "rgba(0,0,0,0.4)";
        mask.fill();
      }
      mask.restore();
    }
    ctx.save();
    ctx.globalAlpha = sun.up ? 0.3 : 0.5;
    ctx.drawImage(shadeCanvas, 0, 0, w, h);
    ctx.restore();
    if (!sun.up) return;
    // Sun patches: warm, brightest near the window.
    const warmth = Math.max(0.35, Math.min(1, sun.elevation / 35));
    for (const patch of sunPatches(house, sun, { wallVisible, roomVisible: visibleRoom, full: !!state && isFutureShown(state) })) {
      const room = (house.rooms || []).find((item) => item.id === patch.roomId);
      if (!room) continue;
      ctx.save();
      trace(room.polygon);
      ctx.clip();
      trace(patch.polygon);
      ctx.fillStyle = `rgba(255, ${Math.round(205 + 25 * warmth)}, ${Math.round(110 + 70 * warmth)}, 0.62)`;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255, 196, 92, 0.85)";
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The middle of what is drawn, and a ring around it for the sun marker. */
  function sunRing() {
    const box = boundsOf((house.rooms || []).filter((room) => room?.polygon?.length >= 3 && (!state || isPhaseVisible(room.phase, state))));
    if (!box || !Number.isFinite(box.x0)) return null;
    const center = worldToScreen((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    const corner = worldToScreen(box.x1, box.y0);
    const radius = Math.max(70, Math.hypot(corner.x - center.x, corner.y - center.y) + 40);
    return { center, radius };
  }

  function sunMarkerAt(ring) {
    const az = (sun.azimuth * Math.PI) / 180;
    return { x: ring.center.x + Math.sin(az) * ring.radius, y: ring.center.y - Math.cos(az) * ring.radius };
  }

  /** Where the sun is, around the house. Drag it when the sun is set by hand. */
  function drawSunRing() {
    if (!sun) return;
    const ring = sunRing();
    if (!ring) return;
    const at = sunMarkerAt(ring);
    ctx.save();
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = "rgba(196, 135, 40, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ring.center.x, ring.center.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (sun.up) {
      // A few rays pointing in, the way the light travels.
      const dx = ring.center.x - at.x;
      const dy = ring.center.y - at.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      ctx.strokeStyle = "rgba(230, 160, 40, 0.75)";
      ctx.lineWidth = 2;
      for (const shift of [-10, 0, 10]) {
        const ox = -uy * shift;
        const oy = ux * shift;
        ctx.beginPath();
        ctx.moveTo(at.x + ux * 18 + ox, at.y + uy * 18 + oy);
        ctx.lineTo(at.x + ux * 40 + ox, at.y + uy * 40 + oy);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(at.x, at.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = sun.up ? "#F4B23A" : "#5A6478";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#FFF8F4";
    ctx.stroke();
    ctx.restore();
  }

  function sunHit(local) {
    if (!sun || sun.source !== "manual") return false;
    const ring = sunRing();
    if (!ring) return false;
    const at = sunMarkerAt(ring);
    return Math.hypot(local.x - at.x, local.y - at.y) <= 16;
  }

  /** "You are here" for the walk-through: a dot with a view cone, true to scale. */
  function drawWalker() {
    if (!walker) return;
    const at = worldToScreen(walker.x, walker.y);
    // Forward in plan feet. The 3D yaw turns counterclockwise from north.
    const fx = -Math.sin(walker.yaw);
    const fy = Math.cos(walker.yaw);
    const heading = Math.atan2(-fy, fx);
    const reach = Math.max(36, 10 * camera.pxPerFt);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.arc(at.x, at.y, reach, heading - 0.5, heading + 0.5);
    ctx.closePath();
    const cone = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, reach);
    cone.addColorStop(0, "rgba(196, 101, 74, 0.42)");
    cone.addColorStop(1, "rgba(196, 101, 74, 0)");
    ctx.fillStyle = cone;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(at.x, at.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#C4654A";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#FFF8F4";
    ctx.stroke();
    ctx.font = "700 11px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(247, 243, 235, 0.95)";
    ctx.strokeText("You", at.x, at.y + 12);
    ctx.fillStyle = "#6D3224";
    ctx.fillText("You", at.x, at.y + 12);
    ctx.restore();
  }

  function walkerHit(local) {
    if (!walker) return false;
    const at = worldToScreen(walker.x, walker.y);
    return Math.hypot(local.x - at.x, local.y - at.y) <= 16;
  }

  function drawStuds(wall) {
    const spec = assemblyById[wall.assemblyId]?.framing;
    if (!spec) return;
    const length = wallLength(wall);
    if (length < 0.2) return;
    const dx = (wall.end.x - wall.start.x) / length;
    const dy = (wall.end.y - wall.start.y) / length;
    const openings = openingsFor(house, wall);
    ctx.save();
    const stud = (s, color) => {
      if (s < 0.04 || s > length - 0.04) return;
      const center = pointAlong(wall, s);
      const half = spec.studThickness / 2;
      const quad = segmentQuad(
        center.x - dx * half,
        center.y - dy * half,
        center.x + dx * half,
        center.y + dy * half,
        Math.min(wall.thickness * 0.78, spec.studDepth + 0.05),
      );
      trace(quad);
      ctx.fillStyle = color;
      ctx.fill();
    };
    ctx.globalAlpha = wall.phase === "future" ? 0.55 : 0.95;
    for (let s = spec.spacing / 2; s < length; s += spec.spacing) {
      const blocked = openings.some((opening) => s > opening.offset - 0.35 && s < opening.offset + opening.width + 0.35);
      if (!blocked) stud(s, "#8D5A32");
    }
    for (const opening of openings) {
      stud(opening.offset - spec.studThickness * 1.4, "#6B3E22");
      stud(opening.offset + spec.studThickness * 0.7, "#6B3E22");
      stud(opening.offset + opening.width - spec.studThickness * 0.7, "#6B3E22");
      stud(opening.offset + opening.width + spec.studThickness * 1.4, "#6B3E22");
      const a = pointAlong(wall, opening.offset);
      const b = pointAlong(wall, opening.offset + opening.width);
      trace(segmentQuad(a.x, a.y, b.x, b.y, wall.thickness * 0.92));
      ctx.fillStyle = "#3F2918";
      ctx.fill();
      const sa = worldToScreen(a.x, a.y);
      const sb = worldToScreen(b.x, b.y);
      if (!state?.layers.infill && Math.hypot(sb.x - sa.x, sb.y - sa.y) > 28) {
        ctx.fillStyle = "#F7F3EB";
        ctx.font = "700 10px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(opening.header?.label || "HDR", (sa.x + sb.x) / 2, (sa.y + sb.y) / 2);
      }
    }
    ctx.restore();
  }

  function systemAlpha(system) {
    if (!state?.focus || state.focus === system) return 1;
    return 0.25;
  }

  function drawPlumbing() {
    if (!state?.layers.plumbing || !house.plumbing) return;
    const design = cachedPlumbing();
    const selectedId = overlay?.selection?.type === "fixture" ? overlay.selection.id : null;
    const active = hoverPipeId || (selectedId ? `fixture:${selectedId}` : null);
    ctx.save();
    ctx.globalAlpha = systemAlpha("plumbing");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const drawRun = (points, color, dashed, id, label) => {
      if (!points || points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = active && (active === id || active === `fixture:${id.split(":")[1]}`) ? 4 : 2;
      ctx.setLineDash(dashed ? [6, 4] : []);
      points.forEach((point, index) => {
        const screen = worldToScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      const show = active === id || (selectedId && id.endsWith(selectedId));
      if (show && label) {
        const mid = points[Math.floor(points.length / 2)];
        const screen = worldToScreen(mid.x, mid.y);
        ctx.font = "700 11px Outfit, sans-serif";
        const width = ctx.measureText(label).width + 8;
        ctx.fillStyle = "rgba(247, 243, 235, 0.92)";
        ctx.fillRect(screen.x + 8, screen.y - 18, width, 16);
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, screen.x + 12, screen.y - 10);
      }
    };
    for (const runItem of design.supply) {
      const color = runItem.service === "hot" ? "#C23B22" : "#1F6F8B";
      const wait = runItem.service === "hot" && runItem.gallons ? ` · ${runItem.gallons} gal` : "";
      drawRun(runItem.points, color, false, `${runItem.service}:${runItem.fixtureId}`, `${runItem.size} in ${runItem.service} · ${runItem.length} ft${wait}`);
    }
    for (const leg of design.dwv) {
      drawRun(leg.points, "#6B4A2A", true, `drain:${leg.fixtureId}`, `${leg.size} in drain · ${leg.length} ft`);
    }
    if (design.building?.length) {
      drawRun(design.building.points, "#3F2918", true, "building", `${design.building.size} in building drain · ${design.building.slope.inchesPerFoot} in/ft · drop ${design.building.slope.inches} in`);
    }
    const mark = (x, y, letter, id, name = "") => {
      const screen = worldToScreen(x, y);
      const on = active === id || (selectedId && id.endsWith(selectedId));
      ctx.beginPath();
      ctx.fillStyle = "#F7F3EB";
      ctx.strokeStyle = "#3F2918";
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.arc(screen.x, screen.y, on ? 9 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1d1a16";
      ctx.font = "700 8px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, screen.x, screen.y);
      if (name) {
        ctx.font = "700 12px Outfit, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(name, screen.x + 14, screen.y - 14);
      }
    };
    const letters = { toilet: "T", lavatory: "L", "kitchen-sink": "S", dishwasher: "D", shower: "H", tub: "B", washer: "W", "laundry-sink": "Y", "hose-bibb": "HB", "water-heater": "WH" };
    for (const fixture of design.fixtures) {
      if (state?.issuesOnly && !(state.issueFixtureIds || []).includes(fixture.id) && fixture.id !== selectedId) continue;
      mark(fixture.x, fixture.y, letters[fixture.kind] || "P", `fixture:${fixture.id}`);
    }
    for (const fixture of house.plumbing.fixtures || []) {
      if (!fixture.ghost || !isPhaseVisible(fixture.phase, state)) continue;
      const focus = overlay?.suggestFocus;
      const dim = !!(focus && fixture.roomId !== focus);
      ctx.save();
      ctx.globalAlpha = systemAlpha("plumbing") * (dim ? 0.18 : 1);
      mark(fixture.x, fixture.y, letters[fixture.kind] || "P", `fixture:${fixture.id}`, dim ? "" : (fixture.name || "Fixture"));
      ctx.restore();
    }
    if (design.entry) mark(design.entry.x, design.entry.y, "E", "entry");
    if (design.septic) mark(design.septic.x, design.septic.y, "ST", "septic");
    ctx.restore();
  }

  function electricalPhase() {
    if (!state) return "full";
    if (state.phase === "phase1" || !state.layers.future) return "phase1";
    return "full";
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function roomLabelRects() {
    if (!state?.layers.labels) return [];
    const rects = [];
    for (const room of house.rooms) {
      if (!isPhaseVisible(room.phase, state)) continue;
      const xs = room.polygon.map((point) => point.x);
      const ys = room.polygon.map((point) => point.y);
      const boxW = (Math.max(...xs) - Math.min(...xs)) * camera.pxPerFt;
      const boxH = (Math.max(...ys) - Math.min(...ys)) * camera.pxPerFt;
      if (boxW < 52 || boxH < 36) continue;
      const at = room.labelAt || polygonCentroid(room.polygon);
      const s = worldToScreen(at.x, at.y);
      const nameSize = Math.max(11, Math.min(18, camera.pxPerFt * 1.05));
      ctx.font = `600 ${nameSize}px Outfit, 'Segoe UI', sans-serif`;
      const nameW = ctx.measureText(room.name).width + 12;
      const nameY = boxH < 78 ? s.y : s.y - nameSize * 0.55;
      rects.push({ x: s.x - nameW / 2, y: nameY - nameSize, w: nameW, h: nameSize * 2.4 });
    }
    return rects;
  }

  function circuitFromPoint(design, point) {
    let best = null;
    for (const circuit of design.circuits) {
      for (const segment of circuit.segments) {
        const pts = segment.points || [];
        for (let i = 1; i < pts.length; i += 1) {
          const distance = distanceToSegment(point, pts[i - 1], pts[i]);
          if (distance > 1.4) continue;
          if (!best || distance < best.distance) best = { circuit, distance };
        }
      }
      for (const id of circuit.deviceIds) {
        const device = design.devices.find((item) => item.id === id);
        if (!device) continue;
        const at = { x: device._x, y: device._y };
        const distance = Math.hypot(at.x - point.x, at.y - point.y);
        if (distance > 1.4) continue;
        if (!best || distance < best.distance) best = { circuit, distance };
      }
    }
    return best;
  }

  function distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
  }

  function drawCircuitLabel(circuit, color, avoid) {
    const text = `Wire loss ${circuit.voltageDrop.percent}%`;
    let longest = null;
    for (const segment of circuit.segments) {
      const pts = segment.points || [];
      for (let i = 1; i < pts.length; i += 1) {
        const span = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (!longest || span > longest.span) longest = { a: pts[i - 1], b: pts[i], span };
      }
    }
    if (!longest || longest.span < 0.5) return;
    const a = worldToScreen(longest.a.x, longest.a.y);
    const b = worldToScreen(longest.b.x, longest.b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = Math.hypot(dx, dy) || 1;
    const nx = -dy / span;
    const ny = dx / span;
    ctx.font = "700 11px Outfit, sans-serif";
    const width = ctx.measureText(text).width + 8;
    const height = 16;
    const offsets = [16, -16, 30, -30, 46, -46];
    let chosen = { x: midX + nx * 16, y: midY + ny * 16 };
    for (const offset of offsets) {
      const x = midX + nx * offset;
      const y = midY + ny * offset;
      const rect = { x: x - width / 2, y: y - height / 2, w: width, h: height };
      if (!avoid.some((item) => rectsOverlap(rect, item))) {
        chosen = { x, y };
        avoid.push(rect);
        break;
      }
    }
    ctx.fillStyle = "rgba(247, 243, 235, 0.92)";
    ctx.fillRect(chosen.x - width / 2, chosen.y - height / 2, width, height);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, chosen.x, chosen.y);
  }

  function drawElectrical() {
    if (!state?.layers.electrical || !house.electrical) return;
    const design = cachedElectrical();
    const selectedId = overlay?.selection?.type === "device" ? overlay.selection.id : null;
    const activeId = hoverCircuitId || design.circuits.find((circuit) => circuit.deviceIds.includes(selectedId))?.id || null;
    ctx.save();
    const fade = systemAlpha("electrical");
    const avoid = [];
    design.circuits.forEach((circuit, index) => {
      const color = CIRCUIT_COLORS[index % CIRCUIT_COLORS.length];
      const active = circuit.id === activeId;
      ctx.strokeStyle = color;
      ctx.globalAlpha = fade * (active ? 1 : 0.9);
      ctx.lineWidth = active ? 4 : 2.25;
      ctx.beginPath();
      let started = false;
      for (const segment of circuit.segments) {
        for (const point of segment.points) {
          const screen = worldToScreen(point.x, point.y);
          if (!started) {
            ctx.moveTo(screen.x, screen.y);
            started = true;
          } else ctx.lineTo(screen.x, screen.y);
        }
      }
      ctx.stroke();
      if (active) drawCircuitLabel(circuit, color, avoid);
    });
    for (const device of design.devices) drawDeviceMark(device, false);
    for (const device of house.electrical.devices || []) {
      if (!device.ghost || !isPhaseVisible(device.phase, state)) continue;
      drawDeviceMark(device, true);
    }
    if (design.panel && isPhaseVisible(design.panel.phase || "phase1", state)) {
      const at = panelPoint(house);
      if (at) {
        const screen = worldToScreen(at.x, at.y);
        const selected = overlay?.selection?.type === "panel";
        ctx.globalAlpha = systemAlpha("electrical");
        ctx.fillStyle = "#1d1a16";
        ctx.fillRect(screen.x - 8, screen.y - 10, selected ? 18 : 16, selected ? 22 : 20);
        ctx.fillStyle = "#F7F3EB";
        ctx.font = "700 10px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("P", screen.x, screen.y);
      }
    }
    ctx.restore();
  }

  function drawDeviceMark(device, ghost) {
    if (!ghost && state?.issuesOnly && !(state.issueDeviceIds || []).includes(device.id) && overlay?.selection?.id !== device.id) return;
    const at = devicePoint(house, device);
    const screen = worldToScreen(at.x, at.y);
    const selected = overlay?.selection?.type === "device" && overlay.selection.id === device.id;
    const focus = overlay?.suggestFocus;
    const preview = !!(ghost && focus && device.roomId === focus);
    const dim = !!(ghost && focus && device.roomId !== focus);
    ctx.beginPath();
    ctx.globalAlpha = (ghost ? (dim ? 0.18 : 0.95) : 1) * systemAlpha("electrical");
    ctx.fillStyle = "#F7F3EB";
    ctx.strokeStyle = preview ? "#2F5D45" : device.volts === 240 ? "#8A5A12" : "#1F6F8B";
    ctx.lineWidth = selected || preview ? 3 : 1.5;
    ctx.setLineDash(ghost ? [3, 3] : []);
    ctx.arc(screen.x, screen.y, selected ? 9 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#1d1a16";
    ctx.font = "700 8px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const letter = device.kind === "gfci" || device.kind === "wr-receptacle"
      ? "G"
      : device.volts === 240
        ? "240"
        : device.kind.startsWith("switch")
          ? "S"
          : device.kind === "light" || device.kind === "wall-light"
            ? "L"
            : device.kind === "fan"
              ? "F"
              : device.kind === "smoke"
                ? "A"
                : "R";
    ctx.fillText(letter, screen.x, screen.y);
    if (ghost && !dim) {
      ctx.font = "700 12px Outfit, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(plainPlaceLabel(device.kind) || device.name || "Outlet", screen.x + 14, screen.y - 14);
    }
  }

  function drawMarkers() {
    badgeHits = [];
    if (!markers.length || (camera.pxPerFt || 0) < 12) {
      badgeNote = null;
      canvas.dataset.badges = "[]";
      return;
    }
    const zoomedOut = false;
    const buckets = new Map();
    for (const marker of markers) {
      if (!marker.point) continue;
      const screen = worldToScreen(marker.point.x, marker.point.y);
      const key = zoomedOut ? `${Math.round(screen.x / 36)}:${Math.round((screen.y - 18) / 36)}` : `${marker.point.x.toFixed(1)},${marker.point.y.toFixed(1)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ marker, screen });
    }
    ctx.save();
    ctx.font = "700 11px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const group of buckets.values()) {
      const lead = group.find((item) => item.marker.active) || group[0];
      const screen = lead.screen;
      const x = screen.x;
      const y = screen.y - 22;
      const color = group.some((item) => item.marker.severity === "blocker")
        ? "#9C341F"
        : group.every((item) => item.marker.severity === "tip")
          ? "#2F5D45"
          : "#C4654A";
      const radius = lead.marker.active ? 10 : 8;
      const titles = [...new Set(group.map((item) => item.marker.title).filter(Boolean))];
      badgeHits.push({ x, y, r: radius + 6, text: titles.join(" · ") || "Open the room card for this issue." });
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.strokeStyle = "#F7F3EB";
      ctx.lineWidth = 2;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#F7F3EB";
      ctx.fillText(group.length > 1 ? String(group.length) : "!", x, y + 0.5);
    }
    ctx.restore();
    canvas.dataset.badges = JSON.stringify(badgeHits.map((hit) => ({ x: hit.x, y: hit.y, text: hit.text })));
    drawBadgeNote();
  }

  function drawBadgeNote() {
    if (!badgeNote?.text) return;
    const { w } = size();
    ctx.save();
    ctx.font = "700 13px Outfit, sans-serif";
    const pad = 10;
    const max = Math.min(520, w - 16);
    const textWidth = Math.min(ctx.measureText(badgeNote.text).width, max - pad * 2);
    const width = textWidth + pad * 2;
    const x = Math.min(Math.max(8, badgeNote.x - width / 2), w - width - 8);
    const y = Math.max(8, badgeNote.y - 46);
    ctx.fillStyle = "#2A241B";
    ctx.beginPath();
    ctx.roundRect(x, y, width, 28, 14);
    ctx.fill();
    ctx.fillStyle = "#F6F1E8";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeNote.text, x + pad, y + 14, max - pad * 2);
    ctx.restore();
  }

  function drawWorldArc(cx, cy, radius, fromDeg, toDeg, anticlockwise) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, (-fromDeg * Math.PI) / 180, (-toDeg * Math.PI) / 180, anticlockwise);
  }

  function drawAngleMark(mark) {
    if (!mark?.arc || !(mark.length > 0.2)) return;
    const origin = worldToScreen(mark.arc.x, mark.arc.y);
    const radius = 22;
    const sweep = ((mark.arc.to % 360) + 360) % 360;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#2F5D45";
    ctx.fillStyle = "rgba(47, 93, 69, 0.16)";
    ctx.beginPath();
    ctx.moveTo(origin.x + 6, origin.y);
    ctx.lineTo(origin.x + radius + 8, origin.y);
    ctx.stroke();
    ctx.font = "700 11px Outfit, sans-serif";
    ctx.fillStyle = "#2F5D45";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("east", origin.x + radius + 10, origin.y - 8);
    if (sweep > 0.5) {
      if (sweep <= 180) {
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.arc(origin.x, origin.y, radius, 0, (-sweep * Math.PI) / 180, true);
        ctx.closePath();
        ctx.fill();
      }
      drawWorldArc(origin.x, origin.y, radius, 0, sweep, true);
      ctx.stroke();
    }
    if (mark.join && mark.join.degrees > 0.5) {
      const joint = worldToScreen(mark.join.x, mark.join.y);
      let turn = ((mark.join.to - mark.join.from + 540) % 360) - 180;
      ctx.strokeStyle = "#9C5B2A";
      ctx.fillStyle = "rgba(156, 91, 42, 0.18)";
      ctx.beginPath();
      ctx.moveTo(joint.x, joint.y);
      ctx.arc(
        joint.x,
        joint.y,
        radius + 8,
        (-mark.join.from * Math.PI) / 180,
        (-mark.join.to * Math.PI) / 180,
        turn > 0,
      );
      ctx.closePath();
      ctx.fill();
      drawWorldArc(joint.x, joint.y, radius + 8, mark.join.from, mark.join.to, turn > 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMeasurePill(text, screenX, screenY) {
    ctx.save();
    ctx.font = "700 13px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const padX = 8;
    const textW = ctx.measureText(text).width;
    const pillW = Math.min(textW + padX * 2, Math.max(80, canvas.clientWidth - 16));
    const pillH = 26;
    let pillX = screenX - pillW / 2;
    let pillY = screenY - 18 - pillH;
    if (pillX < 8) pillX = 8;
    if (pillX + pillW > canvas.clientWidth - 8) pillX = Math.max(8, canvas.clientWidth - pillW - 8);
    if (pillY < 8) pillY = screenY + 14;
    ctx.fillStyle = "rgba(247, 243, 235, 0.97)";
    ctx.strokeStyle = "#2F5D45";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1d3d2e";
    ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2, pillW - padX * 2);
    ctx.restore();
    measureLabelHit = { x: pillX, y: pillY, w: pillW, h: pillH };
  }

  function drawOverlay() {
    if (!overlay) return;
    drawAngleMark(overlay.measure);
    if (overlay.moveLabel) {
      const screen = worldToScreen(overlay.moveLabel.x, overlay.moveLabel.y);
      drawMeasurePill(overlay.moveLabel.text, screen.x, screen.y);
    }
    const warnedWalls = overlay.warningWalls || [];
    const warnedOpenings = overlay.warningOpenings || [];
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#C44536";
    for (const id of warnedWalls) {
      const wall = house.walls.find((item) => item.id === id);
      if (!wall) continue;
      trace(segmentQuad(wall.start.x, wall.start.y, wall.end.x, wall.end.y, wall.thickness + 0.15));
      ctx.stroke();
    }
    for (const id of warnedOpenings) {
      const opening = house.openings.find((item) => item.id === id);
      const wall = opening && house.walls.find((item) => item.id === opening.wallId);
      if (!wall) continue;
      const a = pointAlong(wall, opening.offset);
      const b = pointAlong(wall, opening.offset + opening.width);
      trace(segmentQuad(a.x, a.y, b.x, b.y, wall.thickness + 0.35));
      ctx.stroke();
    }
    ctx.restore();
    if (overlay.draft) {
      const { start, end, color } = overlay.draft;
      ctx.save();
      ctx.strokeStyle = color || "#2F5D45";
      ctx.lineWidth = 4;
      ctx.setLineDash([7, 5]);
      const a = worldToScreen(start.x, start.y);
      const b = worldToScreen(end.x, end.y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      const fontPx = Math.max(12, Math.min(15, camera.pxPerFt * 0.9));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const span = Math.hypot(dx, dy) || 1;
      let nx = -dy / span;
      let ny = dx / span;
      if (ny > 0) { nx *= -1; ny *= -1; }
      const boxes = [];
      const drawPill = (text, anchorX, anchorY) => {
        ctx.save();
        ctx.font = `600 ${fontPx}px Outfit, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const padX = 8;
        const textW = ctx.measureText(text).width;
        const pillW = textW + padX * 2;
        const pillH = fontPx + 10;
        let pillX = anchorX + nx * 16 - pillW / 2;
        let pillY = anchorY + ny * (pillH + 14) - pillH / 2;
        if (pillY < 8) pillY = anchorY - ny * (pillH + 14) - pillH / 2;
        if (pillX < 8) pillX = 8;
        if (pillX + pillW > canvas.clientWidth - 8) pillX = Math.max(8, canvas.clientWidth - pillW - 8);
        if (pillY + pillH > canvas.clientHeight - 8) pillY = Math.max(8, anchorY - pillH - 10);
        const box = { pillX, pillY, pillW, pillH };
        const hit = boxes.some((other) => (
          box.pillX < other.pillX + other.pillW + 10
          && box.pillX + box.pillW + 10 > other.pillX
          && box.pillY < other.pillY + other.pillH + 8
          && box.pillY + box.pillH + 8 > other.pillY
        ));
        if (hit) { ctx.restore(); return null; }
        boxes.push(box);
        ctx.beginPath();
        ctx.arc(anchorX, anchorY, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#2F5D45";
        ctx.fill();
        ctx.fillStyle = "rgba(247, 243, 235, 0.97)";
        ctx.strokeStyle = "#2F5D45";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#1d3d2e";
        ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2);
        ctx.restore();
        return box;
      };
      const readable = pickReadableTicks(
        overlay.draft.ticks || [],
        end.length || 0,
        (tick) => worldToScreen(tick.x, tick.y),
        110,
        3,
      );
      if (overlay.draft.lengthLabel) {
        const box = drawPill(overlay.draft.lengthLabel, b.x, b.y);
        if (box) measureLabelHit = { x: box.pillX, y: box.pillY, w: box.pillW, h: box.pillH };
      }
      for (const tick of readable) drawPill(tick.label, tick.pos.x, tick.pos.y);
    }
    const drawBox = (rect, fill) => {
      if (!rect) return;
      const a = worldToScreen(rect.x0, rect.y0);
      const b = worldToScreen(rect.x1, rect.y1);
      ctx.save();
      ctx.strokeStyle = "#2F5D45";
      ctx.fillStyle = fill;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    };
    drawBox(overlay.rect, "rgba(47, 93, 69, 0.12)");
    if (overlay.rect?.label) {
      // Live size (and the chosen shape) beside the corner you are dragging.
      const corner = worldToScreen(overlay.rect.x1, overlay.rect.y1);
      ctx.save();
      ctx.font = "600 13px Outfit, sans-serif";
      ctx.textBaseline = "middle";
      const text = overlay.rect.label;
      const w = ctx.measureText(text).width + 16;
      const h = 24;
      let x = corner.x + 12;
      let y = corner.y + 12;
      if (x + w > canvas.clientWidth - 8) x = corner.x - w - 12;
      if (y + h > canvas.clientHeight - 8) y = corner.y - h - 12;
      ctx.fillStyle = "rgba(247, 243, 235, 0.97)";
      ctx.strokeStyle = "#2F5D45";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 12) : ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#2F5D45";
      ctx.fillText(text, x + 8, y + h / 2 + 0.5);
      ctx.restore();
    }
    drawBox(overlay.marquee, "rgba(47, 93, 69, 0.2)");
    drawFrame(overlay.frame);
    const marks = overlay.picks?.length ? overlay.picks : (overlay.selection ? [overlay.selection] : []);
    const strokePick = () => {
      ctx.save();
      ctx.strokeStyle = "#2F5D45";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    };
    const ringAt = (x, y, radius = 16) => {
      const spot = worldToScreen(x, y);
      ctx.save();
      ctx.strokeStyle = "#2F5D45";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    for (const pick of marks) {
      if (pick.type === "wall") {
        const wall = house.walls.find((item) => item.id === pick.id);
        if (!wall) continue;
        trace(segmentQuad(wall.start.x, wall.start.y, wall.end.x, wall.end.y, wall.thickness + 0.2));
        strokePick();
        if (marks.length === 1) {
          ctx.save();
          ctx.strokeStyle = "#2F5D45";
          ctx.lineWidth = 2.5;
          // Clipped ends are solid green. Ends that only lie on another wall are clay rings.
          for (const endName of ["start", "end"]) {
            const point = wall[endName];
            const s = worldToScreen(point.x, point.y);
            const clipped = isClipped(house, wall.id, endName);
            const touching = !clipped && endsAt(house, point, { exclude: [wall.id] }).length > 0;
            ctx.beginPath();
            ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = clipped ? "#2F5D45" : "#F7F3EB";
            ctx.strokeStyle = touching ? "#C4654A" : "#2F5D45";
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }
      } else if (pick.type === "room") {
        const room = house.rooms.find((item) => item.id === pick.id);
        if (!room) continue;
        trace(room.polygon);
        strokePick();
      } else if (pick.type === "opening") {
        const opening = (house.openings || []).find((item) => item.id === pick.id);
        const wall = opening && house.walls.find((item) => item.id === opening.wallId);
        if (!opening || !wall) continue;
        const a = pointAlong(wall, opening.offset || 0);
        const b = pointAlong(wall, (opening.offset || 0) + (opening.width || 0));
        trace(segmentQuad(a.x, a.y, b.x, b.y, (wall.thickness || 0.5) + 0.35));
        strokePick();
      } else if (pick.type === "skylight") {
        const item = (house.skylights || []).find((entry) => entry.id === pick.id);
        if (!item) continue;
        trace(skylightFootprint(item, house, !!state && isFutureShown(state)));
        strokePick();
      } else if (pick.type === "image") {
        const item = (house.images || []).find((entry) => entry.id === pick.id);
        if (!item) continue;
        trace(imageCorners(item));
        strokePick();
      } else if (pick.type === "furniture") {
        const item = (house.furniture || []).find((entry) => entry.id === pick.id);
        if (!item) continue;
        trace(furnitureFootprint(item));
        strokePick();
      } else if (pick.type === "drainfield" || pick.type === "reserve") {
        const field = house.site?.septic?.[pick.type];
        if (!field) continue;
        trace([
          { x: field.x, y: field.y },
          { x: field.x + field.width, y: field.y },
          { x: field.x + field.width, y: field.y + field.depth },
          { x: field.x, y: field.y + field.depth },
        ]);
        strokePick();
      } else {
        const spot = pickSpot(house, pick);
        if (spot) ringAt(spot.x, spot.y);
      }
    }
    drawTemplateGhost(overlay.templateGhost);
    if (overlay.furnishGhost) drawFurnishing(overlay.furnishGhost, true);
    if (overlay.placeGhost) drawPlaceGhost(overlay.placeGhost, false);
    for (const ghost of overlay.siteGhosts || []) drawPlaceGhost(ghost, true);
    for (const ghost of overlay.suggestMarks || []) drawPlaceGhost(ghost, true);
    if (overlay.ghostOpening) {
      const ghost = overlay.ghostOpening;
      const wall = house.walls.find((item) => item.id === ghost.wallId);
      if (wall) {
        const a = pointAlong(wall, ghost.offset);
        const b = pointAlong(wall, ghost.offset + ghost.width);
        trace(segmentQuad(a.x, a.y, b.x, b.y, wall.thickness + 0.2));
        ctx.save();
        ctx.fillStyle = ghost.ok ? "rgba(47, 93, 69, 0.35)" : "rgba(196, 69, 54, 0.4)";
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawPlaceGhost(ghost, suggested) {
    const screen = worldToScreen(ghost.x, ghost.y);
    const focus = overlay?.suggestFocus;
    const dim = !!(suggested && focus && !(focus === "panel" && ghost.kind === "panel"));
    const preview = !!(suggested && focus === "panel" && ghost.kind === "panel");
    ctx.save();
    if (dim) ctx.globalAlpha = 0.2;
    const bad = ghost.ok === false;
    ctx.strokeStyle = bad ? "#9C341F" : suggested ? "#2F5D45" : "#1F6F8B";
    ctx.fillStyle = bad ? "rgba(156, 52, 31, 0.18)" : suggested ? "rgba(47, 93, 69, 0.16)" : "rgba(31, 111, 139, 0.22)";
    ctx.lineWidth = preview ? 3 : 2;
    ctx.setLineDash([5, 4]);
    if (ghost.width && ghost.depth) {
      const w = ghost.width * camera.pxPerFt;
      const h = ghost.depth * camera.pxPerFt;
      ctx.fillRect(screen.x - w / 2, screen.y - h / 2, w, h);
      ctx.strokeRect(screen.x - w / 2, screen.y - h / 2, w, h);
    } else {
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (ghost.kind === "well") {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, SETBACKS.well.drainfieldFt * (camera.pxPerFt || 8), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.moveTo(screen.x - 18, screen.y);
    ctx.lineTo(screen.x + 18, screen.y);
    ctx.moveTo(screen.x, screen.y - 18);
    ctx.lineTo(screen.x, screen.y + 18);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "700 12px Outfit, sans-serif";
    ctx.fillStyle = bad ? "#9C341F" : "#1d3d2e";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(ghost.label || "", screen.x + 16, screen.y - 16);
    if (ghost.kind === "well") {
      ctx.font = "600 11px Outfit, sans-serif";
      ctx.fillStyle = "#1F6F8B";
      ctx.fillText("100 ft to drain field", screen.x + 14, screen.y - SETBACKS.well.drainfieldFt * (camera.pxPerFt || 8));
    }
    if (ghost.reason) ctx.fillText(ghost.reason, screen.x + 16, screen.y + 2);
    ctx.restore();
  }

  function drawingScreenBox(dims) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const dim of dims) {
      for (const point of [
        [dim.x0, dim.y0],
        [dim.x1, dim.y1],
      ]) {
        const screen = worldToScreen(point[0], point[1]);
        x0 = Math.min(x0, screen.x);
        y0 = Math.min(y0, screen.y);
        x1 = Math.max(x1, screen.x);
        y1 = Math.max(y1, screen.y);
      }
    }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function dimensionNote(dim, detail) {
    const parts = [];
    if (dim.face === "inside" || dim.face === "outside" || dim.face === "house" || dim.face === "site") parts.push(dim.face);
    if (dim.caption) {
      const caption = footprintCaption();
      if (caption) parts.push(caption);
    } else if (detail.fudged) parts.push(`exact ${detail.exact}`);
    return parts.join(" · ");
  }

  function footprintCaption() {
    const constraint = (house.constraints || []).find((item) => String(item.targetId).startsWith("footprint:"));
    const readout = constraint && constraintReadout(house, constraint, house.customRatios || []);
    if (!readout) return "";
    if (readout.exact) return `${readout.badge} · exact`;
    const percent = readout.deviation * 100;
    const sign = percent > 0 ? "+" : "−";
    return `${readout.badge} · ${sign}${Math.abs(percent).toFixed(2)}%`;
  }

  function drawConstraintBadges() {
    const caption = footprintCaption();
    const captionOnDimension = !!state?.layers.dimensions
      && planDimensions(house, isFutureShown(state)).some((dim) => dim.caption);
    if (caption && !captionOnDimension) {
      const point = worldToScreen(house.footprint.width / 2, -10.5);
      ctx.save();
      ctx.font = "700 12px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const width = ctx.measureText(caption).width + 16;
      let box = { x: point.x - width / 2, y: point.y - 11, w: width, h: 22 };
      let guard = 0;
      while (labelBoxes.some((item) => rectsOverlap(item, box)) && guard < 6) {
        box = { ...box, y: box.y + 16 };
        guard += 1;
      }
      labelBoxes.push(box);
      ctx.fillStyle = "rgba(47, 93, 69, 0.12)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = "#2F5D45";
      ctx.fillText(caption, box.x + width / 2, box.y + 11);
      ctx.restore();
    }
    for (const constraint of house.constraints || []) {
      if (String(constraint.targetId).startsWith("footprint:")) continue;
      const target = house.walls.find((wall) => wall.id === constraint.targetId);
      const reference = house.walls.find((wall) => wall.id === constraint.referenceId);
      const readout = constraintReadout(house, constraint, house.customRatios || []);
      if (!target || !readout) continue;
      const mid = worldToScreen((target.start.x + target.end.x) / 2, (target.start.y + target.end.y) / 2);
      if (reference) {
        const other = worldToScreen((reference.start.x + reference.end.x) / 2, (reference.start.y + reference.end.y) / 2);
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = "rgba(47, 93, 69, 0.7)";
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(other.x, other.y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.font = "700 11px Outfit, sans-serif";
      ctx.fillStyle = "#2F5D45";
      ctx.textAlign = "left";
      ctx.fillText(readout.badge, mid.x + 8, mid.y - 8);
      ctx.restore();
    }
  }

  function drawGuides() {
    const guides = overlay?.guides || [];
    if (!guides.length) return;
    ctx.save();
    ctx.strokeStyle = "#2F5D45";
    ctx.fillStyle = "#2F5D45";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    for (const guide of guides) {
      const a = worldToScreen(guide.x0, guide.y0);
      const b = worldToScreen(guide.x1, guide.y1);
      const left = Math.min(a.x, b.x);
      const top = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      ctx.strokeRect(left, top, width, height);
      const short = Math.min(width, height);
      if (width >= height) ctx.strokeRect(left, top, short, height);
      else ctx.strokeRect(left, top, width, short);
      ctx.setLineDash([]);
      ctx.font = "600 12px Outfit, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(guide.label, left + 6, top + 16);
      ctx.setLineDash([5, 4]);
    }
    ctx.restore();
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function worldFromEvent(event) {
    const local = localPoint(event);
    return screenToWorld(local.x, local.y);
  }

  function badgeAt(local) {
    return badgeHits.find((hit) => Math.hypot(hit.x - local.x, hit.y - local.y) <= hit.r) || null;
  }

  function showBadge(local, pin) {
    const hit = local ? badgeAt(local) : null;
    if (pin) pinnedBadge = hit;
    const next = hit || (pin ? null : pinnedBadge);
    const text = next?.text || "";
    if (text === (badgeNote?.text || "") && (!next || (badgeNote && next.x === badgeNote.x && next.y === badgeNote.y))) return;
    badgeNote = next;
    render();
  }

  function hitMeasureLabel(local) {
    const box = measureLabelHit;
    if (!box) return false;
    return local.x >= box.x - 4 && local.x <= box.x + box.w + 4 && local.y >= box.y - 4 && local.y <= box.y + box.h + 4;
  }

  // Drag the sun marker around the ring to set where the sun comes from.
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !sunHit(localPoint(event))) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    sunDrag = event.pointerId;
    canvas.style.cursor = "grabbing";
  }, { capture: true });
  canvas.addEventListener("pointermove", (event) => {
    if (sunDrag == null) {
      if (sun && !event.buttons && sunHit(localPoint(event))) canvas.style.cursor = "grab";
      return;
    }
    if (event.pointerId !== sunDrag) return;
    event.stopImmediatePropagation();
    const ring = sunRing();
    if (!ring) return;
    const local = localPoint(event);
    let azimuth = (Math.atan2(local.x - ring.center.x, -(local.y - ring.center.y)) * 180) / Math.PI;
    if (azimuth < 0) azimuth += 360;
    onSunDrag(Math.round(azimuth));
  }, { capture: true });
  const endSunDrag = (event) => {
    if (sunDrag == null || event.pointerId !== sunDrag) return;
    event.stopImmediatePropagation();
    sunDrag = null;
    canvas.style.cursor = canvas.dataset.cursor || "";
  };
  canvas.addEventListener("pointerup", endSunDrag, { capture: true });
  canvas.addEventListener("pointercancel", endSunDrag, { capture: true });

  // Drag the "You" marker to stand somewhere else in the walk-through.
  // Capture first so a drag on the marker never pans or edits the plan.
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !walkerHit(localPoint(event))) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    walkerDrag = event.pointerId;
    canvas.style.cursor = "grabbing";
  }, { capture: true });
  canvas.addEventListener("pointermove", (event) => {
    if (walkerDrag == null) {
      if (walker && !event.buttons) canvas.style.cursor = walkerHit(localPoint(event)) ? "grab" : (canvas.dataset.cursor || "");
      return;
    }
    if (event.pointerId !== walkerDrag) return;
    event.stopImmediatePropagation();
    const local = localPoint(event);
    const world = screenToWorld(local.x, local.y);
    walker = { ...walker, x: world.x, y: world.y };
    onWalkerMove({ x: world.x, y: world.y });
    requestRender();
  }, { capture: true });
  const endWalkerDrag = (event) => {
    if (walkerDrag == null || event.pointerId !== walkerDrag) return;
    event.stopImmediatePropagation();
    walkerDrag = null;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endWalkerDrag, { capture: true });
  canvas.addEventListener("pointercancel", endWalkerDrag, { capture: true });

  // The length label sits on the wall. A click on it opens the type-in box;
  // a drag that starts on it drags the wall like anywhere else.
  let labelPress = null;
  canvas.addEventListener("pointermove", (event) => {
    if (!labelPress || event.pointerId !== labelPress.event.pointerId) return;
    if (Math.hypot(event.clientX - labelPress.event.clientX, event.clientY - labelPress.event.clientY) < 4) return;
    const start = labelPress.event;
    labelPress = null;
    pointers.set(start.pointerId, { x: start.clientX, y: start.clientY });
    if (buildHooks?.down?.(start, worldFromEvent(start))) {
      buildGesture = true;
      drag = null;
      pinch = null;
    } else {
      drag = { x: start.clientX, y: start.clientY, cx: camera.cx, cy: camera.cy };
    }
  }, { capture: true });
  canvas.addEventListener("pointerup", (event) => {
    if (!labelPress || event.pointerId !== labelPress.event.pointerId) return;
    const start = labelPress.event;
    labelPress = null;
    event.stopImmediatePropagation();
    buildHooks?.label?.(start);
  }, { capture: true });

  canvas.addEventListener("pointerdown", (event) => {
    const local = localPoint(event);
    // The floating length label no longer catches clicks: it sat over other
    // walls and swallowed clicks meant for them. Type a length on the wall card,
    // or press Tab while drawing.
    const badge = badgeAt(local);
    if (badge) {
      pinnedBadge = badge;
      badgeNote = badge;
      render();
      return;
    }
    if (pinnedBadge || badgeNote) {
      pinnedBadge = null;
      badgeNote = null;
      render();
    }
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) {
      if (buildGesture) buildHooks?.cancel?.();
      buildGesture = false;
      drag = null;
      return;
    }
    if (buildHooks?.down?.(event, worldFromEvent(event))) {
      buildGesture = true;
      drag = null;
      pinch = null;
      return;
    }
    drag = { x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy };
    pinch = null;
  });

  function pipeFromPoint(design, point) {
    let best = null;
    const consider = (id, points) => {
      for (let i = 1; i < points.length; i += 1) {
        const distance = distanceToSegment(point, points[i - 1], points[i]);
        if (distance > 1.4) continue;
        if (!best || distance < best.distance) best = { id, distance };
      }
    };
    for (const runItem of design.supply) consider(`${runItem.service}:${runItem.fixtureId}`, runItem.points);
    for (const leg of design.dwv) consider(`drain:${leg.fixtureId}`, leg.points);
    if (design.building?.points) consider("building", design.building.points);
    for (const fixture of design.fixtures) {
      const distance = Math.hypot(fixture.x - point.x, fixture.y - point.y);
      if (distance <= 1.4 && (!best || distance < best.distance)) best = { id: `fixture:${fixture.id}`, distance };
    }
    return best;
  }

  canvas.addEventListener("pointerleave", (event) => {
    if (!pinnedBadge) showBadge(null, false);
    buildHooks?.hover?.(event, null);
    if (!hoverCircuitId && !hoverPipeId) return;
    hoverCircuitId = null;
    hoverPipeId = null;
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) {
      showBadge(localPoint(event), false);
      const world = worldFromEvent(event);
      buildHooks?.hover?.(event, world);
      let nextCircuit = null;
      let circuitDistance = Infinity;
      if (state?.layers.electrical && house.electrical) {
        const design = cachedElectrical();
        const hit = circuitFromPoint(design, world);
        if (hit) {
          nextCircuit = hit.circuit.id;
          circuitDistance = hit.distance;
        }
      }
      let nextPipe = null;
      let pipeDistance = Infinity;
      if (state?.layers.plumbing && house.plumbing) {
        const design = cachedPlumbing();
        const hit = pipeFromPoint(design, world);
        if (hit) {
          nextPipe = hit.id;
          pipeDistance = hit.distance;
        }
      }
      if (circuitDistance <= pipeDistance) nextPipe = null;
      else nextCircuit = null;
      if (nextCircuit !== hoverCircuitId || nextPipe !== hoverPipeId) {
        hoverCircuitId = nextCircuit;
        hoverPipeId = nextPipe;
        render();
      }
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...pointers.values()];
    if (pts.length === 1 && buildGesture) {
      buildHooks?.move?.(event, worldFromEvent(event));
      return;
    }
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const rect = canvas.getBoundingClientRect();
      const mid = { x: midClient.x - rect.left, y: midClient.y - rect.top };
      if (!pinch) {
        pinch = { dist, camera: { ...camera }, world: screenToWorld(mid.x, mid.y) };
      } else {
        camera.pxPerFt = Math.min(90, Math.max(2, pinch.camera.pxPerFt * (dist / pinch.dist)));
        camera.cx = pinch.world.x - (mid.x - size().w / 2) / camera.pxPerFt;
        camera.cy = pinch.world.y + (mid.y - size().h / 2) / camera.pxPerFt;
        requestRender();
      }
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    camera.cx = drag.cx - dx / camera.pxPerFt;
    camera.cy = drag.cy + dy / camera.pxPerFt;
    requestRender();
  });

  function endPointer(event) {
    if (buildGesture && pointers.size <= 1) {
      buildHooks?.up?.(event, worldFromEvent(event));
      buildGesture = false;
    }
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      drag = null;
      pinch = null;
      onChange({ ...camera });
    } else if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      drag = { x: remaining.x, y: remaining.y, cx: camera.cx, cy: camera.cy };
      pinch = null;
    }
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const line = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
      const dx = event.deltaX * line;
      const dy = event.deltaY * line;
      const notch = !event.ctrlKey && event.deltaMode === 0 && Math.abs(event.deltaY) >= 50 && Math.abs(event.deltaX) < 1;
      if (event.ctrlKey || notch) {
        const cursor = localPoint(event);
        const before = screenToWorld(cursor.x, cursor.y);
        const gain = event.ctrlKey ? 0.007 : 0.0011;
        camera.pxPerFt = Math.min(90, Math.max(2, camera.pxPerFt * Math.exp(-dy * gain)));
        const after = screenToWorld(cursor.x, cursor.y);
        camera.cx += before.x - after.x;
        camera.cy += before.y - after.y;
      } else {
        camera.cx += dx / camera.pxPerFt;
        camera.cy -= dy / camera.pxPerFt;
      }
      requestRender();
      scheduleCameraSave();
    },
    { passive: false },
  );

  canvas.addEventListener("dblclick", (event) => {
    event.preventDefault();
    fit(true);
  });

  return {
    setState(next) {
      state = next;
      applyCameraFromState();
      render();
    },
    resize() {
      layoutCanvas();
      if (!cameraReady && canvas.clientWidth > 20) {
        if (state?.plan) {
          camera = { ...state.plan };
          cameraReady = true;
        } else {
          fit(true);
          return;
        }
      }
      render();
    },
    fit() {
      fit(true);
    },
    /** The sun for the Sun and shade layer (from currentSun), or null when it is off. */
    setSun(next) {
      sun = next || null;
      requestRender();
    },
    /** Draw the roof edge (eaves) dashed, for the passive solar tool. */
    setRoofEdges(on) {
      showRoofEdges = !!on;
      requestRender();
    },
    setOnSunDrag(fn) {
      onSunDrag = typeof fn === "function" ? fn : () => {};
    },
    /** Show where you stand in the walk-through, or null to hide it. */
    setWalker(pose) {
      if (walkerDrag != null && pose) return;
      walker = pose ? { x: pose.x, y: pose.y, yaw: pose.yaw || 0 } : null;
      requestRender();
    },
    setOnWalkerMove(fn) {
      onWalkerMove = typeof fn === "function" ? fn : () => {};
    },
    /** Pixels on the left that a floating panel covers. Only Fit reads it, so the view never jumps. */
    setInsets({ left = 0 } = {}) {
      insetLeft = Math.max(0, Number(left) || 0);
    },
    focus(x, y) {
      camera.cx = x;
      camera.cy = y;
      camera.pxPerFt = Math.max(camera.pxPerFt || 12, 16);
      cameraReady = true;
      render();
      onChange({ ...camera });
    },
    setMarkers(next) {
      markers = Array.isArray(next) ? next : [];
      render();
    },
    redraw() {
      render();
    },
    setOnChange(fn) {
      onChange = fn;
    },
    setHouse(next, options) {
      house = next;
      if (!options?.silent) render();
    },
    setBayGrid(feet) {
      bayGrid = Number(feet) || 0;
      render();
    },
    setOverlay(next, options) {
      overlay = next;
      if (!options?.silent) render();
    },
    setBuildHooks(hooks) {
      buildHooks = hooks;
    },
    setCursor(cursor) {
      canvas.dataset.cursor = cursor || "";
      canvas.style.cursor = cursor || "";
    },
    getCamera() {
      return { ...camera };
    },
    measureLabelBox() {
      if (!measureLabelHit) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        left: rect.left + measureLabelHit.x,
        top: rect.top + measureLabelHit.y,
        width: measureLabelHit.w,
        height: measureLabelHit.h,
      };
    },
    clientToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return screenToWorld(clientX - rect.left, clientY - rect.top);
    },
    beginPan(event) {
      buildGesture = false;
      drag = { x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy };
    },
  };
}
