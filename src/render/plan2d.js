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
import { furnitureFootprint, roomGroundLine } from "../build/annotations.js";
import { areaKind } from "../build/areas.js";
import { CIRCUIT_COLORS, buildElectrical, devicePoint, panelPoint } from "../electrical/design.js";
import { plainPlaceLabel } from "../electrical/design.js";
import { buildPlumbing } from "../plumbing/design.js";
import { buildSite, SETBACKS } from "../site/design.js";

function pickSpot(house, pick) {
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
  let markers = [];
  let badgeHits = [];
  let badgeNote = null;
  let pinnedBadge = null;
  let buildHooks = null;
  let buildGesture = false;
  let onChange = () => {};
  let camera = { cx: 38, cy: 23.5, pxPerFt: 8 };
  let labelBoxes = [];
  let cameraReady = false;
  let openedFrame = false;
  let ratioFontReady = false;
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let hoverCircuitId = null;
  let hoverPipeId = null;

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
    const siteView = siteMode && state?.layers?.site !== false ? buildSite(house) : null;
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
    camera.cx = (bounds.x0 + bounds.x1) / 2;
    camera.cy = (bounds.y0 + bounds.y1) / 2;
    camera.pxPerFt = Math.max(
      2,
      Math.min((w - 48) / (bounds.x1 - bounds.x0), (h - 120) / (bounds.y1 - bounds.y0)),
    );
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
    if (camera.pxPerFt >= 9) strokeLines(1, "rgba(90, 70, 40, 0.07)", 5);
    strokeLines(5, "rgba(90, 70, 40, 0.18)", 0);
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
    const view = buildSite(house);
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

  function drawWall(wall) {
    const openings = openingsFor(house, wall);
    const pieces = wallPieces(wall, openings);
    const future = wall.phase === "future";
    const colors = ASSEMBLY_2D[wall.assembly] || ASSEMBLY_2D.framed;
    if (!colors || !wall?.start || !wall?.end) return;
    for (const piece of pieces) {
      if (piece.kind !== "solid") continue;
      const a = pointAlong(wall, piece.s0);
      const b = pointAlong(wall, piece.s1);
      const quad = segmentQuad(a.x, a.y, b.x, b.y, wall.thickness);
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
      trace(quad);
      ctx.save();
      ctx.globalAlpha = future ? 0.75 : 0.9;
      ctx.setLineDash(future ? [6, 4] : []);
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = future ? 1.25 : 1;
      ctx.stroke();
      ctx.restore();
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

  function drawAnnotations() {
    ctx.save();
    ctx.lineJoin = "round";
    for (const item of house.furniture || []) {
      if (!markVisible(item.roomId)) continue;
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

  function furnitureFill(kind) {
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    drawRooms();
    for (const wall of house.walls || []) {
      if (wallVisible(wall)) drawWall(wall);
    }
    for (const wall of house.walls || []) {
      if (!wallVisible(wall)) continue;
      for (const opening of openingsFor(house, wall)) drawOpening(wall, opening);
    }
    if (state?.layers.framing) {
      for (const wall of house.walls || []) {
        if (isPhaseVisible(wall.phase, state)) drawStuds(wall);
      }
    }
    drawElectrical();
    drawPlumbing();
    drawAnnotations();
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
    } catch (error) {
      console.error(error);
    }
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
    const design = buildPlumbing(house, { phase: electricalPhase() });
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
    const design = buildElectrical(house, { phase: electricalPhase() });
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

  function drawOverlay() {
    if (!overlay) return;
    if (overlay.moveLabel) {
      const screen = worldToScreen(overlay.moveLabel.x, overlay.moveLabel.y);
      ctx.save();
      ctx.font = "700 13px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#2A241B";
      ctx.fillText(overlay.moveLabel.text, screen.x, screen.y - 16);
      ctx.restore();
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
        if (pillX + pillW > canvas.width - 8) pillX = canvas.width - pillW - 8;
        if (pillY + pillH > canvas.height - 8) pillY = Math.max(8, anchorY - pillH - 10);
        const box = { pillX, pillY, pillW, pillH };
        const hit = boxes.some((other) => (
          box.pillX < other.pillX + other.pillW + 10
          && box.pillX + box.pillW + 10 > other.pillX
          && box.pillY < other.pillY + other.pillH + 8
          && box.pillY + box.pillH + 8 > other.pillY
        ));
        if (hit) { ctx.restore(); return false; }
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
        return true;
      };
      const readable = pickReadableTicks(
        overlay.draft.ticks || [],
        end.length || 0,
        (tick) => worldToScreen(tick.x, tick.y),
        110,
        3,
      );
      if (overlay.draft.lengthLabel) drawPill(overlay.draft.lengthLabel, b.x, b.y);
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
    drawBox(overlay.marquee, "rgba(47, 93, 69, 0.2)");
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
          for (const point of [wall.start, wall.end]) {
            const s = worldToScreen(point.x, point.y);
            ctx.beginPath();
            ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = "#F7F3EB";
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

  canvas.addEventListener("pointerdown", (event) => {
    const badge = badgeAt(localPoint(event));
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
        const design = buildElectrical(house, { phase: electricalPhase() });
        const hit = circuitFromPoint(design, world);
        if (hit) {
          nextCircuit = hit.circuit.id;
          circuitDistance = hit.distance;
        }
      }
      let nextPipe = null;
      let pipeDistance = Infinity;
      if (state?.layers.plumbing && house.plumbing) {
        const design = buildPlumbing(house, { phase: electricalPhase() });
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
        render();
      }
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    camera.cx = drag.cx - dx / camera.pxPerFt;
    camera.cy = drag.cy + dy / camera.pxPerFt;
    render();
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
      const cursor = localPoint(event);
      const before = screenToWorld(cursor.x, cursor.y);
      const factor = Math.exp(-event.deltaY * 0.0011);
      camera.pxPerFt = Math.min(90, Math.max(2, camera.pxPerFt * factor));
      const after = screenToWorld(cursor.x, cursor.y);
      camera.cx += before.x - after.x;
      camera.cy += before.y - after.y;
      render();
      onChange({ ...camera });
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
    setHouse(next) {
      house = next;
      render();
    },
    setOverlay(next) {
      overlay = next;
      render();
    },
    setBuildHooks(hooks) {
      buildHooks = hooks;
    },
    setCursor(cursor) {
      canvas.style.cursor = cursor || "";
    },
    getCamera() {
      return { ...camera };
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
