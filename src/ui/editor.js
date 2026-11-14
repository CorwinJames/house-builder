import schema from "../../schemas/house.schema.json" with { type: "json" };
import Ajv from "ajv/dist/2020.js";
import {
  assemblies,
  assemblyById,
  catalogForTool,
  DEFAULT_EXTERIOR_ID,
  openingItems,
  suggestAssemblyId,
} from "../build/catalog.js";
import {
  addRoomRectangle,
  addWall,
  cloneHouse,
  decorateHouse,
  moveEndpointGroup,
  placeOpening,
  resizeOpening,
  setWallAssembly,
  translateWalls,
  resolveJunctions,
} from "../build/walls.js";
import { syncRooms } from "../build/rooms.js";
import { nextId } from "../build/ids.js";
import { SCALE_FIGURES, makeFigure, scaleFigure } from "../build/scaleFigures.js";
import { previewPlacement, suggestionNote } from "../build/placement.js";
import { pointInRing } from "../build/space.js";
import { snapOpeningOffset } from "../build/openings.js";
import { FINE_GRID_FT, placePoint, projectOntoWall, snapAngleNear, snapToGrid, snapTranslation } from "../build/snap.js";
import { tidyHouse, wallsTouchingRoom } from "../build/tidy.js";
import {
  describeWall,
  formatHeading,
  freeEndName,
  parseAngle,
  parseLength,
  plainFeet,
  pointAt,
  setWallMeasure,
} from "../build/angle.js";
import { applyFix, evaluateRules, warningTargets } from "../rules/index.js";
import { isFutureShown, isPhaseVisible } from "../render/visibility.js";
import { formatArea, formatFeet, formatFeetFine } from "../lib/format.js";
import { pointAlong, polygonArea, wallLength } from "../lib/geom.js";
import { furnitureFootprint } from "../build/annotations.js";
import { areaKind } from "../build/areas.js";
import { findRatio, ratioLibrary, ratioValue, roomProportion } from "../build/ratios.js";
import { ROOM_SHAPES, WALL_RATIOS, ratioWallEnd, shapedRoomCorner } from "../build/shapeTools.js";
import { constraintReadout, linkWall, snapRoomToRatio, solveConstraints, unlink } from "../build/constraints.js";
import { deviceCostHtml, fixtureCostHtml, selectionCostHtml } from "./costs.js";
import {
  PLACE_OPTIONS as FIXTURE_OPTIONS,
  entryFromClick,
  fixtureFromClick,
  fixtureSpec,
  hitPlumbing,
  laborAssumption as plumbingLabor,
  suggestPlacements as suggestFixtures,
  buildPlumbing,
} from "../plumbing/design.js";
import { fieldFootprint, hitSite, placeSite, suggestSite } from "../site/design.js";
import { budgetPhrase, gameHead, issueCards, issueRows, quietDelete, statTiles, groupByRoom } from "./gamecard.js";
import { costReport } from "../cost/list.js";
import { siteInspectorHtml, siteOptionsHtml } from "./sitePanel.js";
import {
  APPLIANCES,
  DROP_WHY,
  PLACE_OPTIONS,
  applyDeviceKind,
  buildElectrical,
  deviceFromClick,
  devicePoint,
  deviceSpec,
  hitElectrical,
  plainCircuitLine,
  plainPlaceLabel,
  laborAssumption,
  panelFromClick,
  panelPoint,
  suggestPanel,
  suggestPlacements,
  wallMethod,
} from "../electrical/design.js";

const DOC_KEY = "house-builder.document.v2";
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const TOOLS = [
  { id: "select", label: "Select", icon: "↖", tip: "Click a wall, room, or part" },
  { id: "wall", label: "Wall", icon: "▬", tip: "Drag a wall. It follows the cursor." },
  { id: "room", label: "Room", icon: "▢", tip: "Drag a rectangle of walls" },
  { id: "door", label: "Door", icon: "⌂", tip: "Drag a door along a wall" },
  { id: "window", label: "Window", icon: "▦", tip: "Drag a window along a wall" },
  { id: "electrical", label: "Power", icon: "⚡", tip: "Place outlets, lights, and the panel" },
  { id: "plumbing", label: "Water", icon: "💧", tip: "Place sinks, toilets, and the entry" },
  { id: "site", label: "Site", icon: "🌳", tip: "Place the well, tank, and field" },
  { id: "scale", label: "Scale", icon: "🧍", tip: "Drop a person, bed, sofa, table, or car to judge size" },
  { id: "erase", label: "Delete", icon: "✕", tip: "Click something to remove it" },
];

const TOOL_HINTS = {
  select: "Click anything to open its card.",
  wall: "Drag to draw a wall. The label shows the length and the angle. Tab types both.",
  room: "Drag a rectangle. The south side suggests rammed earth.",
  door: "Pick a size, then drag along a wall.",
  window: "Pick a size, then drag along a wall.",
  electrical: "Click a wall to place a device. Other systems fade.",
  plumbing: "Click a wall to place a fixture. Other systems fade.",
  site: "",
  erase: "Click the thing you want gone.",
};

const TUTORIAL = [
  "Drag on the plan to draw a wall. The label shows the length and the angle. Tab types both.",
  "Room draws a rectangle of walls. The south side suggests rammed earth. The other sides suggest hempcrete.",
  "Door shows only doors. Window shows only windows. Set the size, then drag along a wall.",
  "Select a wall and drag a round handle. Tab or the card sets the length and the angle. Snap to grid lines it up.",
  "Electrical places outlets, lights, switches, and the panel. Suggest placements draws ghost outlets you can accept.",
];

