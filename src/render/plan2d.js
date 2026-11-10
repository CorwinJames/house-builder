import { ASSEMBLY_2D, FINISH_2D, INK, MUTED } from "../theme.js";
import { formatArea, formatFeet } from "../lib/format.js";
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

/**
 * 2D plan. North is up. Walls are drawn at their real thickness.
 */
export function createPlanView(canvas, house) {
  const ctx = canvas.getContext("2d");
  let state = null;
  let onChange = () => {};
  let camera = { cx: 38, cy: 23.5, pxPerFt: 8 };
  let cameraReady = false;
  const pointers = new Map();
  let drag = null;
  let pinch = null;

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

  function applyCameraFromState() {
    if (state?.plan) {
      camera = { ...state.plan };
      cameraReady = true;
    }
  }

  function fit(notify) {
    const { w, h } = size();
    if (w < 20 || h < 20) return;
    const future = state ? isFutureShown(state) : true;
    const bounds = future
      ? { x0: -12, y0: -8, x1: house.footprint.width + 6, y1: house.footprint.depth + 6 }
      : {
          x0: house.phases.phase1.bounds.x0 - 10,
          y0: house.phases.phase1.bounds.y0 - 8,
          x1: house.phases.phase1.bounds.x1 + 6,
          y1: house.phases.phase1.bounds.y1 + 6,
        };
    camera.cx = (bounds.x0 + bounds.x1) / 2;
    camera.cy = (bounds.y0 + bounds.y1) / 2;
    camera.pxPerFt = Math.max(
      2,
      Math.min((w - 28) / (bounds.x1 - bounds.x0), (h - 28) / (bounds.y1 - bounds.y0)),
    );
    cameraReady = true;
    if (notify) onChange({ ...camera });
    render();
  }

  function wallVisible(wall) {
    if (!state || !isPhaseVisible(wall.phase, state)) return false;
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
    const strokeLines = (step, style, skipMultiplesOf) => {
      ctx.beginPath();
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        if (skipMultiplesOf && x % skipMultiplesOf === 0) continue;
        const a = worldToScreen(x, y0);
        const b = worldToScreen(x, y1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
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

  function drawRooms() {
    if (!state?.layers.finishes) return;
    for (const room of house.rooms) {
      if (!isPhaseVisible(room.phase, state)) continue;
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
    const colors = ASSEMBLY_2D[wall.assembly];
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
      const sa = worldToScreen(a.x, a.y);
      const sb = worldToScreen(b.x, b.y);
      let ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const label = formatFeet(seg.len);
      ctx.save();
      ctx.translate(mid.x, mid.y);
      ctx.rotate(ang);
      const width = ctx.measureText(label).width + 10;
      ctx.fillStyle = "rgba(243, 235, 221, 0.92)";
      ctx.fillRect(-width / 2, -11, width, 16);
      ctx.fillStyle = INK;
      ctx.fillText(label, 0, -3);
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

  function drawLabels() {
    if (!state?.layers.labels) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const room of house.rooms) {
      if (!isPhaseVisible(room.phase, state)) continue;
      const xs = room.polygon.map((point) => point.x);
      const ys = room.polygon.map((point) => point.y);
      const boxW = (Math.max(...xs) - Math.min(...xs)) * camera.pxPerFt;
      const boxH = (Math.max(...ys) - Math.min(...ys)) * camera.pxPerFt;
      if (boxW < 52 || boxH < 36) continue;
      const at = room.labelAt || polygonCentroid(room.polygon);
      const s = worldToScreen(at.x, at.y);
      const future = room.phase === "future";
      const nameSize = Math.max(11, Math.min(18, camera.pxPerFt * 1.05));
      ctx.font = `600 ${nameSize}px Outfit, 'Segoe UI', sans-serif`;
      ctx.fillStyle = future ? "#6A5E52" : INK;
      const nameY = boxH < 78 ? s.y : s.y - nameSize * 0.55;
      ctx.fillText(room.name, s.x, nameY);
      if (boxW < 78 || boxH < 78) continue;
      ctx.font = `500 ${Math.max(10, nameSize - 3)}px Outfit, 'Segoe UI', sans-serif`;
      ctx.fillStyle = MUTED;
      ctx.fillText(`${formatArea(polygonArea(room.polygon))} sq ft`, s.x, s.y + nameSize * 0.55);
      if (future) {
        ctx.font = `500 ${Math.max(9, nameSize - 4)}px Outfit, 'Segoe UI', sans-serif`;
        ctx.fillStyle = "#8A7360";
        ctx.fillText("later", s.x, s.y + nameSize * 1.45);
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
    ctx.save();
    ctx.font = "600 11px Outfit, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(90, 74, 58, 0.72)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("SAMPLE LAYOUT — not a final design", w / 2, h - 8);
    ctx.restore();
  }

  function render() {
    const { w, h } = size();
    if (w < 2 || h < 2) return;
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
    drawRooms();
    for (const wall of house.walls) {
      if (wallVisible(wall)) drawWall(wall);
    }
    for (const wall of house.walls) {
      if (!wallVisible(wall)) continue;
      for (const opening of openingsFor(house, wall)) drawOpening(wall, opening);
    }
    drawDimensions();
    drawLabels();
    drawCompass();
    drawWatermark();
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy };
      pinch = null;
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...pointers.values()];
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
    redraw() {
      render();
    },
    setOnChange(fn) {
      onChange = fn;
    },
  };
}