export function attachEditor({ plan, model, sample, getViewState, patchViewState, onChange, onDocument }) {
  const saved = readSaved();
  let house = saved.doc;
  let fromSave = saved.fromSave;
  const past = [];
  const future = [];
  const undoNotes = [];
  const redoNotes = [];
  let mode = "view";
  let tool = "select";
  let assemblyId = DEFAULT_EXTERIOR_ID;
  let assemblyExplicit = false;
  let grid = FINE_GRID_FT;
  let catalogId = "door-30";
  // Proportion for the Room tool (width : depth inside) and the Wall tool (× the wall it starts from).
  let roomShape = "free";
  let wallRatio = "free";
  let snapOn = false;
  let shiftHeld = false;
  let guidesOn = false;
  let selection = null;
  let picks = [];
  // Where the pointer last was over the plan or the 3D floor. Paste lands here.
  let pointerWorld = null;
  // In-app clipboard for Copy and Paste: copies of items plus the point they were copied around.
  let clipboard = null;
  let foldedFor = "";
  let gesture = null;
  let measureOpen = false;
  let measureTold = false;
  let warnings = [];
  let tutorialStep = 0;
  let longTimer = 0;
  let spaceHeld = false;
  let hoverPlace = null;
  let optionsKey = "";
  let optionsOpen = false;
  const draftSize = {};
  let deviceKind = "receptacle";
  let pumpSupply = "240";
  let fixtureKind = "kitchen-sink";
  let siteKind = "well";
  let figureKind = "person";
  let siteGhosts = [];
  let hoverWorld = null;
  let advancedOn = false;
  let suggestKind = null;
  let suggestNote = "";
  let panelGhost = null;
  let suggestPreview = null;
  let lastPreview = null;
  const history = [];
  let coachKey = "";
  let guideHideTimer = 0;

  const hud = document.querySelector("#build-hud");
  const inspector = document.querySelector("#inspector");
  const tutorial = document.querySelector("#build-tutorial");
  document.querySelector("#tool-row").innerHTML = TOOLS.map((item) => (
    `<button type="button" class="tool" data-tool="${item.id}" title="${item.tip}"><span class="tool-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></button>`
  )).join("");

  const buildHooks = {
    down: onDown,
    move: onMove,
    up: onUp,
    hover: onHover,
    label: onLabel,
    cancel: () => {
      window.clearTimeout(longTimer);
      if (measureOpen) return;
      gesture = null;
    },
  };
  plan.setBuildHooks(buildHooks);
  model.setBuildHooks?.(buildHooks);
  model.setOnPick?.((pick, event) => {
    if (mode !== "build") return;
    const item = typeof pick === "string" ? { type: "wall", id: pick } : pickItem(pick);
    if (event?.shiftKey && tool === "select" && item) togglePick(item);
    else choose(item);
    publish();
  });

  document.querySelector("#mode-seg").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    mode = button.dataset.mode;
    if (mode === "build") document.dispatchEvent(new CustomEvent("prefer-place"));
    if (mode === "build" && !getViewState().buildTutorialDone) tutorialStep = 0;
    publish();
    onChange();
  });
  document.querySelector("#tool-row").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tool]");
    if (!button) return;
    tool = button.dataset.tool;
    if (tool !== "select") document.dispatchEvent(new CustomEvent("prefer-place"));
    if (tool === "site" || tool === "electrical" || tool === "plumbing" || tool === "scale") optionsOpen = true;
    publish();
    onChange();
    if (tool === "site") {
      plan.fit();
      model.frameParcel?.();
    }
  });
  hud.addEventListener("click", onHudClick);
  document.querySelector("#options-toggle").addEventListener("click", () => {
    optionsOpen = !optionsOpen;
    setOptionsOpen(optionsOpen);
  });

  /** The options panel slides open and closed. It is never redrawn just to open it. */
  function setOptionsOpen(open) {
    document.querySelector("#options-shell")?.classList.toggle("is-open", open);
    const box = document.querySelector("#tool-options");
    if (box) box.inert = !open;
    document.querySelector("#options-toggle")?.setAttribute("aria-expanded", String(open));
  }
  hud.addEventListener("change", onHudChange);
  hud.addEventListener("input", onHudInput);
  document.querySelector("#undo").addEventListener("click", undo);
  document.querySelector("#redo").addEventListener("click", redo);
  document.querySelector("#export-json").addEventListener("click", exportJson);
  document.querySelector("#import-json").addEventListener("click", () => document.querySelector("#import-file").click());
  document.querySelector("#import-file").addEventListener("change", importJson);
  document.querySelector("#reset-sample").addEventListener("click", () => {
    if (!window.confirm("Replace your edits with the sample house?")) return;
    past.length = 0;
    future.length = 0;
    fromSave = false;
    localStorage.removeItem(DOC_KEY);
    house = decorateHouse(sample);
    choose(null);
    warnings = [];
    publish();
    onDocument?.("reset");
    document.dispatchEvent(new CustomEvent("app-toast", { detail: { text: "Sample house restored" } }));
  });
  tutorial.addEventListener("click", (event) => {
    if (!event.target.closest("[data-dismiss-hint]")) return;
    const dismissed = { ...(getViewState().dismissedHints || {}), [tool]: true };
    patchViewState({ dismissedHints: dismissed, buildTutorialDone: true });
    paintTutorial();
  });
  document.addEventListener("show-finding", (event) => showFinding(event.detail));
  document.querySelector("#wall-measure")?.addEventListener("submit", (event) => {
    event.preventDefault();
    applyMeasure();
  });
  document.querySelector("#measure-cancel")?.addEventListener("click", () => cancelMeasure());
  document.querySelector("#wall-measure")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelMeasure();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      shiftHeld = true;
      paintSnapButton();
    }
    if (event.key === "Tab" && mode === "build" && !measureOpen && !typingTarget(event.target) && measureTarget()) {
      event.preventDefault();
      openMeasure();
      return;
    }
    if (typingTarget(event.target)) return;
    const meta = event.metaKey || event.ctrlKey;
    if (event.code === "Space") {
      spaceHeld = true;
      event.preventDefault();
      return;
    }
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (!meta && event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      redo();
    } else if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (meta && event.key.toLowerCase() === "c" && mode === "build" && !event.shiftKey && !event.altKey) {
      if (!picks.length) return;
      event.preventDefault();
      copySelection();
    } else if (meta && event.key.toLowerCase() === "v" && mode === "build" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      pasteClipboard();
    } else if (mode === "build" && tool === "select" && (event.key === "Delete" || event.key === "Backspace") && picks.length && !typingTarget(event.target)) {
      event.preventDefault();
      eraseSelection();
    } else if (event.key === "Escape") {
      if (measureOpen) {
        event.preventDefault();
        cancelMeasure();
        return;
      }
      event.preventDefault();
      cancelLive();
      if (gesture?.snapshot) {
        house = gesture.snapshot;
        plan.setHouse(house);
        model.setHouse?.(house);
      }
      gesture = null;
      hoverWorld = null;
      hoverPlace = null;
      lastPreview = null;
      if (tool !== "select") {
        tool = "select";
        optionsOpen = false;
        announce("Select tool. Esc canceled the last tool.", false);
      } else choose(null);
      publish();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") spaceHeld = false;
    if (event.key === "Shift") {
      shiftHeld = false;
      paintSnapButton();
    }
  });

  refreshWarnings();
  pushViews();

  function readSaved() {
    try {
      const raw = localStorage.getItem(DOC_KEY);
      if (!raw) return { doc: decorateHouse(sample), fromSave: false };
      const decorated = decorateHouse(JSON.parse(raw));
      if (!validate(decorated)) return { doc: decorateHouse(sample), fromSave: false };
      return { doc: decorated, fromSave: true };
    } catch {
      return { doc: decorateHouse(sample), fromSave: false };
    }
  }

  function outwardForWall(start, end) {
    let cx = (house.footprint?.width || 0) / 2;
    let cy = (house.footprint?.depth || 0) / 2;
    if (house.walls.length) {
      let sx = 0;
      let sy = 0;
      for (const wall of house.walls) {
        sx += (wall.start.x + wall.end.x) / 2;
        sy += (wall.start.y + wall.end.y) / 2;
      }
      cx = sx / house.walls.length;
      cy = sy / house.walls.length;
    }
    return {
      x: (start.x + end.x) / 2 - cx,
      y: (start.y + end.y) / 2 - cy,
    };
  }

  function activeRatio() {
    const id = house.proportion?.ratioId || "golden";
    if (id === "custom") {
      const custom = (house.customRatios || [])[0];
      return custom || { id: "custom", name: "Custom", symbol: "custom", value: custom?.value || 1.5 };
    }
    return findRatio(id, house.customRatios) || findRatio("golden");
  }

  function shapeChoice(list, id) {
    const item = list.find((entry) => entry.id === id);
    if (!item || item.id === "free") return null;
    const value = item.value || ratioValue(findRatio(item.id, house.customRatios || []));
    return value > 0 ? { ...item, value } : null;
  }

  /** Room tool with a shape picked: the far corner keeps that width : depth, inside the walls. */
  function shapeRoom(start, end) {
    const shape = shapeChoice(ROOM_SHAPES, roomShape);
    if (!shape || !end) return end;
    const thickness = (outward) => {
      const id = suggestAssemblyId(start, end, assemblyExplicit ? assemblyId : DEFAULT_EXTERIOR_ID, assemblyExplicit, outward);
      return Number(assemblyById[id]?.thickness) || 0;
    };
    const corner = shapedRoomCorner(start, end, shape.value, thickness);
    const long = Math.max(corner.insideWidth, corner.insideDepth);
    const short = Math.min(corner.insideWidth, corner.insideDepth);
    return {
      x: corner.x,
      y: corner.y,
      snapped: "shape",
      label: `${shape.label} · ${formatFeetFine(long).construction} × ${formatFeetFine(short).construction} inside`,
    };
  }

  /** The wall that already ends where a new wall starts. The newest one wins. */
  function wallEndingAt(point) {
    const walls = house.walls || [];
    for (let i = walls.length - 1; i >= 0; i -= 1) {
      const wall = walls[i];
      if (Math.hypot(wall.start.x - point.x, wall.start.y - point.y) < 0.05) return wall;
      if (Math.hypot(wall.end.x - point.x, wall.end.y - point.y) < 0.05) return wall;
    }
    return null;
  }

  /** Wall tool with a ratio picked: the new wall is that wall × or ÷ the ratio. */
  function ratioWall(start, end, event) {
    const ratio = shapeChoice(WALL_RATIOS, wallRatio);
    if (!ratio || !end) return end;
    const ref = wallEndingAt(start);
    if (!ref) return { ...end, label: "Start on a wall end to match it", ratioLabel: true };
    const refLength = wallLength(ref);
    let direction = null;
    if (snapping(event)) {
      const squared = snapAngleNear(start, end, 0);
      if (squared) {
        const len = Math.hypot(squared.x - start.x, squared.y - start.y) || 1;
        direction = { x: (squared.x - start.x) / len, y: (squared.y - start.y) / len };
      }
    }
    const next = ratioWallEnd(start, end, refLength, ratio.value, direction);
    const refText = formatFeetFine(refLength).construction;
    const lenText = formatFeetFine(next.length).construction;
    const label = next.relation === "same"
      ? `Same as ${refText}`
      : next.relation === "times"
        ? `${ratio.label} × ${refText} = ${lenText}`
        : `${refText} ÷ ${ratio.label} = ${lenText}`;
    return { x: next.x, y: next.y, length: next.length, snapped: "ratio", label, ratioLabel: true };
  }

  function catalogItem() {
    let base = openingItems.find((item) => item.id === catalogId) || openingItems[0];
    if ((tool === "door" || tool === "window") && base.type !== tool) {
      base = openingItems.find((item) => item.type === tool) || base;
      catalogId = base.id;
    }
    const sized = draftSize[base.type] || {};
    return { ...base, ...sized, type: base.type };
  }

  function visibleWall(wall) {
    const view = getViewState();
    if (wall.phase === "future" && !isFutureShown(view)) return false;
    const layer = wall.assembly === "framed" ? "framing" : "infill";
    return view.layers[layer] !== false;
  }

  function magnetRadius() {
    const camera = plan.getCamera();
    return Math.max(0.55, 16 / (camera.pxPerFt || 8));
  }

  function snapping(event) {
    return snapOn || !!(event && event.shiftKey);
  }

  function magnetFeet() {
    const scale = plan.getCamera()?.pxPerFt || 8;
    return Math.min(1.25, 12 / scale);
  }

  function aim(world, event, origin, walls) {
    return placePoint(world, {
      snap: snapping(event),
      grid,
      walls: walls || [],
      origin: origin || null,
      magnetFeet: snapping(event) ? magnetFeet() : 0,
      endMagnetFeet: endMagnetFeet(),
    });
  }

  /** About 10 screen pixels: close enough that a wall end clicks onto another wall end. */
  function endMagnetFeet() {
    const scale = plan.getCamera()?.pxPerFt || 8;
    return Math.min(1.25, 10 / scale);
  }

  function movedEnough(from, to) {
    const scale = plan.getCamera()?.pxPerFt || 8;
    return Math.hypot(to.x - from.x, to.y - from.y) * scale >= 3;
  }

  function snapInches() {
    const inches = Math.round(grid * 12);
    return inches === 1 ? "1 inch" : `${inches} inches`;
  }

  function hitTest(world) {
    const reach = magnetRadius();
    if (selection?.type === "wall") {
      const wall = house.walls.find((item) => item.id === selection.id);
      if (wall) {
        if (Math.hypot(world.x - wall.start.x, world.y - wall.start.y) <= reach) {
          return { type: "endpoint", wallId: wall.id, point: { ...wall.start } };
        }
        if (Math.hypot(world.x - wall.end.x, world.y - wall.end.y) <= reach) {
          return { type: "endpoint", wallId: wall.id, point: { ...wall.end } };
        }
      }
    }
    const electricalHit = hitElectrical(house, world, Math.max(1.1, reach));
    const plumbingHit = hitPlumbing(house, world, Math.max(1.1, reach));
    const siteLimit = tool === "site" || tool === "select" ? Math.max(8, 22 / (plan.getCamera().pxPerFt || 8)) : 1.6;
    const siteHit = hitSite(house, world, siteLimit);
    if (tool === "site" && siteHit) return siteHit;
    if (tool === "plumbing" && plumbingHit) return plumbingHit;
    if (tool === "electrical" && electricalHit) return electricalHit;
    if (plumbingHit && electricalHit) {
      return (plumbingHit.distance ?? 0) <= (electricalHit.distance ?? 0) ? plumbingHit : electricalHit;
    }
    if (siteHit && (tool === "select" || tool === "site")) return siteHit;
    if (plumbingHit) return plumbingHit;
    if (electricalHit) return electricalHit;
    if (tool === "select" || tool === "erase") {
      const piece = hitPiece(world);
      if (piece) return piece;
    }
    let bestWall = null;
    for (const wall of house.walls) {
      if (!visibleWall(wall)) continue;
      const hit = projectOntoWall(world, wall);
      if (!hit) continue;
      const limit = wall.thickness / 2 + 0.35;
      if (hit.distance > limit) continue;
      if (!bestWall || hit.distance < bestWall.hit.distance) bestWall = { wall, hit };
    }
    if (bestWall) {
      const opening = house.openings.find((item) => (
        item.wallId === bestWall.wall.id
        && bestWall.hit.offset >= item.offset - 0.2
        && bestWall.hit.offset <= item.offset + item.width + 0.2
      ));
      if (opening) return { type: "opening", id: opening.id, wallId: bestWall.wall.id };
      return { type: "wall", id: bestWall.wall.id };
    }
    const room = hitRoom(world);
    if (room) return room;
    return null;
  }

  function hitPiece(world) {
    let best = null;
    const consider = (type, id, area) => {
      if (!best || area < best.area) best = { type, id, area };
    };
    for (const item of house.furniture || []) {
      const footprint = furnitureFootprint(item);
      if (!inside(world, footprint)) continue;
      consider("furniture", item.id, Math.abs(polygonArea(footprint)) || 1);
    }
    for (const feature of house.siteFeatures || []) {
      const radius = Math.max(1.5, (feature.size || 6) / 2);
      if (Math.hypot(world.x - feature.x, world.y - feature.y) > radius) continue;
      consider("siteFeature", feature.id, Math.PI * radius * radius);
    }
    for (const label of house.planLabels || []) {
      const radius = Math.max(1.4, Math.min(8, String(label.text || "").length * 0.45));
      if (Math.hypot(world.x - label.x, world.y - label.y) > radius) continue;
      consider("planLabel", label.id, radius * radius);
    }
    if (!best) return null;
    return { type: best.type, id: best.id };
  }

  function hitRoom(world) {
    const hits = [];
    for (const room of house.rooms) {
      if (room.phase === "future" && !isFutureShown(getViewState())) continue;
      if (inside(world, room.polygon || [])) hits.push(room);
    }
    if (!hits.length) return null;
    const overlay = new Set(["study", "site", "covered"]);
    const real = hits.filter((room) => !overlay.has(areaKind(room)));
    const pool = real.length ? real : hits;
    const heated = pool.filter((room) => areaKind(room) === "heated");
    const choose = (heated.length ? heated : pool)
      .slice()
      .sort((a, b) => polygonArea(a.polygon || []) - polygonArea(b.polygon || []));
    return { type: "room", id: choose[0].id };
  }

  function pointFor(activeTool, world, extra) {
    if (activeTool === "site" || activeTool === "room" || activeTool === "wall" || activeTool === "scale") return world || extra?.surface || null;
    return extra?.surface || world || null;
  }

  function draggedEndName(current) {
    const wall = (current?.snapshot || house).walls.find((item) => item.id === current?.hit?.wallId);
    if (!wall) return "end";
    const startDist = Math.hypot(wall.start.x - current.hit.point.x, wall.start.y - current.hit.point.y);
    return startDist < 0.2 ? "start" : "end";
  }

  function measureTarget() {
    if (mode !== "build") return null;
    if (gesture?.kind === "marquee") return null;
    if (gesture?.kind === "wall" && gesture.start) return { kind: "draft", start: { ...gesture.start } };
    if (gesture?.kind === "endpoint" && gesture.hit) {
      return {
        kind: "wall",
        id: gesture.hit.wallId,
        endName: draggedEndName(gesture),
        baseline: gesture.snapshot,
      };
    }
    if (gesture?.kind === "select" && gesture.hit?.type === "wall") {
      const wall = (gesture.snapshot || house).walls.find((item) => item.id === gesture.hit.id);
      if (!wall) return null;
      return {
        kind: "wall",
        id: wall.id,
        endName: freeEndName(wall, gesture.snapshot || house),
        baseline: gesture.snapshot,
      };
    }
    if (gesture) return null;
    if (selection?.type === "wall" && picks.length === 1) {
      const wall = house.walls.find((item) => item.id === selection.id);
      if (!wall) return null;
      return { kind: "wall", id: wall.id, endName: freeEndName(wall, house), baseline: null };
    }
    return null;
  }

  function fromWallMeasure(wall, was) {
    const info = describeWall(wall.start, wall.end, house, wall.id);
    info.at = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
    if (was != null) info.text = `${info.text} · was ${plainFeet(was)}`;
    return info;
  }

  function wallMeasure() {
    if (mode !== "build") return null;
    if (gesture?.kind === "wall" && gesture.end) {
      const info = describeWall(gesture.start, gesture.end, house, null);
      info.at = {
        x: (gesture.start.x + gesture.end.x) / 2,
        y: (gesture.start.y + gesture.end.y) / 2,
      };
      return info;
    }
    if (gesture?.kind === "endpoint" && gesture.hit) {
      const source = gesture.moved ? house : (gesture.snapshot || house);
      const wall = source.walls.find((item) => item.id === gesture.hit.wallId);
      return wall ? fromWallMeasure(wall, null) : null;
    }
    if (gesture?.kind === "select" && gesture.hit?.type === "wall") {
      const wall = house.walls.find((item) => item.id === gesture.hit.id);
      return wall ? fromWallMeasure(wall, gesture.moved ? gesture.wasLength : null) : null;
    }
    if (gesture) return null;
    if (selection?.type === "wall" && picks.length === 1) {
      const wall = house.walls.find((item) => item.id === selection.id);
      return wall ? fromWallMeasure(wall, null) : null;
    }
    return null;
  }

  function hideMeasure() {
    const form = document.querySelector("#wall-measure");
    if (form) form.hidden = true;
    measureOpen = false;
  }

  function placeMeasureForm() {
    const form = document.querySelector("#wall-measure");
    if (!form || form.hidden) return;
    const box = plan.measureLabelBox?.();
    const planCanvas = document.querySelector("#plan-canvas");
    const modelCanvas = document.querySelector("#model-canvas");
    const view = getViewState().view;
    const planVisible = planCanvas && planCanvas.clientWidth > 20 && view !== "model";
    const anchor = (view === "model" ? modelCanvas : planCanvas)?.getBoundingClientRect();
    const boxOnScreen = planVisible && box && box.width > 0
      && box.left < window.innerWidth - 8
      && box.top < window.innerHeight - 8
      && box.left + box.width > 8
      && box.top + box.height > 8;
    const left = boxOnScreen ? box.left + box.width + 8 : (anchor?.left || 16) + 16;
    const top = boxOnScreen ? box.top : (anchor?.top || 16) + 16;
    form.style.left = `${Math.max(8, Math.min(left, window.innerWidth - 296))}px`;
    form.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 220))}px`;
  }

  function openMeasure() {
    const target = measureTarget();
    const info = wallMeasure();
    const form = document.querySelector("#wall-measure");
    if (!target || !info || !form) return false;
    form.querySelector("#measure-length").value = plainFeet(info.length);
    form.querySelector("#measure-angle").value = formatHeading(info.angle).replace("°", "");
    form.querySelector("#measure-join").textContent = info.joinAngle == null
      ? "0° points east. The angle turns counterclockwise."
      : `${Math.round(info.joinAngle)}° from the wall it meets. 0° points east. The angle turns counterclockwise.`;
    form.hidden = false;
    measureOpen = true;
    placeMeasureForm();
    requestAnimationFrame(() => placeMeasureForm());
    const lengthInput = form.querySelector("#measure-length");
    lengthInput.focus();
    lengthInput.select();
    if (!measureTold) {
      measureTold = true;
      announce("Type the length and the angle, then press Enter. 0° points east, and the angle turns counterclockwise. Esc cancels.", false);
    }
    return true;
  }

  function onLabel() {
    if (mode !== "build") return false;
    if (measureOpen) {
      document.querySelector("#measure-length")?.focus();
      return true;
    }
    return openMeasure();
  }

  function cancelMeasure() {
    hideMeasure();
    cancelLive();
    if (gesture?.snapshot) {
      house = gesture.snapshot;
      plan.setHouse(house);
      model.setHouse?.(house);
    }
    gesture = null;
    publish();
  }

  function finishWall(current) {
    const chosen = suggestAssemblyId(current.start, current.end, assemblyId, assemblyExplicit, outwardForWall(current.start, current.end));
    const added = addWall(house, current.start, current.end, chosen);
    if (added.house !== house) {
      if (added.createdId) choose({ type: "wall", id: added.createdId });
      commit(syncRooms(added.house));
      announce("Drew a wall.");
    } else {
      warnings = added.warnings;
      announce(added.warnings?.[0]?.message || "That wall wasn't drawn.", false);
      publish();
    }
  }

  function commitWallMeasure(length, angle, target) {
    if (!target || length == null || !(length > 0) || angle == null || Number.isNaN(angle)) {
      announce("Type a length, such as 12 ft 4 in, and an angle, such as 37.", false);
      return false;
    }
    if (length < 0.45) {
      announce("That wall is too short to keep.", false);
      return false;
    }
    if (target.kind === "draft") {
      const end = pointAt(target.start, length, angle);
      const current = gesture;
      hideMeasure();
      gesture = null;
      cancelLive();
      if (!current) return false;
      current.end = { ...(current.end || {}), x: end.x, y: end.y, length };
      current.moved = true;
      finishWall(current);
      return true;
    }
    flushLive();
    const source = target.baseline && gesture?.moved ? house : (target.baseline || house);
    const baseline = target.baseline;
    const next = setWallMeasure(source, target.id, length, angle, target.endName);
    hideMeasure();
    gesture = null;
    cancelLive();
    const changed = commit(syncRooms(next), baseline, "setting the length and angle");
    if (changed) announce("Set the length and angle.");
    else announce("That length and angle are already set.", false);
    publish();
    return changed;
  }

  function applyMeasure() {
    const form = document.querySelector("#wall-measure");
    if (!form) return;
    commitWallMeasure(
      parseLength(form.querySelector("#measure-length").value),
      parseAngle(form.querySelector("#measure-angle").value),
      measureTarget(),
    );
  }

  function onDown(event, world, extra) {
    notePointer(world, extra);
    if (measureOpen) cancelMeasure();
    world = pointFor(tool, world, extra);
    if (!world || mode !== "build" || spaceHeld || event.button === 1 || event.button === 2) return false;
    window.clearTimeout(longTimer);
    const armPan = () => {
      window.clearTimeout(longTimer);
      longTimer = window.setTimeout(() => {
        if (gesture?.moved) return;
        gesture = null;
        plan.beginPan(event);
      }, 480);
    };
    if (tool === "select") {
      const pickedPiece = pieceSelection(extra?.pick);
      const hit = pickedPiece || hitTest(world) || extra?.pick || null;
      const item = pickItem(hit);
      if (event.shiftKey || !item) {
        gesture = {
          kind: "marquee",
          start: world,
          end: world,
          origin: world,
          additive: !!event.shiftKey,
          moved: false,
          base: event.shiftKey ? picks.map((pick) => ({ ...pick })) : [],
          toggleHit: event.shiftKey ? item : null,
          downX: event.clientX,
          downY: event.clientY,
          clientX: event.clientX,
          clientY: event.clientY,
        };
        return true;
      }
      // Pressing on something that is already part of a multi-selection keeps the
      // whole selection, so dragging moves it all as one piece.
      const inGroup = hit?.type !== "endpoint" && picks.length > 1 && picks.some((pick) => pick.type === item.type && pick.id === item.id);
      if (!inGroup) choose(item);
      const selectedWall = hit.type === "wall" || hit.type === "endpoint"
        ? house.walls.find((wall) => wall.id === item.id)
        : null;
      gesture = {
        kind: hit?.type === "endpoint" ? "endpoint" : "select",
        hit,
        origin: world,
        moved: false,
        snapshot: cloneHouse(house),
        wasLength: selectedWall ? wallLength(selectedWall) : null,
        group: inGroup ? groupFrom(picks) : (item.type === "room" && !movablePiece(item) ? groupFrom([item]) : null),
        clickItem: inGroup ? item : null,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      publish();
      armPan();
      return true;
    }
    if (tool === "scale") {
      if (!world) return true;
      const figure = makeFigure(figureKind, world, nextId("figure"));
      const next = cloneHouse(house);
      next.furniture = [...(next.furniture || []), figure];
      commit(next, house, "placing a scale figure");
      choose({ type: "furniture", id: figure.id });
      announce(`Placed a ${scaleFigure(figureKind).label.toLowerCase()}. Use Select to drag it.`);
      publish();
      return true;
    }
    if (tool === "erase") {
      const hit = pieceSelection(extra?.pick) || hitTest(world) || extra?.pick || null;
      const item = pickItem(hit);
      if (item) deleteItems([item]);
      return true;
    }
    if (tool === "wall" || tool === "room") {
      const start = aim(world, event, null, house.walls);
      gesture = { kind: tool, start, origin: world, snapshot: cloneHouse(house), clientX: event.clientX, clientY: event.clientY };
      armPan();
      return true;
    }
    if (tool === "electrical" || tool === "plumbing") {
      const preview = previewPlacement(house, world, {
        system: tool,
        kind: tool === "electrical" ? deviceKind : fixtureKind,
        supply: pumpSupply,
      });
      lastPreview = preview;
      if (!preview.ok) {
        announce(preview.reason, false);
        publish();
        return true;
      }
      const next = cloneHouse(house);
      if (tool === "electrical" && deviceKind === "panel") {
        next.electrical.panel = {
          id: "panel-main",
          x: preview.x,
          y: preview.y,
          wallId: preview.wallId,
          offset: preview.offset,
          height: 5,
          phase: preview.phase || "phase1",
        };
        choose({ type: "panel", id: "panel" });
        panelGhost = null;
      } else if (tool === "electrical") {
        const device = deviceFromClick(next, { x: preview.x, y: preview.y }, deviceKind, { supply: pumpSupply });
        device.x = preview.x;
        device.y = preview.y;
        device.wallId = preview.wallId;
        device.offset = preview.offset;
        next.electrical.devices.push(device);
        choose({ type: "device", id: device.id });
      } else if (fixtureKind === "entry") {
        next.plumbing.entry = {
          id: "water-entry",
          x: preview.x,
          y: preview.y,
          wallId: preview.wallId,
          offset: preview.offset,
          phase: preview.phase || "phase1",
        };
        choose({ type: "entry", id: "entry" });
      } else {
        const fixture = fixtureFromClick(next, { x: preview.x, y: preview.y }, fixtureKind);
        fixture.x = preview.x;
        fixture.y = preview.y;
        fixture.wallId = preview.wallId;
        fixture.offset = preview.offset;
        next.plumbing.fixtures.push(fixture);
        choose({ type: "fixture", id: fixture.id });
      }
      commit(next);
      announce(preview.placed);
      return true;
    }
    if (tool === "site") {
      const placed = placeSite(house, world, siteKind);
      choose(placed.selection);
      commit(placed.house);
      announce(`Placed ${siteKind.replaceAll("-", " ")}.`);
      return true;
    }
    if (tool === "door" || tool === "window") {
      const place = openingSpot(world);
      gesture = { kind: "opening", place, snapshot: cloneHouse(house), clientX: event.clientX, clientY: event.clientY };
      armPan();
      publish();
      return true;
    }
    return false;
  }

  function onMove(event, world, extra) {
    notePointer(world, extra);
    world = pointFor(tool, world, extra);
    if (measureOpen) return;
    if (!gesture || !world) return;
    if (Math.hypot(event.clientX - (gesture.clientX || event.clientX), event.clientY - (gesture.clientY || event.clientY)) > 8) {
      window.clearTimeout(longTimer);
    }
    gesture.clientX = event.clientX;
    gesture.clientY = event.clientY;
    if (gesture.kind === "marquee") {
      window.clearTimeout(longTimer);
      const screen = Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY);
      if (screen > 6) gesture.moved = true;
      gesture.end = world;
      publish();
      return;
    }
    if (gesture.kind === "wall" || gesture.kind === "room") {
      window.clearTimeout(longTimer);
      gesture.end = aim(world, event, gesture.start, house.walls);
      gesture.end = gesture.kind === "room" ? shapeRoom(gesture.start, gesture.end) : ratioWall(gesture.start, gesture.end, event);
      gesture.moved = true;
      scheduleLive();
      return;
    }
    if (gesture.kind === "opening") {
      window.clearTimeout(longTimer);
      gesture.place = openingSpot(world, openingStep(event));
      gesture.moved = true;
      scheduleLive();
      return;
    }
    if (gesture.kind === "endpoint" && gesture.hit) {
      if (!gesture.moved && !movedEnough(gesture.origin, world)) return;
      window.clearTimeout(longTimer);
      gesture.moved = true;
      const wall = gesture.snapshot.walls.find((item) => item.id === gesture.hit.wallId);
      const other = wall && Math.hypot(wall.start.x - gesture.hit.point.x, wall.start.y - gesture.hit.point.y) < 0.2
        ? wall.end
        : wall?.start;
      const others = gesture.snapshot.walls.filter((item) => item.id !== gesture.hit.wallId);
      const snapped = aim(world, event, other || null, others);
      scheduleLive(moveEndpointGroup(gesture.snapshot, gesture.hit.point, snapped));
      return;
    }
    if (gesture.kind === "select" && (gesture.hit?.type === "wall" || gesture.group?.walls.length)) {
      const dx = world.x - gesture.origin.x;
      const dy = world.y - gesture.origin.y;
      if (!gesture.moved && !movedEnough(gesture.origin, world)) return;
      window.clearTimeout(longTimer);
      gesture.moved = true;
      const step = snapping(event) ? grid : 0;
      const sdx = step ? snapToGrid(dx, step) : dx;
      const sdy = step ? snapToGrid(dy, step) : dy;
      const ids = gesture.group?.walls.length ? gesture.group.walls : [gesture.hit.id];
      const move = snapPieceMove(gesture.snapshot, ids, sdx, sdy, event);
      gesture.joined = move.snapped;
      gesture.movedWalls = ids;
      let next = translateWalls(gesture.snapshot, ids, move.dx, move.dy);
      for (const piece of gesture.group?.pieces || []) next = movePiece(next, piece, move.dx, move.dy, 0);
      scheduleLive(next);
      return;
    }
    if (gesture.kind === "select" && (["fixture", "device", "panel", "entry", "well", "septic", "drainfield", "reserve"].includes(gesture.hit?.type) || movablePiece(gesture.hit, gesture.snapshot))) {
      const dx = world.x - gesture.origin.x;
      const dy = world.y - gesture.origin.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 0.35) return;
      window.clearTimeout(longTimer);
      gesture.moved = true;
      const step = snapping(event) ? grid : 0;
      scheduleLive(movablePiece(gesture.hit, gesture.snapshot)
        ? movePiece(gesture.snapshot, gesture.hit, dx, dy, step)
        : relocate(gesture.snapshot, gesture.hit, world));
      return;
    }
    if (gesture.kind === "select" && gesture.hit?.type === "opening") {
      const opening = gesture.snapshot.openings.find((item) => item.id === gesture.hit.id);
      const wall = opening && gesture.snapshot.walls.find((item) => item.id === opening.wallId);
      if (!wall) return;
      window.clearTimeout(longTimer);
      gesture.moved = true;
      const next = cloneHouse(gesture.snapshot);
      const target = next.openings.find((item) => item.id === opening.id);
      // Near another wall, the door or window jumps onto it. Otherwise it slides along its own wall.
      const spot = wallSpotFor(gesture.snapshot, world, opening.width, opening.id, openingStep(event));
      if (target && spot?.ok) {
        target.wallId = spot.wall.id;
        target.offset = spot.offset;
        gesture.jumped = spot.wall.id !== wall.id;
      } else {
        const hit = projectOntoWall(world, wall);
        if (!hit) return;
        const slid = snapOpeningOffset(wall, gesture.snapshot.openings, hit.offset - opening.width / 2, opening.width, openingStep(event), opening.id);
        if (target && slid.ok) {
          target.wallId = wall.id;
          target.offset = slid.offset;
          gesture.jumped = false;
        }
      }
      scheduleLive(next);
    }
  }

  function onUp(event, world) {
    window.clearTimeout(longTimer);
    if (measureOpen) return;
    flushLive();
    const current = gesture;
    gesture = null;
    if (!current) return;
    if (current.kind === "marquee") {
      finishMarquee(current);
      publish();
      return;
    }
    if (current.kind === "wall" && current.moved && current.end) {
      finishWall(current);
    } else if (current.kind === "room" && current.moved && current.end) {
      const added = addRoomRectangle(house, current.start, current.end, assemblyExplicit ? assemblyId : DEFAULT_EXTERIOR_ID);
      if (added.house !== house) {
        commit(syncRooms(added.house));
        announce("Drew a room.");
      } else {
        warnings = added.warnings;
        announce(added.warnings?.[0]?.message || "Drag a room at least 2 feet on each side.", false);
      }
    } else if (current.kind === "opening" && current.place?.ok) {
      const placed = placeOpening(house, current.place.wall.id, catalogItem(), current.place.offset);
      if (placed.createdId) {
        choose({ type: "opening", id: placed.createdId });
        commit(placed.house);
        announce(`Placed a ${catalogItem().type === "window" ? "window" : "door"}.`);
      } else {
        warnings = placed.warnings;
        announce(placed.warnings?.[0]?.message || "That spot can't take the opening.", false);
      }
    } else if (current.kind === "opening") {
      announce(current.place ? "Slide onto a clear stretch of wall." : "Click a wall to place the opening.", false);
    } else if (current.kind === "select" && !current.moved && current.clickItem) {
      // A plain click inside a multi-selection picks just that item.
      choose(current.clickItem);
    } else if ((current.kind === "endpoint" || current.kind === "select") && current.moved) {
      const pieceMove = movablePiece(current.hit, current.snapshot) && !current.group?.walls.length;
      let next = house;
      if (current.movedWalls?.length) {
        // A moved end that landed on the middle of a wall tees into it.
        next = cloneHouse(house);
        try { resolveJunctions(next, current.movedWalls); } catch { next = house; }
      }
      commit(pieceMove ? next : syncRooms(next), current.snapshot);
      if (current.hit?.type === "opening") {
        const moved = house.openings.find((item) => item.id === current.hit.id);
        announce(current.jumped ? `Moved the ${moved?.type === "window" ? "window" : "door"} to another wall.` : `Slid the ${moved?.type === "window" ? "window" : "door"}.`);
      } else if (current.movedWalls?.length) {
        const count = current.movedWalls.length;
        const what = count === 1 ? "the wall" : `${count} walls`;
        const them = count === 1 ? "it" : "them";
        announce(current.joined === "end"
          ? `Moved ${what} and joined ${them} at the wall end.`
          : current.joined === "line"
            ? `Moved ${what} and joined ${them} to the wall.`
            : `Moved ${what}.`);
      } else {
        announce("Moved it.");
      }
    }
    publish();
  }

  function placeGhostAt(point) {
    if (tool === "site") {
      const labels = { well: "Well", tank: "Septic tank", drainfield: "Drain field", reserve: "Reserve" };
      const ghost = { kind: siteKind, label: labels[siteKind] || siteKind, x: point.x, y: point.y };
      if (siteKind === "drainfield" || siteKind === "reserve") {
        const field = fieldFootprint(house);
        ghost.width = field.width;
        ghost.depth = field.depth;
      }
      return ghost;
    }
    if (tool === "electrical" || tool === "plumbing") {
      const kind = tool === "electrical" ? deviceKind : fixtureKind;
      return {
        ...previewPlacement(house, point, { system: tool, kind, supply: pumpSupply }),
        kind,
      };
    }
    return null;
  }

  function pieceSelection(pick) {
    if (!pick?.type || !pick.id) return null;
    if (pick.type !== "furniture" && pick.type !== "siteFeature" && pick.type !== "planLabel") return null;
    return { type: pick.type, id: pick.id };
  }

  /** The walls (and loose pieces) a multi-selection moves together. Rooms bring their walls. */
  function groupFrom(list) {
    const walls = new Set();
    const pieces = [];
    for (const pick of list || []) {
      if (pick.type === "wall") walls.add(pick.id);
      else if (pick.type === "room" && !movablePiece(pick)) {
        const room = (house.rooms || []).find((item) => item.id === pick.id);
        for (const id of wallsTouchingRoom(house, room)) walls.add(id);
      } else if (movablePiece(pick)) pieces.push({ type: pick.type, id: pick.id });
    }
    return { walls: [...walls], pieces };
  }

  /**
   * Snap a whole wall, or a group of walls, onto the walls that stay put:
   * a moving end clicks onto a nearby wall end (always), or onto the middle of a
   * wall when Snap to grid is on. Walls that stretch with the move are skipped.
   */
  function snapPieceMove(snapshot, ids, dx, dy, event) {
    const moving = new Set(ids);
    const ends = [];
    for (const wall of snapshot.walls) {
      if (moving.has(wall.id)) ends.push(wall.start, wall.end);
    }
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 0.25;
    const still = snapshot.walls.filter((wall) => !moving.has(wall.id)
      && visibleWall(wall)
      && !ends.some((end) => near(end, wall.start) || near(end, wall.end)));
    return snapTranslation(ends, still, dx, dy, { radius: endMagnetFeet(), lines: snapping(event) });
  }

  function movablePiece(hit, doc = house) {
    if (!hit?.type) return false;
    if (hit.type === "furniture" || hit.type === "siteFeature" || hit.type === "planLabel") return true;
    if (hit.type !== "room") return false;
    const room = (doc?.rooms || house.rooms || []).find((item) => item.id === hit.id);
    const kind = areaKind(room || {});
    return kind === "study" || kind === "site";
  }

  function movePiece(snapshot, hit, dx, dy, step = 0) {
    const next = cloneHouse(snapshot);
    const shift = step ? snapToGrid(dx, step) : dx;
    const nudge = step ? snapToGrid(dy, step) : dy;
    if (hit.type === "room") {
      const room = next.rooms.find((item) => item.id === hit.id);
      if (!room) return next;
      for (const point of room.polygon || []) {
        point.x += shift;
        point.y += nudge;
      }
      if (room.labelAt) {
        room.labelAt.x += shift;
        room.labelAt.y += nudge;
      }
      return next;
    }
    const key = hit.type === "furniture" ? "furniture" : hit.type === "siteFeature" ? "siteFeatures" : "planLabels";
    const item = (next[key] || []).find((entry) => entry.id === hit.id);
    if (!item) return next;
    item.x += shift;
    item.y += nudge;
    return next;
  }

  function relocate(snapshot, hit, world) {
    if (hit.type === "well" || hit.type === "septic" || hit.type === "drainfield" || hit.type === "reserve") {
      const kind = hit.type === "septic" ? "tank" : hit.type;
      return placeSite(snapshot, world, kind).house;
    }
    const next = cloneHouse(snapshot);
    if (hit.type === "fixture") {
      const current = next.plumbing?.fixtures?.find((item) => item.id === hit.id);
      if (!current) return next;
      const preview = previewPlacement(next, world, { system: "plumbing", kind: current.kind });
      if (!preview.ok) return snapshot;
      Object.assign(current, fixtureFromClick(next, { x: preview.x, y: preview.y }, current.kind), {
        id: current.id,
        ghost: false,
        x: preview.x,
        y: preview.y,
        wallId: preview.wallId,
        offset: preview.offset,
      });
    } else if (hit.type === "device") {
      const current = next.electrical?.devices?.find((item) => item.id === hit.id);
      if (!current) return next;
      const preview = previewPlacement(next, world, { system: "electrical", kind: current.kind, supply: current.supply });
      if (!preview.ok) return snapshot;
      Object.assign(current, deviceFromClick(next, { x: preview.x, y: preview.y }, current.kind, { supply: current.supply }), {
        id: current.id,
        ghost: false,
        x: preview.x,
        y: preview.y,
        wallId: preview.wallId,
        offset: preview.offset,
      });
    } else if (hit.type === "panel" && next.electrical?.panel) {
      const preview = previewPlacement(next, world, { system: "electrical", kind: "panel" });
      if (!preview.ok) return snapshot;
      next.electrical.panel = {
        ...next.electrical.panel,
        x: preview.x,
        y: preview.y,
        wallId: preview.wallId,
        offset: preview.offset,
      };
    } else if (hit.type === "entry") {
      const preview = previewPlacement(next, world, { system: "plumbing", kind: "entry" });
      if (!preview.ok) return snapshot;
      next.plumbing.entry = {
        ...(next.plumbing.entry || {}),
        x: preview.x,
        y: preview.y,
        wallId: preview.wallId,
        offset: preview.offset,
      };
    }
    return next;
  }

  function startSiteSuggest() {
    siteGhosts = suggestSite(house);
    optionsKey = "";
    announce(siteGhosts.note || "Suggested a well and a drain field. Accept the ones you want.", false);
    publish();
  }

  function acceptSiteGhosts(kinds) {
    const keep = new Set(kinds);
    let next = house;
    for (const ghost of siteGhosts) {
      if (!keep.has(ghost.kind)) continue;
      const placed = placeSite(next, { x: ghost.x, y: ghost.y }, ghost.kind);
      next = placed.house;
      choose(placed.selection);
    }
    siteGhosts = siteGhosts.filter((ghost) => !keep.has(ghost.kind));
    optionsKey = "";
    commit(next);
  }

  function skipSiteGhosts(kinds) {
    const drop = new Set(kinds);
    siteGhosts = siteGhosts.filter((ghost) => !drop.has(ghost.kind));
    optionsKey = "";
    publish();
  }

  function notePointer(world, extra) {
    const point = world || extra?.surface || null;
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) pointerWorld = { x: point.x, y: point.y };
  }

  function onHover(event, world, extra) {
    notePointer(world, extra);
    if (mode !== "build" || gesture) return;
    const point = world ? pointFor(tool, world, extra) : null;
    if (!point) {
      hoverWorld = null;
      hoverPlace = null;
      lastPreview = null;
      const overlay = makeOverlay();
      plan.setOverlay(overlay);
      model.setOverlay?.(overlay);
      paintCoach();
      return;
    }
    hoverPlace = tool === "door" || tool === "window" ? openingSpot(point) : null;
    hoverWorld = tool === "site" || tool === "electrical" || tool === "plumbing" ? point : null;
    lastPreview = hoverWorld && (tool === "electrical" || tool === "plumbing") ? placeGhostAt(hoverWorld) : null;
    paintCoach();
    const overlay = makeOverlay();
    plan.setOverlay(overlay);
    model.setOverlay?.(overlay);
  }

  function openingStep(event) {
    return snapping(event) ? grid : 1 / 48;
  }

  function openingSpot(world, step = grid) {
    const item = catalogItem();
    let best = null;
    for (const wall of house.walls) {
      if (!visibleWall(wall)) continue;
      const hit = projectOntoWall(world, wall);
      if (!hit || hit.distance > wall.thickness / 2 + magnetRadius()) continue;
      const slid = snapOpeningOffset(wall, house.openings, hit.offset - item.width / 2, item.width, step);
      if (!best || hit.distance < best.distance) {
        best = { wall, offset: slid.offset, width: item.width, ok: slid.ok, distance: hit.distance };
      }
    }
    return best;
  }

  /**
   * The clear stretch of wall nearest `world` that can take an opening this wide.
   * `ignoreId` is the opening being moved, so it does not block itself.
   */
  function wallSpotFor(doc, world, width, ignoreId = null, step = grid) {
    let best = null;
    for (const wall of doc.walls || []) {
      if (!visibleWall(wall)) continue;
      const hit = projectOntoWall(world, wall);
      if (!hit || hit.distance > wall.thickness / 2 + magnetRadius()) continue;
      const slid = snapOpeningOffset(wall, doc.openings || [], hit.offset - width / 2, width, step, ignoreId);
      if (!slid.ok) continue;
      if (!best || hit.distance < best.distance) best = { wall, offset: slid.offset, ok: true, distance: hit.distance };
    }
    return best;
  }

  function moneyOf(doc) {
    const phase = getViewState().phase === "phase1" ? "phase1" : "full";
    const report = costReport(doc, { phase, diyFinish: doc.cost?.diyFinish !== false });
    return { priced: report.pricedTotal, unpriced: report.unpricedCount };
  }

  function preview(next) {
    house = next;
    refreshWarnings();
    pushViews();
  }

  let pendingHouse = null;
  let liveFrame = 0;

  function scheduleLive(nextHouse) {
    if (nextHouse) pendingHouse = nextHouse;
    if (liveFrame) return;
    liveFrame = requestAnimationFrame(() => {
      liveFrame = 0;
      if (pendingHouse) {
        house = syncRooms(pendingHouse);
        pendingHouse = null;
        plan.setHouse(house, { silent: true });
        model.setHouse?.(house);
      }
      const overlayNow = makeOverlay();
      plan.setOverlay(overlayNow);
      model.setOverlay?.(overlayNow);
    });
  }

  function flushLive() {
    if (liveFrame) {
      cancelAnimationFrame(liveFrame);
      liveFrame = 0;
    }
    if (pendingHouse) {
      house = syncRooms(pendingHouse);
      pendingHouse = null;
    }
  }

  function cancelLive() {
    if (liveFrame) cancelAnimationFrame(liveFrame);
    liveFrame = 0;
    pendingHouse = null;
  }

  function commit(next, baseline = null, note = "the last change") {
    const solved = solveConstraints(next);
    next = solved.house;
    const previous = baseline || house;
    if (JSON.stringify(previous) === JSON.stringify(next)) {
      house = previous;
      refreshWarnings();
      pushViews();
      return false;
    }
    past.push(previous);
    undoNotes.push(note);
    redoNotes.length = 0;
    if (past.length > 60) {
      past.shift();
      undoNotes.shift();
    }
    future.length = 0;
    house = next;
    fromSave = true;
    warnings = [...solved.warnings, ...evaluateRules(house)];
    const phrase = budgetPhrase(moneyOf(previous), moneyOf(house));
    if (phrase) document.dispatchEvent(new CustomEvent("budget-delta", { detail: { text: phrase.text } }));
    const local = document.querySelector("#save-status");
    if (local && local.hidden) {
      local.hidden = false;
      local.textContent = "Saved on this device";
    }
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(house));
    } catch {
      // Ignore a full browser store. Export still works.
    }
    pushViews();
    onDocument?.("edit");
    return true;
  }

  function selectionExists(sel, doc) {
    if (!sel?.type || !sel.id) return false;
    if (sel.type === "room") return (doc.rooms || []).some((item) => item.id === sel.id);
    if (sel.type === "wall") return (doc.walls || []).some((item) => item.id === sel.id);
    if (sel.type === "opening") return (doc.openings || []).some((item) => item.id === sel.id);
    if (sel.type === "device") return (doc.electrical?.devices || []).some((item) => item.id === sel.id);
    if (sel.type === "panel") return !!doc.electrical?.panel;
    if (sel.type === "fixture") return (doc.plumbing?.fixtures || []).some((item) => item.id === sel.id);
    if (sel.type === "well") return !!doc.site?.well;
    if (sel.type === "septic") return !!doc.site?.septic?.tank;
    if (sel.type === "drainfield") return !!doc.site?.septic?.drainfield;
    if (sel.type === "reserve") return !!doc.site?.septic?.reserve;
    if (sel.type === "furniture") return (doc.furniture || []).some((item) => item.id === sel.id);
    if (sel.type === "siteFeature") return (doc.siteFeatures || []).some((item) => item.id === sel.id);
    if (sel.type === "planLabel") return (doc.planLabels || []).some((item) => item.id === sel.id);
    if (sel.type === "entry") return !!doc.plumbing?.entry;
    return false;
  }

  function choose(next) {
    const item = pickItem(next);
    applyPicks(item ? [item] : []);
  }

  function applyPicks(next) {
    const seen = new Set();
    picks = [];
    for (const item of next || []) {
      const picked = pickItem(item);
      if (!picked) continue;
      const key = `${picked.type}:${picked.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(picked);
    }
    selection = picks.length === 1 ? { ...picks[0] } : null;
  }

  function togglePick(hit) {
    const item = pickItem(hit);
    if (!item) return;
    const next = picks.filter((pick) => !(pick.type === item.type && pick.id === item.id));
    if (next.length === picks.length) next.push(item);
    applyPicks(next);
  }

  function prunePicks() {
    applyPicks(picks.filter((item) => selectionExists(item, house)));
  }

  function pickItem(hit) {
    if (!hit || typeof hit !== "object") return null;
    if (hit.type === "endpoint" && hit.wallId) return { type: "wall", id: hit.wallId };
    if (hit.type && hit.id != null && hit.id !== "") return { type: hit.type, id: hit.id };
    return null;
  }

  function typingTarget(target) {
    return !!target?.matches?.("input, textarea, select") || !!target?.isContentEditable;
  }

  function holdCamera() {
    document.dispatchEvent(new CustomEvent("preserve-view"));
  }

  function normRect(a, b) {
    return {
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxY: Math.max(a.y, b.y),
    };
  }

  function pointInRect(point, rect, pad = 0) {
    return point.x >= rect.minX - pad && point.x <= rect.maxX + pad && point.y >= rect.minY - pad && point.y <= rect.maxY + pad;
  }

  function segmentsCross(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function segHitsRect(a, b, rect) {
    if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
    const corners = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ];
    for (let i = 0; i < 4; i += 1) {
      if (segmentsCross(a, b, corners[i], corners[(i + 1) % 4])) return true;
    }
    return false;
  }

  function polyHitsRect(points, rect) {
    if (!points?.length) return false;
    if (points.some((point) => pointInRect(point, rect))) return true;
    for (let i = 0; i < points.length; i += 1) {
      if (segHitsRect(points[i], points[(i + 1) % points.length], rect)) return true;
    }
    return false;
  }

  function rectsTouch(a, rect) {
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
    const width = a.width || a.depth || 0;
    const depth = a.depth || a.height || a.width || 0;
    return a.x <= rect.maxX && a.x + width >= rect.minX && a.y <= rect.maxY && a.y + depth >= rect.minY;
  }

  function phaseOk(item) {
    return isPhaseVisible(item?.phase, getViewState());
  }

  function itemsInBox(start, end) {
    const rect = normRect(start, end);
    const found = [];
    const add = (type, id) => {
      if (id == null || id === "") return;
      found.push({ type, id });
    };
    for (const wall of house.walls || []) {
      if (!phaseOk(wall)) continue;
      if (segHitsRect(wall.start, wall.end, rect)) add("wall", wall.id);
    }
    for (const opening of house.openings || []) {
      if (!phaseOk(opening)) continue;
      const wall = (house.walls || []).find((item) => item.id === opening.wallId);
      if (!wall) continue;
      const a = pointAlong(wall, opening.offset || 0);
      const b = pointAlong(wall, (opening.offset || 0) + (opening.width || 0));
      if (segHitsRect(a, b, rect)) add("opening", opening.id);
    }
    for (const room of house.rooms || []) {
      if (!phaseOk(room)) continue;
      if (polyHitsRect(room.polygon, rect)) add("room", room.id);
    }
    for (const item of house.furniture || []) {
      if (!phaseOk(item)) continue;
      if (polyHitsRect(furnitureFootprint(item), rect)) add("furniture", item.id);
    }
    for (const item of house.siteFeatures || []) {
      if (!phaseOk(item)) continue;
      if (pointInRect(item, rect, Math.max(1.5, (item.size || 3) / 2))) add("siteFeature", item.id);
    }
    for (const item of house.planLabels || []) {
      if (pointInRect(item, rect, 2)) add("planLabel", item.id);
    }
    for (const item of house.electrical?.devices || []) {
      if (!phaseOk(item)) continue;
      if (pointInRect(devicePoint(house, item), rect, 1.5)) add("device", item.id);
    }
    const panel = panelPoint(house);
    if (panel && pointInRect(panel, rect, 2)) add("panel", "panel");
    for (const item of house.plumbing?.fixtures || []) {
      if (!phaseOk(item)) continue;
      if (pointInRect(devicePoint(house, item), rect, 1.5)) add("fixture", item.id);
    }
    if (house.plumbing?.entry && pointInRect(devicePoint(house, house.plumbing.entry), rect, 2)) add("entry", "entry");
    if (house.site?.well && pointInRect(house.site.well, rect, 3)) add("well", house.site.well.id || "well");
    const tank = house.site?.septic?.tank;
    if (tank && pointInRect(tank, rect, 3)) add("septic", "tank");
    if (rectsTouch(house.site?.septic?.drainfield, rect)) add("drainfield", "drainfield");
    if (rectsTouch(house.site?.septic?.reserve, rect)) add("reserve", "reserve");
    return found;
  }

  function finishMarquee(current) {
    if (!current.moved) {
      if (current.toggleHit) togglePick(current.toggleHit);
      else if (!current.additive) choose(null);
      return;
    }
    const found = itemsInBox(current.start, current.end || current.start);
    if (!current.additive) {
      applyPicks(found);
      return;
    }
    const merged = current.base.map((item) => ({ ...item }));
    for (const item of found) {
      if (!merged.some((pick) => pick.type === item.type && pick.id === item.id)) merged.push(item);
    }
    applyPicks(merged);
  }

  function itemLabel(item) {
    if (item.type === "wall") return "wall";
    if (item.type === "opening") return "opening";
    if (item.type === "room") {
      const room = (house.rooms || []).find((entry) => entry.id === item.id);
      return areaKind(room || {}) === "heated" ? "room" : "drawing";
    }
    if (item.type === "furniture") return "furniture";
    if (item.type === "siteFeature") return "site mark";
    if (item.type === "planLabel") return "note";
    if (item.type === "device") return "device";
    if (item.type === "panel") return "breaker panel";
    if (item.type === "fixture") return "fixture";
    if (item.type === "entry") return "water entry";
    if (item.type === "well") return "well";
    if (item.type === "septic" || item.type === "drainfield" || item.type === "reserve") return "septic";
    return "item";
  }

  function idsOf(items, type) {
    return new Set(items.filter((item) => item.type === type).map((item) => item.id));
  }

  function dropIds(list, ids) {
    return (list || []).filter((item) => !ids.has(item.id));
  }

  function syncSuggestOverlay() {
    const electricalGhosts = (house.electrical?.devices || []).some((item) => item.ghost);
    const plumbingGhosts = (house.plumbing?.fixtures || []).some((item) => item.ghost);
    if (!electricalGhosts) panelGhost = null;
    if (!electricalGhosts && !plumbingGhosts) {
      suggestKind = null;
      suggestNote = "";
    }
  }

  function undo() {
    if (!past.length) return;
    const note = undoNotes.pop() || "the last change";
    redoNotes.push(note);
    future.push(house);
    house = past.pop();
    holdCamera();
    prunePicks();
    syncSuggestOverlay();
    refreshWarnings();
    localStorage.setItem(DOC_KEY, JSON.stringify(house));
    pushViews();
    publish();
    onDocument?.("edit");
    announce(`Undid ${note}.`, false);
  }

  function redo() {
    if (!future.length) return;
    const note = redoNotes.pop() || "the last change";
    undoNotes.push(note);
    past.push(house);
    house = future.pop();
    holdCamera();
    prunePicks();
    syncSuggestOverlay();
    refreshWarnings();
    localStorage.setItem(DOC_KEY, JSON.stringify(house));
    pushViews();
    publish();
    onDocument?.("edit");
    announce(`Redid ${note}.`, false);
  }

  const COPY_KEYS = { furniture: "furniture", siteFeature: "siteFeatures", planLabel: "planLabels" };

  function openingCenter(doc, opening) {
    const wall = (doc.walls || []).find((item) => item.id === opening.wallId);
    return wall ? pointAlong(wall, opening.offset + opening.width / 2) : null;
  }

  function nameOf(type, item) {
    if (type === "opening") return item.type === "window" ? "window" : "door";
    if (type === "furniture") return String(item.name || "figure").toLowerCase();
    if (type === "planLabel") return "label";
    return String(item.kind || "mark").toLowerCase();
  }

  /** Copy doors, windows, figures, labels, and site marks. Walls, rooms, power, and water stay put. */
  function copySelection() {
    const items = [];
    let skipped = 0;
    for (const pick of picks) {
      if (pick.type === "opening") {
        const opening = house.openings.find((item) => item.id === pick.id);
        const at = opening && openingCenter(house, opening);
        if (at) items.push({ type: "opening", data: structuredClone(opening), at });
        continue;
      }
      const key = COPY_KEYS[pick.type];
      const found = key && (house[key] || []).find((item) => item.id === pick.id);
      if (found) items.push({ type: pick.type, data: structuredClone(found), at: { x: found.x, y: found.y } });
      else skipped += 1;
    }
    if (!items.length) {
      announce("Copy works for doors, windows, scale figures, labels, and site marks. Walls and rooms can't be copied yet.", false);
      return;
    }
    const anchor = {
      x: items.reduce((sum, item) => sum + item.at.x, 0) / items.length,
      y: items.reduce((sum, item) => sum + item.at.y, 0) / items.length,
    };
    clipboard = { items, anchor };
    const what = items.length === 1 ? `the ${nameOf(items[0].type, items[0].data)}` : `${items.length} items`;
    const key = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘V" : "Ctrl+V";
    announce(`Copied ${what}${skipped ? ` (${skipped} can't be copied)` : ""}. Point where it goes and press ${key}.`, false);
  }

  /** Paste at the pointer. A door or window lands on the clear wall nearest the pointer. */
  function pasteClipboard() {
    if (!clipboard?.items?.length) {
      announce("Select a door or window and press ⌘C first.", false);
      return;
    }
    const target = pointerWorld || { x: clipboard.anchor.x + 2, y: clipboard.anchor.y - 2 };
    const dx = target.x - clipboard.anchor.x;
    const dy = target.y - clipboard.anchor.y;
    const next = cloneHouse(house);
    const made = [];
    let missed = 0;
    for (const entry of clipboard.items) {
      const point = { x: entry.at.x + dx, y: entry.at.y + dy };
      if (entry.type === "opening") {
        const spot = wallSpotFor(next, point, entry.data.width, null, grid);
        if (!spot) {
          missed += 1;
          continue;
        }
        const copy = { ...structuredClone(entry.data), id: nextId(entry.data.type), wallId: spot.wall.id, offset: spot.offset };
        next.openings.push(copy);
        made.push({ type: "opening", id: copy.id });
        continue;
      }
      const key = COPY_KEYS[entry.type];
      if (!key) continue;
      const copy = { ...structuredClone(entry.data), id: nextId(entry.type === "planLabel" ? "label" : entry.type), x: point.x, y: point.y };
      next[key] = [...(next[key] || []), copy];
      made.push({ type: entry.type, id: copy.id });
    }
    if (!made.length) {
      announce(clipboard.items.length === 1 && clipboard.items[0].type === "opening"
        ? `Point at a clear stretch of wall, then paste the ${nameOf("opening", clipboard.items[0].data)}.`
        : "Nothing fit there. Point somewhere else and paste again.", false);
      return;
    }
    holdCamera();
    commit(next, house, "pasting");
    applyPicks(made);
    const what = made.length === 1 && clipboard.items.length === 1 ? `the ${nameOf(clipboard.items[0].type, clipboard.items[0].data)}` : `${made.length} items`;
    announce(`Pasted ${what}${missed ? `. ${missed} needed a clear wall and were skipped` : ""}.`);
    publish();
  }

  function eraseSelection(hit) {
    if (!hit || typeof hit.preventDefault === "function") {
      deleteItems(picks);
      return;
    }
    const item = pickItem(hit);
    if (item) deleteItems([item]);
  }

  function deleteItems(list) {
    const items = [];
    const seen = new Set();
    for (const raw of list || []) {
      const item = pickItem(raw);
      if (!item) continue;
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    if (!items.length) return;
    holdCamera();
    const walls = idsOf(items, "wall");
    const openings = idsOf(items, "opening");
    const rooms = idsOf(items, "room");
    const furniture = idsOf(items, "furniture");
    const features = idsOf(items, "siteFeature");
    const labels = idsOf(items, "planLabel");
    const devices = idsOf(items, "device");
    const fixtures = idsOf(items, "fixture");
    let next = cloneHouse(house);
    if (walls.size) next.walls = dropIds(next.walls, walls);
    if (walls.size || openings.size) {
      next.openings = (next.openings || []).filter((opening) => !openings.has(opening.id) && !walls.has(opening.wallId));
    }
    if (rooms.size) next.rooms = dropIds(next.rooms, rooms);
    if (furniture.size) next.furniture = dropIds(next.furniture, furniture);
    if (features.size) next.siteFeatures = dropIds(next.siteFeatures, features);
    if (labels.size) next.planLabels = dropIds(next.planLabels, labels);
    if (devices.size && next.electrical) next.electrical.devices = dropIds(next.electrical.devices, devices);
    if (idsOf(items, "panel").size && next.electrical) next.electrical.panel = null;
    if (fixtures.size && next.plumbing) next.plumbing.fixtures = dropIds(next.plumbing.fixtures, fixtures);
    if (idsOf(items, "entry").size && next.plumbing) next.plumbing.entry = null;
    if (idsOf(items, "well").size && next.site) next.site.well = null;
    if ((idsOf(items, "septic").size || idsOf(items, "drainfield").size || idsOf(items, "reserve").size) && next.site) {
      next.site.septic = null;
    }
    if (walls.size) next = syncRooms(next);
    const count = items.length;
    const note = count === 1 ? "deleting 1 item" : `deleting ${count} items`;
    const changed = commit(next, null, note);
    if (!changed) return;
    choose(null);
    announce(count === 1 ? `Deleted ${itemLabel(items[0])}.` : `Deleted ${count} items.`);
    publish();
  }

  function refreshWarnings() {
    warnings = evaluateRules(house);
  }

  function pushViews() {
    plan.setHouse(house);
    model.setHouse?.(house);
    model.setSelected?.(selection?.type === "wall" ? selection.id : null);
    plan.setOverlay(makeOverlay());
    publish();
    onChange();
  }

  function makeOverlay() {
    const targets = warningTargets(warnings);
    const measure = wallMeasure();
    const draftAssembly = gesture?.kind === "wall" && gesture.end
      ? assemblyById[suggestAssemblyId(gesture.start, gesture.end, assemblyId, assemblyExplicit, outwardForWall(gesture.start, gesture.end))]
      : null;
    return {
      warningWalls: [...targets.walls],
      warningOpenings: [...targets.openings],
      selection: mode === "build" ? selection : null,
      picks: mode === "build" ? picks.map((item) => ({ ...item })) : [],
      marquee: gesture?.kind === "marquee" && gesture.moved && gesture.end ? {
        x0: gesture.start.x,
        y0: gesture.start.y,
        x1: gesture.end.x,
        y1: gesture.end.y,
      } : null,
      draft: gesture?.kind === "wall" && gesture.end ? {
        start: gesture.start,
        end: gesture.end,
        color: draftAssembly?.swatch,
        lengthLabel: (gesture.end.ratioLabel ? gesture.end.label : "") || measure?.text || gesture.end.label || formatFeetFine(gesture.end.length || Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y)).construction,
        ticks: gesture.end.ticks || [],
      } : null,
      guides: guidesOn ? guideBoxes() : [],
      rect: gesture?.kind === "room" && gesture.end ? {
        x0: gesture.start.x,
        y0: gesture.start.y,
        x1: gesture.end.x,
        y1: gesture.end.y,
        label: gesture.end.label || `${formatFeetFine(Math.abs(gesture.end.x - gesture.start.x)).construction} × ${formatFeetFine(Math.abs(gesture.end.y - gesture.start.y)).construction}`,
      } : null,
      placeGhost: hoverWorld && !gesture ? placeGhostAt(hoverWorld) : null,
      suggestMarks: panelGhost ? [panelGhost] : [],
      suggestFocus: suggestPreview,
      siteGhosts,
      ghostOpening: (gesture?.kind === "opening" && gesture.place) || hoverPlace ? {
        wallId: (gesture?.place || hoverPlace).wall.id,
        offset: (gesture?.place || hoverPlace).offset,
        width: catalogItem().width,
        ok: (gesture?.place || hoverPlace).ok,
      } : null,
      measure,
      moveLabel: moveLabel(measure),
    };
  }

  function moveLabel(measure) {
    if (!measure?.at || gesture?.kind === "wall") return null;
    return { x: measure.at.x, y: measure.at.y, text: measure.text };
  }

  function publish() {
    const focus = mode === "build" && (tool === "electrical" || tool === "plumbing" || tool === "site") ? tool : null;
    const issues = evaluateRules(house);
    patchViewState({
      focus,
      issueDeviceIds: issues.filter((item) => item.target?.type === "device").map((item) => item.target.id),
      issueFixtureIds: issues.filter((item) => item.target?.type === "fixture").map((item) => item.target.id),
    });
    hud.hidden = mode !== "build";
    document.querySelector("#mode-seg").querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });
    document.querySelectorAll("#tool-row button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    });
    paintSnapButton();
    document.querySelector("#undo").disabled = past.length === 0;
    document.querySelector("#redo").disabled = future.length === 0;
    paintToolOptions();
    paintInspector();
    paintTutorial();
    const overlay = mode === "build" ? makeOverlay() : null;
    plan.setOverlay(overlay);
    model.setOverlay?.(overlay);
    model.setSelection?.(mode === "build" ? picks.map((item) => ({ ...item })) : null);
    model.setSelected?.(mode === "build" && picks.length === 1 && picks[0].type === "wall" ? picks[0].id : null);
    plan.setCursor?.(mode === "build" && ["site", "wall", "room", "door", "window", "electrical", "plumbing", "scale"].includes(tool) ? "crosshair" : "");
    paintCoach();
  }

  function nextInstruction() {
    if (mode !== "build") return "View mode. Switch to Build to draw and place.";
    const orbitNote = getViewState().view !== "plan" && document.body.dataset.orbit === "true"
      && ["electrical", "plumbing", "door", "window", "wall", "room", "site"].includes(tool)
      ? " Press Orbit when you want to look around. A click places."
      : "";
    if (lastPreview && !lastPreview.ok && (tool === "electrical" || tool === "plumbing")) return `${toolName()} ${lastPreview.reason}${orbitNote}`;
    if (tool === "electrical") {
      if (deviceKind === "panel") return `Power tool. Click a wall to place the breaker panel.${orbitNote}`;
      const name = plainPlaceLabel(deviceKind).toLowerCase();
      const where = deviceSpec(deviceKind, pumpSupply).mount === "ceiling" ? "inside a room" : "a wall";
      return `Power tool. Click ${where} to place the ${name}.${orbitNote}`;
    }
    if (tool === "plumbing") {
      if (fixtureKind === "entry") return `Water tool. Click a wall to place the water entry.${orbitNote}`;
      return `Water tool. Click a wall to place the ${fixtureSpec(fixtureKind).name.toLowerCase()}.${orbitNote}`;
    }
    const lines = {
      select: "Select tool. Drag a wall handle and it follows the cursor. The label shows the length and the angle. Tab or the card types both. Snap to grid lines it up. Drag a box on empty plan to choose several items. Hold Shift and drag to add. Shift-click adds or removes one. Delete removes the selection.",
      wall: "Wall tool. Drag to draw a wall. The label shows the length and the angle. Tab types both. It lands where you let go.",
      room: "Room tool. Drag a rectangle.",
      door: "Door tool. Click a wall to place a door.",
      window: "Window tool. Click a wall to place a window.",
      erase: "Delete tool. Click something to remove it.",
      site: "Site tool. Click the lot to place the item under the pointer.",
      scale: "Scale tool. Click to drop a person, bed, sofa, table, or car, so you can judge how big a room is. Use Select to drag it.",
    };
    return `${lines[tool] || "Build mode."}${orbitNote}`;
  }

  function toolName() {
    if (tool === "electrical") return "Power tool.";
    if (tool === "plumbing") return "Water tool.";
    return "";
  }

  const GUIDE_STEPS = [
    { id: "room", label: "Room", next: "Draw a room." },
    { id: "door", label: "Door", next: "Add a door." },
    { id: "panel", label: "Panel", next: "Place the breaker panel." },
    { id: "outlet", label: "Outlet", next: "Add an outlet." },
    { id: "sink", label: "Sink", next: "Add a kitchen sink." },
  ];

  function guideProgress() {
    if (house.sample || getViewState().guideSkipped || mode !== "build") return null;
    const done = {
      room: (house.rooms || []).some((room) => (room.polygon || []).length >= 3 && !room.outdoor),
      door: (house.openings || []).some((item) => item.type === "door"),
      panel: !!house.electrical?.panel,
      outlet: (house.electrical?.devices || []).some((item) => !item.ghost && ["receptacle", "gfci", "wr-receptacle"].includes(item.kind)),
      sink: (house.plumbing?.fixtures || []).some((item) => !item.ghost && item.kind === "kitchen-sink"),
    };
    const steps = GUIDE_STEPS.map((step) => ({ ...step, done: !!done[step.id] }));
    const next = steps.find((step) => !step.done) || null;
    return { steps, next, complete: !next };
  }

  function scheduleGuideHide() {
    if (guideHideTimer) return;
    guideHideTimer = window.setTimeout(() => {
      guideHideTimer = 0;
      if (!guideProgress()?.complete) return;
      patchViewState({ guideSkipped: true });
      coachKey = "";
      paintCoach();
    }, 4200);
  }

  function paintCoach() {
    const line = document.querySelector("#coach-line");
    const list = document.querySelector("#history-list");
    if (!line) return;
    const progress = guideProgress();
    const next = nextInstruction();
    const guideKey = !progress
      ? ""
      : progress.complete
        ? "done"
        : `${progress.steps.map((step) => (step.done ? "1" : "0")).join("")}:${progress.next.id}`;
    const key = `${guideKey}|${next}|${history.join("\n")}`;
    if (key === coachKey) return;
    coachKey = key;
    const summary = document.querySelector("#guide-card summary");
    if (summary) summary.textContent = progress && !progress.complete ? `Guide · ${progress.next.next}` : "Guide";
    const pill = document.querySelector("#guide-toggle");
    if (pill) pill.textContent = progress && !progress.complete ? `Guide · ${progress.next.next}` : "Guide";
    line.replaceChildren();
    if (progress?.complete) {
      const strong = document.createElement("strong");
      strong.textContent = "All five steps are done.";
      line.append(strong, " ");
      scheduleGuideHide();
    } else if (progress) {
      const strong = document.createElement("strong");
      strong.textContent = `Next: ${progress.next.next}`;
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "coach-skip";
      skip.textContent = "Skip guide";
      skip.addEventListener("click", () => {
        patchViewState({ guideSkipped: true });
        coachKey = "";
        paintCoach();
      });
      const steps = document.createElement("ol");
      steps.className = "guide-steps";
      for (const step of progress.steps) {
        const item = document.createElement("li");
        item.className = step.done ? "is-done" : step.id === progress.next.id ? "is-next" : "";
        item.textContent = step.label;
        steps.append(item);
      }
      line.append(strong, " ", skip, " ", steps, " ");
    }
    line.append(document.createTextNode(next));
    if (!list) return;
    list.replaceChildren();
    for (const item of history) {
      const row = document.createElement("li");
      row.textContent = item;
      list.append(row);
    }
  }

  function announce(text, undo = true) {
    if (!text) return;
    history.unshift(text);
    if (history.length > 12) history.length = 12;
    coachKey = "";
    document.dispatchEvent(new CustomEvent("app-toast", { detail: { text, undo } }));
    paintCoach();
  }

  function paintToolOptions() {
    const box = document.querySelector("#tool-options");
    setOptionsOpen(optionsOpen);
    document.querySelector("#options-toggle")?.setAttribute("aria-expanded", String(optionsOpen));
    if (tool === "door" || tool === "window") catalogItem();
    const rates = laborAssumption(house);
    const pipeRates = plumbingLabor(house);
    const ghostCount = (house.electrical?.devices || []).filter((item) => item.ghost).length;
    const fixtureGhosts = (house.plumbing?.fixtures || []).filter((item) => item.ghost).length;
    const key = `${mode}|${tool}|${selection?.type || ""}|${selection?.id || ""}|${catalogId}|${roomShape}|${wallRatio}|${figureKind}|${guidesOn}|${deviceKind}|${pumpSupply}|${rates.perDevice}|${rates.panel}|${rates.perFoot}|${ghostCount}|${fixtureKind}|${fixtureGhosts}|${pipeRates.perFixture}|${house.plumbing?.supplyMethod || "manifold"}|${siteKind}|${siteGhosts.map((item) => item.kind).join(",")}|${house.site?.well?.kind || ""}|${house.site?.septic?.kind || ""}|${suggestNote}|${panelGhost ? "panel" : ""}|${suggestKind || ""}`;
    if (key === optionsKey && box.childElementCount) {
      box.querySelector("[data-warn]")?.replaceChildren(document.createTextNode(warnings[0]?.message || ""));
      return;
    }
    optionsKey = key;
    if (tool === "electrical") {
      paintElectricalOptions(box, rates);
      return;
    }
    if (tool === "plumbing") {
      paintPlumbingOptions(box, pipeRates);
      return;
    }
    if (tool === "site") {
      box.innerHTML = siteOptionsHtml(siteKind, siteGhosts);
      box.querySelectorAll("[data-site]").forEach((button) => {
        button.addEventListener("click", () => {
          siteKind = button.dataset.site;
          optionsKey = "";
          publish();
        });
      });
      box.querySelector("#suggest-site")?.addEventListener("click", startSiteSuggest);
      box.querySelector("#accept-all-site")?.addEventListener("click", () => acceptSiteGhosts(siteGhosts.map((item) => item.kind)));
      box.querySelectorAll("[data-accept-site]").forEach((button) => {
        button.addEventListener("click", () => acceptSiteGhosts([button.dataset.acceptSite]));
      });
      box.querySelectorAll("[data-skip-site]").forEach((button) => {
        button.addEventListener("click", () => skipSiteGhosts([button.dataset.skipSite]));
      });
      return;
    }
    if (tool === "scale") {
      const figure = scaleFigure(figureKind);
      const size = `${formatFeetFine(figure.width).construction} × ${formatFeetFine(figure.depth).construction}${figure.kind === "person" ? ", 5 ft 9 in tall" : ""}`;
      box.innerHTML = `
        <section class="opt-section">
          <p class="opt-label">Scale figure</p>
          <div class="swatch-row">${SCALE_FIGURES.map((item) => `<button type="button" class="chip" data-figure="${item.kind}" aria-pressed="${item.kind === figureKind}"><span aria-hidden="true">${item.icon}</span>${item.label}</button>`).join("")}</div>
          <p class="fine opt-hint">${figure.label}: ${size}. Click the plan or the 3D floor to drop one. They're only for judging size and don't count in the cost.</p>
        </section>`;
      return;
    }
    if (tool === "wall" || tool === "room") {
      const note = assemblyById[assemblyId]?.note || "";
      const isRoom = tool === "room";
      const shapes = isRoom ? ROOM_SHAPES : WALL_RATIOS;
      const current = isRoom ? roomShape : wallRatio;
      const chosen = shapeChoice(shapes, current);
      const hint = isRoom
        ? (chosen
          ? `Rooms you drag keep ${chosen.label === "Square" ? "a square shape" : `${chosen.label} (${chosen.value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} : 1)`}, measured inside the walls. Drag the long side and the short side follows.`
          : "Drag any size.")
        : (chosen
          ? (chosen.id === "1-1"
            ? "Start on a wall end. The new wall matches that wall's length."
            : `Start on a wall end. The new wall is ${chosen.label} × that wall, or that wall ÷ ${chosen.label}, whichever is nearer your cursor.`)
          : "Drag any length.");
      box.innerHTML = `
        <section class="opt-section">
          <p class="opt-label">Wall type</p>
          <div class="swatch-row">${assemblies.map((item) => `<button type="button" class="chip" data-assembly="${item.id}" aria-pressed="${item.id === assemblyId}"><span class="swatch" style="background:${item.swatch}"></span>${item.short}</button>`).join("")}
            <button type="button" class="info-btn" id="assembly-info" aria-expanded="false" aria-label="About this wall type">i</button>
          </div>
          <p id="assembly-note" class="info-note" hidden>${note}</p>
        </section>
        <section class="opt-section">
          <p class="opt-label">${isRoom ? "Shape" : "Length from the wall you start on"}</p>
          <div class="swatch-row" id="shape-row">${shapes.map((item) => `<button type="button" class="chip" data-shape="${item.id}" aria-pressed="${item.id === current}">${item.label}</button>`).join("")}</div>
          <p class="fine opt-hint">${hint}</p>
        </section>
        <button type="button" class="adv-toggle" id="advanced-toggle" aria-expanded="${advancedOn}" aria-controls="adv-shell"><span>More options</span><span class="chev" aria-hidden="true">›</span></button>
        <div class="adv-shell${advancedOn ? " is-open" : ""}" id="adv-shell">
          <div class="adv-inner">
            <div class="option-line">
              <label>Snap step <select id="grid-size"><option value="0.08333333333333333">1 in</option><option value="0.25">3 in</option><option value="0.5">6 in</option><option value="1">12 in</option></select></label>
              <button type="button" id="guides-toggle" class="chip" aria-pressed="${guidesOn}">Proportion guides</button>
            </div>
            <p class="fine opt-hint">Snap step is how far wall ends move when Snap to grid is on. Proportion guides outline the selected room's nearest ratio.</p>
          </div>
        </div>
        ${warnings[0]?.message ? `<p class="warn-line" data-warn>${warnings[0].message}</p>` : `<p class="warn-line" data-warn hidden></p>`}`;
      box.querySelector("#grid-size").value = String(grid);
      box.querySelector("#advanced-toggle")?.addEventListener("click", () => {
        // Open in place so the panel grows smoothly instead of being redrawn.
        advancedOn = !advancedOn;
        box.querySelector("#adv-shell")?.classList.toggle("is-open", advancedOn);
        box.querySelector("#advanced-toggle")?.setAttribute("aria-expanded", String(advancedOn));
      });
      return;
    }
    if (tool === "door" || tool === "window" || selection?.type === "opening") {
      let kind = tool === "window" ? "window" : "door";
      let selectedOpening = null;
      if (selection?.type === "opening") {
        const found = house.openings.find((item) => item.id === selection.id);
        if (tool !== "door" && tool !== "window") {
          selectedOpening = found;
          kind = found?.type === "window" ? "window" : "door";
        } else if (found?.type === tool) {
          selectedOpening = found;
          kind = tool;
        }
      }
      const draft = selectedOpening || { ...catalogItem(), ...(draftSize[kind] || {}) };
      const choices = catalogForTool(kind);
      const hint = selectedOpening
        ? `Selected ${kind}. Header ${selectedOpening.header?.label || "placeholder"}. ${selectedOpening.header?.note || ""}`
        : "Drag along a wall. The opening snaps and stays off the corners.";
      box.innerHTML = `
        <div class="swatch-row">${choices.map((item) => `<button type="button" class="chip" data-opening="${item.id}" aria-pressed="${item.id === (selectedOpening ? "" : catalogId)}">${item.name}</button>`).join("")}
          <button type="button" class="info-btn" id="assembly-info" aria-expanded="false" aria-label="About this opening">i</button>
        </div>
        <div class="option-line">
          <label>Width <input id="open-width" type="number" min="1" max="16" step="0.5" value="${draft.width}" /> ft</label>
          <label>Height <input id="open-height" type="number" min="1" max="10" step="0.1" value="${draft.height}" /> ft</label>
          ${kind === "window" ? `<label>Sill <input id="open-sill" type="number" min="0" max="8" step="0.1" value="${draft.sill || 0}" /> ft</label>` : ""}
          <span class="opening-preview" aria-hidden="true"><span style="width:${Math.min(80, draft.width * 8)}%"></span></span>
        </div>
        <p id="assembly-note" class="info-note" hidden>${hint}</p>
        ${warnings[0]?.message ? `<p class="warn-line" data-warn>${warnings[0].message}</p>` : `<p class="warn-line" data-warn hidden></p>`}`;
      return;
    }
    box.innerHTML = `<p class="fine">Drag a wall handle and it follows the cursor. Snap to grid lines it up. Tidy up shape squares the selection.</p>`;
  }

  function onHudClick(event) {
    const assembly = event.target.closest("button[data-assembly]");
    if (assembly) {
      assemblyId = assembly.dataset.assembly;
      assemblyExplicit = true;
      optionsKey = "";
      if (selection?.type === "wall") commit(syncRooms(setWallAssembly(house, selection.id, assemblyId)));
      publish();
      return;
    }
    const opening = event.target.closest("button[data-opening]");
    if (opening) {
      catalogId = opening.dataset.opening;
      const item = openingItems.find((entry) => entry.id === catalogId);
      tool = item.type === "window" ? "window" : "door";
      draftSize[item.type] = { width: item.width, height: item.height, sill: item.sill || 0 };
      optionsKey = "";
      publish();
      return;
    }
    const info = event.target.closest("#assembly-info");
    if (info) {
      const note = document.querySelector("#assembly-note");
      if (note) {
        note.hidden = !note.hidden;
        info.setAttribute("aria-expanded", String(!note.hidden));
      }
      return;
    }
    if (event.target.closest("#snap-toggle")) {
      snapOn = !snapOn;
      paintSnapButton();
      announce(snapOn
        ? `Snap to grid is on. Ends line up to ${snapInches()}, to a nearby wall, or to a square corner. Hold Shift to snap for one drag.`
        : "Snap is off. The wall end follows your cursor.", false);
      return;
    }
    if (event.target.closest("#tidy-shape")) {
      tidySelection();
      return;
    }
    const figureButton = event.target.closest("button[data-figure]");
    if (figureButton) {
      figureKind = figureButton.dataset.figure;
      optionsKey = "";
      publish();
      return;
    }
    const shape = event.target.closest("button[data-shape]");
    if (shape) {
      const list = tool === "room" ? ROOM_SHAPES : WALL_RATIOS;
      const item = list.find((entry) => entry.id === shape.dataset.shape);
      if (tool === "room") roomShape = shape.dataset.shape;
      else wallRatio = shape.dataset.shape;
      optionsKey = "";
      publish();
      if (item) {
        const text = item.id === "free"
          ? (tool === "room" ? "Rooms are free size again." : "Walls are free length again.")
          : (tool === "room" ? `Rooms now keep ${item.label}.` : `New walls now use ${item.label} from the wall they start on.`);
        announce(text, false);
      }
      return;
    }
    if (event.target.closest("#guides-toggle")) {
      guidesOn = !guidesOn;
      optionsKey = "";
      publish();
    }
  }

  function paintSnapButton() {
    const button = document.querySelector("#snap-toggle");
    if (!button) return;
    button.setAttribute("aria-pressed", String(snapOn || shiftHeld));
  }

  function tidySelection() {
    const ids = new Set();
    for (const pick of picks) {
      if (pick.type === "wall") ids.add(pick.id);
      if (pick.type === "room") {
        const room = (house.rooms || []).find((item) => item.id === pick.id);
        for (const id of wallsTouchingRoom(house, room)) ids.add(id);
      }
    }
    if (!ids.size) {
      announce("Select a wall or a room, then tidy the shape.", false);
      return;
    }
    const changed = commit(syncRooms(tidyHouse(house, [...ids])), house, "tidying the shape");
    if (!changed) announce("Those walls are already tidy.", false);
    else announce("Tidied the shape. Lengths use 3 inch steps, and near-square corners are square.");
  }

  function readOpeningFields() {
    const width = Number(document.querySelector("#open-width")?.value);
    const height = Number(document.querySelector("#open-height")?.value);
    const sillField = document.querySelector("#open-sill");
    const sill = sillField ? Number(sillField.value) : 0;
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height, sill };
  }

  function onHudChange(event) {
    if (event.target.id === "grid-size") grid = Number(event.target.value);
    if (event.target.id === "open-width" || event.target.id === "open-height" || event.target.id === "open-sill") {
      applyOpeningFields();
    }
    publish();
  }

  function onHudInput(event) {
    if (event.target.id !== "open-width" && event.target.id !== "open-height" && event.target.id !== "open-sill") return;
    const fields = readOpeningFields();
    if (!fields) return;
    const kind = tool === "window" || (selection?.type === "opening" && house.openings.find((item) => item.id === selection.id)?.type === "window")
      ? "window"
      : "door";
    draftSize[kind] = fields;
    const preview = document.querySelector(".opening-preview span");
    if (preview) preview.style.width = `${Math.min(80, fields.width * 8)}%`;
    if (hoverPlace) plan.setOverlay(makeOverlay());
  }

  function applyOpeningFields() {
    const fields = readOpeningFields();
    if (!fields) return;
    if (selection?.type === "opening") {
      const result = resizeOpening(house, selection.id, fields);
      if (result.warnings.length) warnings = result.warnings;
      else commit(result.house);
      return;
    }
    const kind = tool === "window" ? "window" : "door";
    draftSize[kind] = fields;
  }

  function syncSelectionLayout() {
    const panel = document.querySelector("#layer-panel");
    const fold = document.querySelector("#layer-fold");
    const showing = !inspector.hidden;
    panel.classList.toggle("showing-selection", showing);
    const key = !showing
      ? ""
      : picks.length > 1
        ? `multi:${picks.map((item) => `${item.type}:${item.id}`).join("|")}`
        : `${selection?.type}:${selection?.id}`;
    // The selection card is its own glass card now, so the layer list stays open.
    // Hide it with the panel's Layers button instead.
    fold.open = true;
    foldedFor = showing ? key : "";
    document.dispatchEvent(new CustomEvent("house-selection", { detail: { showing } }));
  }

  function startSuggest(kind) {
    suggestKind = kind;
    suggestPreview = null;
    optionsOpen = true;
    optionsKey = "";
    const note = suggestionNote(house);
    if (note) {
      suggestNote = note;
      panelGhost = null;
      announce(note, false);
      publish();
      return;
    }
    const next = cloneHouse(house);
    let committed = false;
    let shown = 0;
    if (kind === "electrical") {
      const ghosts = suggestPlacements(next);
      next.electrical.devices = next.electrical.devices.filter((item) => !item.ghost);
      next.electrical.devices.push(...ghosts);
      const rawPanel = suggestPanel(next);
      const panelPreview = rawPanel ? previewPlacement(next, rawPanel, { system: "electrical", kind: "panel" }) : null;
      panelGhost = panelPreview?.ok ? { ...panelPreview, kind: "panel" } : null;
      shown = ghosts.length + (panelGhost ? 1 : 0);
      suggestNote = shown ? "" : (ghosts.note || "Nothing new to suggest.");
      if (ghosts.length) {
        commit(next);
        committed = true;
      }
    } else {
      const ghosts = suggestFixtures(next);
      next.plumbing.fixtures = next.plumbing.fixtures.filter((item) => !item.ghost);
      next.plumbing.fixtures.push(...ghosts);
      panelGhost = null;
      shown = ghosts.length;
      suggestNote = shown ? "" : (ghosts.note || "Nothing new to suggest.");
      if (ghosts.length) {
        commit(next);
        committed = true;
      }
    }
    announce(suggestNote || `Showing ${shown} suggestions. Accept the ones you want.`, committed);
    publish();
  }

  function acceptPanelGhost(announceIt = true) {
    if (!panelGhost) return;
    const next = cloneHouse(house);
    next.electrical.panel = {
      id: "panel-main",
      x: panelGhost.x,
      y: panelGhost.y,
      wallId: panelGhost.wallId,
      offset: panelGhost.offset,
      height: 5,
      phase: panelGhost.phase || "phase1",
    };
    panelGhost = null;
    choose({ type: "panel", id: "panel" });
    commit(next);
    if (announceIt) announce("Placed breaker panel from the suggestion.");
  }

  function acceptAllSuggestions() {
    const next = cloneHouse(house);
    if (suggestKind === "electrical") {
      next.electrical.devices = next.electrical.devices.map((item) => (item.ghost ? { ...item, ghost: false } : item));
      if (panelGhost) {
        next.electrical.panel = {
          id: "panel-main",
          x: panelGhost.x,
          y: panelGhost.y,
          wallId: panelGhost.wallId,
          offset: panelGhost.offset,
          height: 5,
          phase: panelGhost.phase || "phase1",
        };
        panelGhost = null;
      }
    } else {
      next.plumbing.fixtures = next.plumbing.fixtures.map((item) => (item.ghost ? { ...item, ghost: false } : item));
    }
    suggestKind = null;
    suggestNote = "";
    commit(next);
    announce("Accepted the suggestions.");
  }

  function nearRing(point, ring, limit) {
    if (!point || !(ring || []).length) return false;
    if (pointInRing(point, ring)) return true;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[j];
      const b = ring[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      if (Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)) <= limit) return true;
    }
    return false;
  }

  function issuesForRoom(room) {
    const ring = room.polygon || [];
    const wallIds = new Set((house.walls || []).filter((wall) => {
      const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
      return nearRing(mid, ring, (wall.thickness || 1) + 0.8);
    }).map((wall) => wall.id));
    const rank = { blocker: 0, warning: 1, tip: 2 };
    return warnings.filter((item) => {
      if (item.target?.type === "room" && item.target.id === room.id) return true;
      if (item.target?.type === "wall" && wallIds.has(item.target.id)) return true;
      return !!(item.point && nearRing(item.point, ring, 1.5));
    }).sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1));
  }

  function showFinding(finding) {
    if (!finding) return;
    const point = finding.point;
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      plan.focus(point.x, point.y);
      model.focus?.(point.x, point.y);
    }
    if (finding.target?.type && finding.target.type !== "house" && finding.target.id) {
      choose({ type: finding.target.type, id: finding.target.id });
    } else if (point) {
      const room = (house.rooms || []).find((item) => inside(point, item.polygon || []));
      if (room) choose({ type: "room", id: room.id });
    }
    const how = finding.fix?.explain || "Select the highlighted item and change it with the tool named on its card.";
    announce(`${finding.title}. ${finding.why || ""} How to fix it: ${how}`, false);
    publish();
  }

  function runFindingFix(finding) {
    if (!finding) return;
    if (!finding.fix?.id || finding.fix.id === "show-wall") {
      showFinding(finding);
      return;
    }
    if (finding.fix.id === "guide-door") {
      tool = "door";
      optionsOpen = true;
      optionsKey = "";
      document.dispatchEvent(new CustomEvent("prefer-place"));
      announce(finding.fix.explain || "Door tool. Click a wall to add a door.", false);
      publish();
      return;
    }
    if (finding.fix.id === "guide-outlets") {
      startSuggest("electrical");
      return;
    }
    const next = applyFix(house, finding);
    if (!next) {
      showFinding(finding);
      return;
    }
    const result = finding.fix.result || finding.fix.explain || finding.title;
    commit(next, null, finding.fix.undo || result);
    announce(result);
    publish();
  }

  function bindFindingFixes(box) {
    box.querySelectorAll("[data-fix-finding]").forEach((button) => {
      button.addEventListener("click", () => {
        runFindingFix(warnings.find((item) => item.id === button.dataset.fixFinding));
      });
    });
  }

  function setSuggestPreview(id) {
    suggestPreview = id || null;
    const overlay = makeOverlay();
    plan.setOverlay(overlay);
    model.setOverlay?.(overlay);
    document.querySelectorAll("[data-preview-id]").forEach((row) => {
      row.classList.toggle("is-preview", row.dataset.previewId === suggestPreview);
    });
  }

  function suggestHtml() {
    const items = suggestKind === "electrical"
      ? (house.electrical?.devices || []).filter((item) => item.ghost)
      : suggestKind === "plumbing"
        ? (house.plumbing?.fixtures || []).filter((item) => item.ghost)
        : [];
    const groups = groupByRoom(items, house.rooms);
    const panelRow = panelGhost
      ? `<div class="suggest-row${suggestPreview === "panel" ? " is-preview" : ""}" data-preview-id="panel"><button type="button" class="suggest-label">Breaker panel</button><button type="button" class="hud-pill" data-accept-panel>Accept</button><button type="button" class="hud-pill" data-skip-panel>Skip</button></div>`
      : "";
    if (!groups.length && !panelRow) return `<p class="fine">${escapeAttr(suggestNote || "Nothing new to suggest.")}</p>`;
    return `<div class="suggest-list">
      <div class="suggest-head"><strong>Suggestions</strong><button type="button" class="hud-pill pill-primary" data-accept-all>Accept all</button></div>
      ${panelRow}
      ${groups.map((group) => {
        const label = groups.length > 1 ? `${group.name} · ${group.label}` : group.label;
        return `<div class="suggest-row${suggestPreview === group.id ? " is-preview" : ""}" data-preview-id="${escapeAttr(group.id)}"><button type="button" class="suggest-label">${escapeAttr(label)}</button>
        <button type="button" class="hud-pill" data-accept-room="${escapeAttr(group.id)}">Accept</button>
        <button type="button" class="hud-pill" data-skip-room="${escapeAttr(group.id)}">Skip</button></div>`;
      }).join("")}
      ${suggestNote ? `<p class="fine">${escapeAttr(suggestNote)}</p>` : ""}
    </div>`;
  }

  function bindSuggest(box) {
    box.querySelectorAll("[data-accept-room]").forEach((button) => {
      button.addEventListener("click", () => acceptSuggestRoom(button.dataset.acceptRoom));
    });
    box.querySelectorAll("[data-skip-room]").forEach((button) => {
      button.addEventListener("click", () => skipSuggestRoom(button.dataset.skipRoom));
    });
    box.querySelectorAll("[data-accept-all]").forEach((button) => {
      button.addEventListener("click", acceptAllSuggestions);
    });
    box.querySelectorAll("[data-accept-panel]").forEach((button) => {
      button.addEventListener("click", () => acceptPanelGhost());
    });
    box.querySelectorAll("[data-skip-panel]").forEach((button) => {
      button.addEventListener("click", () => {
        panelGhost = null;
        optionsKey = "";
        announce("Skipped the breaker panel.", false);
        publish();
      });
    });
    box.querySelectorAll("[data-preview-id]").forEach((row) => {
      const id = row.dataset.previewId;
      row.addEventListener("pointerenter", () => setSuggestPreview(id));
      row.addEventListener("pointerleave", (event) => {
        if (row.contains(event.relatedTarget)) return;
        if (suggestPreview === id) setSuggestPreview(null);
      });
      row.querySelector(".suggest-label")?.addEventListener("click", () => {
        setSuggestPreview(suggestPreview === id ? null : id);
      });
    });
  }

  function acceptSuggestRoom(roomId) {
    const next = cloneHouse(house);
    const list = suggestKind === "electrical" ? next.electrical.devices : next.plumbing.fixtures;
    for (const item of list) {
      if (item.ghost && item.roomId === roomId) item.ghost = false;
    }
    commit(next);
    publish();
  }

  function skipSuggestRoom(roomId) {
    const next = cloneHouse(house);
    if (suggestKind === "electrical") {
      next.electrical.devices = next.electrical.devices.filter((item) => !(item.ghost && item.roomId === roomId));
    } else {
      next.plumbing.fixtures = next.plumbing.fixtures.filter((item) => !(item.ghost && item.roomId === roomId));
    }
    commit(next);
    publish();
  }

  function paintPlumbingOptions(box, rates) {
    const groups = [...new Set(FIXTURE_OPTIONS.map((item) => item.group))];
    const options = groups.map((group) => `<optgroup label="${group}">${FIXTURE_OPTIONS.filter((item) => item.group === group).map((item) => `<option value="${item.id}" ${item.id === fixtureKind ? "selected" : ""}>${item.label}</option>`).join("")}</optgroup>`).join("");
    const spec = fixtureKind === "entry" ? null : fixtureSpec(fixtureKind);
    box.innerHTML = `
      <div class="option-line">
        <label>Place <select id="fixture-kind" class="pill-select">${options}</select></label>
        <button type="button" class="hud-pill" id="suggest-fixtures">Suggest placements</button>
      </div>
      <p class="fine">${escapeAttr(spec?.name || "Click the water entry, where the main shutoff goes.")} Pipe stays out of hempcrete and rammed earth. An exterior wall can take a furred chase. A plumber and the inspector need to confirm that.</p>
      ${suggestKind === "plumbing" ? suggestHtml() : ""}`;
    box.querySelector("#fixture-kind").addEventListener("change", (event) => {
      fixtureKind = event.target.value;
      publish();
    });
    box.querySelector("#suggest-fixtures").addEventListener("click", () => startSuggest("plumbing"));
    box.querySelector("#accept-fixtures")?.addEventListener("click", () => acceptFixtures());
    box.querySelector("#dismiss-fixtures")?.addEventListener("click", () => dismissFixtures());
    bindSuggest(box);
  }

  function acceptFixtures(onlyId = null) {
    const next = cloneHouse(house);
    next.plumbing.fixtures = next.plumbing.fixtures.map((item) => {
      if (!item.ghost) return item;
      if (onlyId && item.id !== onlyId) return item;
      return { ...item, ghost: false };
    });
    if (onlyId) choose({ type: "fixture", id: onlyId });
    commit(next);
    publish();
  }

  function dismissFixtures(onlyId = null) {
    const next = cloneHouse(house);
    next.plumbing.fixtures = next.plumbing.fixtures.filter((item) => !item.ghost || (onlyId && item.id !== onlyId));
    if (onlyId && selection?.id === onlyId) choose(null);
    commit(next);
    publish();
  }

  function paintElectricalOptions(box, rates) {
    const groups = [...new Set(PLACE_OPTIONS.map((item) => item.group))];
    const options = groups.map((group) => `<optgroup label="${group}">${PLACE_OPTIONS.filter((item) => item.group === group).map((item) => `<option value="${item.id}" ${item.id === deviceKind ? "selected" : ""}>${item.label}</option>`).join("")}</optgroup>`).join("");
    const spec = deviceKind === "panel" ? null : deviceSpec(deviceKind, pumpSupply);
    box.innerHTML = `
      <div class="option-line">
        <label>Place <select id="device-kind" class="pill-select">${options}</select></label>
        ${deviceKind === "well-pump" ? `<label>Supply <select id="pump-supply" class="pill-select"><option value="240" ${pumpSupply === "240" ? "selected" : ""}>240V</option><option value="120" ${pumpSupply === "120" ? "selected" : ""}>120V</option></select></label>` : ""}
        <button type="button" class="hud-pill" id="suggest-outlets">Suggest placements</button>
      </div>
      <p class="fine" title="Outlets: wires run in a pipe (conduit) on these walls instead of being buried in hempcrete or rammed earth. Your electrician and inspector will confirm.">${deviceKind === "receptacle" || deviceKind === "gfci" || deviceKind === "wr-receptacle" ? "Outlets: wires run in a pipe (conduit) on these walls instead of being buried in hempcrete or rammed earth. Your electrician and inspector will confirm." : escapeAttr(spec?.note || "Click a wall to place this. On hempcrete and rammed earth the wire runs in a pipe (conduit). Your electrician and inspector will confirm.")}</p>
      ${suggestKind === "electrical" ? suggestHtml() : ""}`;
    box.querySelector("#device-kind").addEventListener("change", (event) => {
      deviceKind = event.target.value;
      publish();
    });
    box.querySelector("#pump-supply")?.addEventListener("change", (event) => {
      pumpSupply = event.target.value;
      publish();
    });
    box.querySelector("#suggest-outlets").addEventListener("click", () => startSuggest("electrical"));
    box.querySelector("#accept-ghosts")?.addEventListener("click", () => acceptGhosts());
    box.querySelector("#dismiss-ghosts")?.addEventListener("click", () => dismissGhosts());
    bindSuggest(box);
  }

  function acceptGhosts(onlyId = null) {
    const next = cloneHouse(house);
    next.electrical.devices = next.electrical.devices.map((item) => {
      if (!item.ghost) return item;
      if (onlyId && item.id !== onlyId) return item;
      return { ...item, ghost: false };
    });
    if (onlyId) choose({ type: "device", id: onlyId });
    commit(next);
    publish();
  }

  function dismissGhosts(onlyId = null) {
    const next = cloneHouse(house);
    next.electrical.devices = next.electrical.devices.filter((item) => !item.ghost || (onlyId && item.id !== onlyId));
    if (onlyId && selection?.id === onlyId) choose(null);
    commit(next);
    publish();
  }

  function paintDeviceInspector() {
    if (selection.type === "panel") {
      const panel = house.electrical?.panel;
      if (!panel) {
        inspector.hidden = true;
        inspector.innerHTML = "";
        return;
      }
      const design = buildElectrical(house);
      const spaces = design.circuits.reduce((sum, circuit) => sum + circuit.breakerPoles, 0);
      inspector.innerHTML = `
        <h2>Main panel</h2>
        <p>Load calc recommends ${design.load.service}A. ${spaces} breaker spaces are used.</p>
        <p class="fine">${escapeAttr(design.load.adoption)}</p>
        <label>Height, feet <input id="device-height" type="number" min="0" max="10" step="0.25" value="${panel.height || 5}" /></label>
        <button type="button" id="suggest-outlets">Suggest placements</button>
        ${suggestKind === "electrical" || suggestNote ? suggestHtml() : ""}
        <button type="button" id="edit-delete">Delete panel</button>`;
      inspector.querySelector("#device-height").addEventListener("change", (event) => {
        const next = cloneHouse(house);
        next.electrical.panel.height = Number(event.target.value);
        commit(next);
        publish();
      });
      inspector.querySelector("#suggest-outlets").addEventListener("click", () => startSuggest("electrical"));
      inspector.querySelector("#edit-delete").addEventListener("click", eraseSelection);
      bindSuggest(inspector);
      return;
    }
    const device = (house.electrical?.devices || []).find((item) => item.id === selection.id);
    if (!device) {
      inspector.hidden = true;
      inspector.innerHTML = "";
      return;
    }
    const design = buildElectrical(house);
    const circuit = design.circuits.find((item) => item.deviceIds.includes(device.id));
    const warningsForDevice = warnings.filter((item) => item.target?.type === "device" && item.target.id === device.id && item.citation);
    const groups = [...new Set(PLACE_OPTIONS.filter((item) => item.id !== "panel").map((item) => item.group))];
    const options = groups.map((group) => `<optgroup label="${group}">${PLACE_OPTIONS.filter((item) => item.group === group && item.id !== "panel").map((item) => `<option value="${item.id}" ${item.id === device.kind ? "selected" : ""}>${item.label}</option>`).join("")}</optgroup>`).join("");
    const spec = deviceSpec(device.kind, device.supply);
    const wall = house.walls.find((item) => item.id === device.wallId);
    inspector.innerHTML = `
      ${gameHead(device.ghost ? `Suggested ${plainPlaceLabel(device.kind)}` : plainPlaceLabel(device.kind), warningsForDevice)}
      ${circuit ? `<p class="fine" title="${escapeAttr(DROP_WHY)}">${escapeAttr(plainCircuitLine(circuit))}</p>` : ""}
      ${statTiles([
        circuit ? { icon: "A", value: `${circuit.amps}A`, label: "Breaker", title: "The switch in the panel that protects this wire." } : { icon: "A", value: "—", label: "Breaker", title: "The switch in the panel that protects this wire." },
        circuit ? { icon: "%", value: `${circuit.voltageDrop.percent}%`, label: "Wire loss", title: DROP_WHY } : null,
        circuit ? { icon: "↔", value: `${circuit.length} ft`, label: "Wire length", title: "How far the wire runs from the panel to this outlet." } : null,
      ])}
      ${device.ghost ? `<p>Suggested. Accept keeps it.</p>
        <button type="button" id="accept-one">Accept</button>
        <button type="button" id="dismiss-one">Skip</button>` : ""}
      ${issueCards(warningsForDevice)}
      <label>Device <select id="device-kind">${options}</select></label>
      ${device.kind === "well-pump" ? `<label>Supply <select id="pump-supply"><option value="240" ${device.supply !== "120" ? "selected" : ""}>240V · 20A</option><option value="120" ${device.supply === "120" ? "selected" : ""}>120V · 20A</option></select></label>` : ""}
      <label>Height, feet <input id="device-height" type="number" min="0" max="12" step="0.25" value="${device.height}" /></label>
      ${device.ghost ? "" : deviceCostHtml(house, device)}
      ${circuit ? `<details class="tech"><summary>Technical details</summary><p>Circuit ${circuit.number} · ${escapeAttr(circuit.name)}${circuit.gfci ? " · GFCI" : ""}${circuit.afci ? " · AFCI" : ""}. ${escapeAttr(spec.note || "")}</p></details>` : `<p class="fine">${escapeAttr(spec.note || "")}</p>`}
      ${quietDelete("Delete device")}`;
    inspector.querySelector("#accept-one")?.addEventListener("click", () => acceptGhosts(device.id));
    inspector.querySelector("#dismiss-one")?.addEventListener("click", () => dismissGhosts(device.id));
    inspector.querySelector("#device-kind").addEventListener("change", (event) => {
      const next = cloneHouse(house);
      const target = next.electrical.devices.find((item) => item.id === device.id);
      const supply = target.kind === "well-pump" ? target.supply : pumpSupply;
      Object.assign(target, applyDeviceKind(target, event.target.value, supply));
      commit(next);
      publish();
    });
    inspector.querySelector("#pump-supply")?.addEventListener("change", (event) => {
      const next = cloneHouse(house);
      const target = next.electrical.devices.find((item) => item.id === device.id);
      Object.assign(target, applyDeviceKind(target, "well-pump", event.target.value));
      commit(next);
      publish();
    });
    inspector.querySelector("#device-height").addEventListener("change", (event) => {
      const next = cloneHouse(house);
      next.electrical.devices.find((item) => item.id === device.id).height = Number(event.target.value);
      commit(next);
      publish();
    });
    inspector.querySelector("#suggest-outlets")?.addEventListener("click", () => startSuggest("electrical"));
    inspector.querySelector("#edit-delete").addEventListener("click", eraseSelection);
    inspector.querySelectorAll("[data-method]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!device.wallId) return;
        const next = cloneHouse(house);
        next.electrical.wallMethods[device.wallId] = button.dataset.method;
        commit(next);
        publish();
      });
    });
  }

  function paintFixtureInspector() {
    if (selection.type === "entry") {
      const entry = house.plumbing?.entry;
      if (!entry) {
        inspector.hidden = true;
        inspector.innerHTML = "";
        return;
      }
      const well = (house.electrical?.devices || []).find((item) => !item.ghost && item.kind === "well-pump");
      inspector.innerHTML = `
        <h2>Water entry</h2>
        <p>Main shutoff. ${well ? "Tied to the stage 5 well-pump circuit." : "No well-pump circuit yet. Place one in Electrical. The pressure tank is a hook until the well is sited."}</p>
        <p class="fine">The well and the septic tank are later. This point is where the water comes into the house.</p>
        <button type="button" id="suggest-fixtures">Suggest placements</button>
        <button type="button" id="edit-delete">Delete entry</button>`;
      inspector.querySelector("#suggest-fixtures").addEventListener("click", () => startSuggest("plumbing"));
      inspector.querySelector("#edit-delete").addEventListener("click", eraseSelection);
      return;
    }
    const fixture = (house.plumbing?.fixtures || []).find((item) => item.id === selection.id);
    if (!fixture) {
      inspector.hidden = true;
      inspector.innerHTML = "";
      return;
    }
    const spec = fixtureSpec(fixture.kind);
    const warningsForFixture = warnings.filter((item) => item.target?.type === "fixture" && item.target.id === fixture.id && item.citation);
    const wall = house.walls.find((item) => item.id === fixture.wallId);
    const mass = wall && (wall.assemblyId || "").match(/hemp|rammed/);
    const design = buildPlumbing(house);
    const arm = design.dwv.find((item) => item.fixtureId === fixture.id);
    inspector.innerHTML = `
      ${gameHead(fixture.ghost ? `Suggested ${spec.name}` : spec.name, warningsForFixture)}
      ${statTiles([
        arm ? { icon: "⌀", value: `${arm.size} in`, label: "Drain" } : null,
        { icon: "↘", value: `${design.building.slope?.inchesPerFoot ?? "—"} in/ft`, label: "Slope" },
        arm ? { icon: "↔", value: `${arm.length} ft`, label: "Length" } : null,
        { icon: "↓", value: `${design.building.slope?.inches ?? "—"} in`, label: "Drop at septic" },
      ])}
      ${fixture.ghost ? `<p>Suggested. Accept keeps it.</p>
        <button type="button" id="accept-one">Accept</button>
        <button type="button" id="dismiss-one">Skip</button>` : ""}
      ${issueCards(warningsForFixture, mass ? `<button type="button" id="toggle-chase">${fixture.chase ? "Chase added" : "Add a furred chase"}</button>` : "")}
      ${fixture.ghost ? "" : fixtureCostHtml(house, fixture)}
      ${quietDelete("Delete fixture")}`;
    inspector.querySelector("#accept-one")?.addEventListener("click", () => acceptFixtures(fixture.id));
    inspector.querySelector("#dismiss-one")?.addEventListener("click", () => dismissFixtures(fixture.id));
    inspector.querySelector("#toggle-chase")?.addEventListener("click", () => {
      const next = cloneHouse(house);
      const target = next.plumbing.fixtures.find((item) => item.id === fixture.id);
      target.chase = !target.chase;
      commit(next);
      publish();
    });
    inspector.querySelectorAll("[data-supply]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = cloneHouse(house);
        next.plumbing.supplyMethod = button.dataset.supply;
        commit(next);
        publish();
      });
    });
    inspector.querySelectorAll("[data-heater]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = cloneHouse(house);
        const target = next.plumbing.fixtures.find((item) => item.id === fixture.id);
        target.heaterType = button.dataset.heater;
        commit(next);
        publish();
      });
    });
    inspector.querySelector("#suggest-fixtures")?.addEventListener("click", () => startSuggest("plumbing"));
    inspector.querySelector("#edit-delete").addEventListener("click", eraseSelection);
  }

  function paintInspector() {
    const active = document.activeElement;
    if (active && (active.id === "wall-length" || active.id === "wall-angle") && inspector.contains(active)) return;
    if (mode !== "build" || !picks.length) {
      inspector.hidden = true;
      inspector.innerHTML = "";
      syncSelectionLayout();
      return;
    }
    inspector.hidden = false;
    if (picks.length > 1) {
      inspector.innerHTML = `
        <header class="game-head"><h2>${picks.length} items selected</h2></header>
        <p>Shift-click adds or removes one. Drag a box to choose more.</p>
        ${quietDelete("Delete selected")}
      `;
      inspector.querySelector("#edit-delete").addEventListener("click", eraseSelection);
      syncSelectionLayout();
      return;
    }
    if (selection.type === "wall") {
      const wall = house.walls.find((item) => item.id === selection.id);
      if (!wall) { inspector.hidden = true; syncSelectionLayout(); return; }
      const assembly = assemblyById[wall.assemblyId];
      const detail = formatFeetFine(wallLength(wall));
      const info = describeWall(wall.start, wall.end, house, wall.id);
      const joinLine = info.joinAngle == null
        ? "0° points east. The angle turns counterclockwise."
        : `${Math.round(info.joinAngle)}° from the wall it meets. 0° points east. The angle turns counterclockwise.`;
      const linked = (house.constraints || []).find((item) => item.targetId === wall.id);
      const readout = linked && constraintReadout(house, linked, house.customRatios || []);
      const ratioOptions = ratioLibrary.map((ratio) => `<option value="${ratio.id}">${ratio.name}</option>`).join("");
      const wallOptions = house.walls
        .filter((item) => item.id !== wall.id)
        .map((item) => `<option value="${item.id}">${item.id} · ${formatFeetFine(wallLength(item)).construction}</option>`)
        .join("");
      inspector.innerHTML = `
        ${gameHead("Wall", warnings.filter((item) => item.target?.id === wall.id))}
        ${statTiles([
          { icon: "↔", value: plainFeet(detail.roundedFeet), label: "Length" },
          { icon: "∠", value: formatHeading(info.angle), label: "Angle" },
          { icon: "↕", value: `${wall.height} ft`, label: "Height" },
          { icon: "▭", value: assembly?.short || wall.assembly, label: "Assembly" },
        ])}
        <label>Length <input id="wall-length" value="${escapeAttr(plainFeet(info.length))}" autocomplete="off" /></label>
        <label>Angle (°) <input id="wall-angle" value="${escapeAttr(formatHeading(info.angle).replace("°", ""))}" autocomplete="off" /></label>
        <p class="fine">${escapeHtml(joinLine)}</p>
        <button type="button" id="set-wall-measure">Set length and angle</button>
        <p class="fine">${assembly?.note || ""}</p>
        ${linked ? `<p>Proportion: ${readout?.badge || "linked"}${readout?.exact ? " · exact" : ""}</p><button type="button" id="unlink">Unlink</button>` : `
          <label>Proportion <select id="prop-op"><option value="multiply">×</option><option value="divide">÷</option></select>
            <select id="prop-ratio">${ratioOptions}<option value="custom">Custom</option></select></label>
          <label>of <select id="prop-ref">${wallOptions}</select></label>
          <label>Custom <input id="custom-value" type="number" min="0.05" step="0.001" value="1.5" /></label>
          <button type="button" id="link-proportion">Set proportion</button>`}
        <label>Phase
          <select id="edit-phase">
            <option value="phase1" ${wall.phase === "phase1" ? "selected" : ""}>Phase 1</option>
            <option value="future" ${wall.phase === "future" ? "selected" : ""}>Later</option>
          </select>
        </label>
        <label>Wiring method
          <select id="wire-method">
            <option value="stud-bay" ${wallMethod(house, wall) === "stud-bay" ? "selected" : ""}>Stud bay</option>
            <option value="conduit" ${wallMethod(house, wall) === "conduit" ? "selected" : ""}>Wire in a pipe (conduit)</option>
            <option value="raceway" ${wallMethod(house, wall) === "raceway" ? "selected" : ""}>Surface raceway</option>
          </select>
        </label>
        <p class="fine">Outlets: wires run in a pipe (conduit) on these walls instead of being buried in hempcrete or rammed earth. Your electrician and inspector will confirm.</p>
        ${selectionCostHtml(house, selection)}
        ${quietDelete("Delete wall")}
      `;
      const applyFromInspector = () => {
        const lengthInput = inspector.querySelector("#wall-length");
        const angleInput = inspector.querySelector("#wall-angle");
        const length = parseLength(lengthInput.value);
        const angle = parseAngle(angleInput.value);
        const live = measureTarget();
        const target = live?.kind === "wall" && live.id === wall.id
          ? live
          : { kind: "wall", id: wall.id, endName: freeEndName(wall, house), baseline: null };
        lengthInput.blur();
        angleInput.blur();
        commitWallMeasure(length, angle, target);
      };
      inspector.querySelector("#set-wall-measure")?.addEventListener("click", applyFromInspector);
      for (const field of ["#wall-length", "#wall-angle"]) {
        inspector.querySelector(field)?.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          applyFromInspector();
        });
      }
      inspector.querySelector("#unlink")?.addEventListener("click", () => {
        commit(unlink(house, wall.id));
        publish();
      });
      inspector.querySelector("#link-proportion")?.addEventListener("click", () => {
        const ratioId = inspector.querySelector("#prop-ratio").value;
        const referenceId = inspector.querySelector("#prop-ref").value;
        const operation = inspector.querySelector("#prop-op").value;
        const customValue = Number(inspector.querySelector("#custom-value").value);
        if (!referenceId) return;
        let next = house;
        if (ratioId === "custom") {
          next = cloneHouse(house);
          next.customRatios = [{ id: "custom-1", name: "Custom", value: customValue, symbol: String(customValue) }];
        }
        commit(linkWall(next, wall.id, referenceId, ratioId === "custom" ? "custom" : ratioId, operation, customValue));
        publish();
      });
      inspector.querySelector("#edit-phase").addEventListener("change", (event) => {
        const next = cloneHouse(house);
        const target = next.walls.find((item) => item.id === wall.id);
        target.phase = event.target.value;
        commit(next);
        publish();
      });
      inspector.querySelector("#wire-method").addEventListener("change", (event) => {
        const next = cloneHouse(house);
        next.electrical.wallMethods[wall.id] = event.target.value;
        commit(next);
        publish();
      });
    } else if (selection.type === "furniture" || selection.type === "siteFeature" || selection.type === "planLabel") {
      paintPieceInspector();
      syncSelectionLayout();
      return;
    } else if (selection.type === "room") {
      const room = house.rooms.find((item) => item.id === selection.id);
      if (!room) { inspector.hidden = true; syncSelectionLayout(); return; }
      if (areaKind(room) === "study" || areaKind(room) === "site") {
        const title = areaKind(room) === "study" ? (room.name || "Study") : (room.name || "Site");
        inspector.innerHTML = `
          ${gameHead(title, [])}
          <p>This is a drawing on the plan. It is not a room that gets built. Drag it to move it.</p>
          ${quietDelete("Delete drawing")}
        `;
        inspector.querySelector("#edit-delete").addEventListener("click", eraseSelection);
        syncSelectionLayout();
        return;
      }
      const proportion = roomProportion(room, house.customRatios || []);
      const ratioOptions = ratioLibrary.map((ratio) => `<option value="${ratio.id}" ${proportion.match?.ratio?.id === ratio.id ? "selected" : ""}>${ratio.name}</option>`).join("");
      inspector.innerHTML = `
        ${gameHead(room.name || "Room", issuesForRoom(room))}
        ${issueRows(issuesForRoom(room))}
        <button type="button" id="suggest-room-power">Suggest outlets</button>
        <button type="button" id="suggest-room-water">Suggest a sink</button>
        ${suggestKind || suggestNote ? suggestHtml() : ""}
        ${statTiles([
          { icon: "▦", value: `${formatArea(polygonArea(room.polygon))} sq ft`, label: "Area" },
          { icon: "↔", value: formatFeetFine(proportion.width).construction, label: "Width" },
          { icon: "↕", value: formatFeetFine(proportion.depth).construction, label: "Depth" },
        ])}
        <p>${proportion.phrase}</p>
        ${room.groundLevel ? `<p>Ground note: ${escapeHtml(room.groundLevel)}. This is a label from the drawing, not a measured floor height.</p>` : ""}
        ${room.note ? `<p>${escapeHtml(room.note)}</p>` : ""}
        <label>Make proportional <select id="make-ratio">${ratioOptions}</select></label>
        <button type="button" id="make-proportional">Make proportional</button>
        <label>Name <input id="edit-name" value="${escapeAttr(room.name)}" /></label>
        <label>Phase
          <select id="edit-phase">
            <option value="phase1" ${room.phase === "phase1" ? "selected" : ""}>Phase 1</option>
            <option value="future" ${room.phase === "future" ? "selected" : ""}>Later</option>
          </select>
        </label>
        ${selectionCostHtml(house, selection)}
        ${quietDelete("Remove room label")}
      `;
      inspector.querySelector("#make-proportional").addEventListener("click", () => {
        const result = snapRoomToRatio(house, room.id, inspector.querySelector("#make-ratio").value, house.customRatios || []);
        warnings = result.warnings;
        if (result.house !== house) commit(result.house);
        publish();
      });
      inspector.querySelector("#suggest-room-power").addEventListener("click", () => startSuggest("electrical"));
      inspector.querySelector("#suggest-room-water").addEventListener("click", () => startSuggest("plumbing"));
      bindSuggest(inspector);
      bindFindingFixes(inspector);
      inspector.querySelector("#edit-name").addEventListener("change", (event) => {
        const next = cloneHouse(house);
        next.rooms.find((item) => item.id === room.id).name = event.target.value.trim() || "Room";
        commit(next);
        publish();
      });
      inspector.querySelector("#edit-phase").addEventListener("change", (event) => {
        const next = cloneHouse(house);
        next.rooms.find((item) => item.id === room.id).phase = event.target.value;
        commit(next);
        publish();
      });
    } else if (selection.type === "well" || selection.type === "septic" || selection.type === "drainfield" || selection.type === "reserve") {
      inspector.innerHTML = siteInspectorHtml(house, selection);
      inspector.querySelector("#well-kind")?.addEventListener("change", (event) => {
        const next = cloneHouse(house);
        next.site.well.kind = event.target.value;
        commit(next);
        publish();
      });
      inspector.querySelector("#septic-kind")?.addEventListener("change", (event) => {
        const next = cloneHouse(house);
        next.site.septic.kind = event.target.value;
        commit(next);
        publish();
      });
      inspector.querySelector("#edit-delete")?.addEventListener("click", eraseSelection);
    } else if (selection.type === "fixture" || selection.type === "entry") {
      paintFixtureInspector();
      syncSelectionLayout();
      return;
    } else if (selection.type === "device" || selection.type === "panel") {
      paintDeviceInspector();
      syncSelectionLayout();
      return;
    } else if (selection.type === "opening") {
      inspector.hidden = true;
      inspector.innerHTML = "";
      syncSelectionLayout();
      return;
    }
    inspector.querySelector("#edit-delete")?.addEventListener("click", eraseSelection);
    syncSelectionLayout();
  }

  function paintPieceInspector() {
    const kind = selection.type;
    const list = kind === "furniture" ? house.furniture : kind === "siteFeature" ? house.siteFeatures : house.planLabels;
    const item = (list || []).find((entry) => entry.id === selection.id);
    if (!item) {
      inspector.hidden = true;
      inspector.innerHTML = "";
      return;
    }
    const title = kind === "planLabel" ? "Note" : (item.name || plainPiece(item.kind));
    const detail = kind === "planLabel"
      ? item.text
      : `${plainPiece(item.kind)}. Drag it on the plan to move it.`;
    const remove = kind === "furniture" ? "Delete furniture" : kind === "siteFeature" ? "Delete this" : "Delete note";
    inspector.innerHTML = `
      ${gameHead(title, [])}
      <p>${escapeHtml(detail)}</p>
      ${quietDelete(remove)}
    `;
    inspector.querySelector("#edit-delete").addEventListener("click", eraseSelection);
  }

  function paintTutorial() {
    const dismissed = getViewState().dismissedHints || {};
    const text = mode === "build" ? TOOL_HINTS[tool] : "";
    tutorial.hidden = !text || dismissed[tool];
    if (tutorial.hidden) return;
    tutorial.className = "tool-hint";
    tutorial.innerHTML = `<span>${text}</span><button type="button" data-dismiss-hint>Got it</button>`;
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(house, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "house.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const decorated = decorateHouse(JSON.parse(String(reader.result)));
        if (!validate(decorated)) {
          warnings = [{ id: "import", severity: "warn", message: "That file doesn't match the house schema.", target: null }];
          publish();
          return;
        }
        past.push(house);
        future.length = 0;
        house = decorated;
        document.dispatchEvent(new CustomEvent("plan-imported"));
        fromSave = true;
        choose(null);
        localStorage.setItem(DOC_KEY, JSON.stringify(house));
        refreshWarnings();
        pushViews();
        publish();
        plan.fit();
        model.frameHouse?.();
        onDocument?.("import");
      } catch {
        warnings = [{ id: "import", severity: "warn", message: "That file isn't JSON this app can read.", target: null }];
        publish();
      }
    };
    reader.readAsText(file);
  }

  function guideBoxes() {
    const ratio = activeRatio();
    const boxes = [{
      x0: 0,
      y0: 0,
      x1: house.footprint.width,
      y1: house.footprint.depth,
      label: `${ratio.symbol || ratio.name} footprint`,
    }];
    if (selection?.type === "room") {
      const room = house.rooms.find((item) => item.id === selection.id);
      if (room) {
        const box = roomProportion(room, house.customRatios || []);
        boxes.push({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, label: box.phrase });
      }
    }
    return boxes;
  }

  function areas() {
    let phase1 = 0;
    let all = 0;
    for (const room of house.rooms) {
      const area = polygonArea(room.polygon);
      all += area;
      if (room.phase === "phase1") phase1 += area;
    }
    return { phase1, all };
  }

  /** `keepView` is for a change to the same plan (a code-check fix): the camera stays put. */
  function loadHouse(doc, { keepView = false } = {}) {
    let decorated;
    try {
      decorated = decorateHouse(doc);
    } catch {
      return false;
    }
    if (!validate(decorated)) return false;
    past.push(house);
    undoNotes.push(keepView ? "a code-check fix" : "opening a saved plan");
    redoNotes.length = 0;
    if (past.length > 60) {
      past.shift();
      undoNotes.shift();
    }
    future.length = 0;
    house = decorated;
    choose(null);
    fromSave = true;
    if (!keepView) document.dispatchEvent(new CustomEvent("plan-imported"));
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(house));
    } catch {
      // The Drive copy is still the one that was just read.
    }
    refreshWarnings();
    pushViews();
    return true;
  }

  function setCost(partial) {
    const next = cloneHouse(house);
    next.cost = { ...(next.cost || {}), ...partial };
    commit(next);
  }

  function applySite(site) {
    if (!site?.parcel?.ring) return false;
    const next = cloneHouse(house);
    next.site = site;
    commit(next);
    return true;
  }

  function replaceDocument(doc) {
    past.length = 0;
    future.length = 0;
    siteGhosts = [];
    panelGhost = null;
    suggestNote = "";
    suggestKind = null;
    lastPreview = null;
    hoverWorld = null;
    hoverPlace = null;
    gesture = null;
    choose(null);
    if (!doc.sample && !(doc.rooms || []).length) patchViewState({ guideSkipped: false });
    house = decorateHouse(doc);
    fromSave = false;
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(house));
    } catch {
      // Export still works if the browser store is full.
    }
    refreshWarnings();
    pushViews();
    publish();
    plan.fit();
  }

  function setDesignName(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed || trimmed === house.name) return;
    const next = cloneHouse(house);
    next.name = trimmed;
    commit(next);
  }

  const laborDialog = document.querySelector("#labor-dialog");
  document.querySelector("#labor-open")?.addEventListener("click", () => {
    const rates = laborAssumption(house);
    const pipes = plumbingLabor(house);
    laborDialog.querySelector("#labor-device").value = rates.perDevice;
    laborDialog.querySelector("#labor-panel").value = rates.panel;
    laborDialog.querySelector("#labor-foot").value = rates.perFoot;
    laborDialog.querySelector("#plumb-fixture").value = pipes.perFixture;
    laborDialog.querySelector("#plumb-foot").value = pipes.perFoot;
  });
  const saveLaborDialog = () => {
    const next = cloneHouse(house);
    next.electrical.labor = {
      perDevice: Number(laborDialog.querySelector("#labor-device").value),
      panel: Number(laborDialog.querySelector("#labor-panel").value),
      perFoot: Number(laborDialog.querySelector("#labor-foot").value),
    };
    next.plumbing.labor = {
      perFixture: Number(laborDialog.querySelector("#plumb-fixture").value),
      perFoot: Number(laborDialog.querySelector("#plumb-foot").value),
    };
    commit(next);
  };
  for (const id of ["#labor-device", "#labor-panel", "#labor-foot", "#plumb-fixture", "#plumb-foot"]) {
    laborDialog.querySelector(id)?.addEventListener("change", saveLaborDialog);
  }

  return {
    house: () => house,
    areas,
    mode: () => mode,
    loadHouse,
    replaceDocument,
    isDirty: () => past.length > 0 || future.length > 0,
    applySite,
    setDesignName,
    setCost,
    selection: () => selection,
  };
}

function plainPiece(kind) {
  const name = String(kind || "piece").replaceAll("-", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const cross = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (cross) hit = !hit;
  }
  return hit;
}

function escapeAttr(value) {
  return String(value).replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
