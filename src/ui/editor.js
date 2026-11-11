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
  deleteOpening,
  deleteWall,
  moveEndpointGroup,
  placeOpening,
  resizeOpening,
  setWallAssembly,
  translateWall,
} from "../build/walls.js";
import { syncRooms } from "../build/rooms.js";
import { snapOpeningOffset } from "../build/openings.js";
import { projectOntoWall, snapDrawingPoint, snapPointToGrid, snapToGrid } from "../build/snap.js";
import { evaluateRules, warningTargets } from "../rules/index.js";
import { isFutureShown } from "../render/visibility.js";
import { formatArea, formatFeet, formatFeetFine } from "../lib/format.js";
import { polygonArea, wallLength } from "../lib/geom.js";
import { findRatio, ratioLibrary, roomProportion, snapToRatioLength } from "../build/ratios.js";
import { constraintReadout, linkWall, snapRoomToRatio, solveConstraints, unlink } from "../build/constraints.js";

const DOC_KEY = "house-builder.document.v2";
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const TOOLS = [
  { id: "select", label: "Select" },
  { id: "wall", label: "Wall" },
  { id: "room", label: "Room" },
  { id: "door", label: "Door" },
  { id: "window", label: "Window" },
  { id: "erase", label: "Delete" },
];

const TUTORIAL = [
  "Drag on the plan to draw a wall. It snaps to the grid, to other walls, and to 45 degree angles.",
  "Room draws a rectangle of walls. The south side suggests rammed earth. The other sides suggest hempcrete.",
  "Door shows only doors. Window shows only windows. Set the size, then drag along a wall.",
  "Select a wall and drag the round handles, or drag empty space to slide the plan. Undo is on the plan, or Ctrl Z.",
];

export function attachEditor({ plan, model, sample, getViewState, patchViewState, onChange }) {
  const saved = readSaved();
  let house = saved.doc;
  let fromSave = saved.fromSave;
  const past = [];
  const future = [];
  let mode = "view";
  let tool = "select";
  let assemblyId = DEFAULT_EXTERIOR_ID;
  let assemblyExplicit = false;
  let grid = 0.5;
  let catalogId = "door-30";
  let snapMode = "grid";
  let guidesOn = false;
  let selection = null;
  let gesture = null;
  let warnings = [];
  let tutorialStep = 0;
  let longTimer = 0;
  let spaceHeld = false;
  let hoverPlace = null;
  let optionsKey = "";
  let optionsOpen = true;
  const draftSize = {};

  const hud = document.querySelector("#build-hud");
  const inspector = document.querySelector("#inspector");
  const tutorial = document.querySelector("#build-tutorial");
  document.querySelector("#tool-row").innerHTML = TOOLS.map((item) => (
    `<button type="button" class="tool" data-tool="${item.id}">${item.label}</button>`
  )).join("");

  plan.setBuildHooks({
    down: onDown,
    move: onMove,
    up: onUp,
    cancel: () => {
      window.clearTimeout(longTimer);
      gesture = null;
    },
  });
  model.setOnPick?.((wallId) => {
    if (mode !== "build") return;
    selection = wallId ? { type: "wall", id: wallId } : null;
    publish();
  });

  document.querySelector("#mode-seg").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    mode = button.dataset.mode;
    if (mode === "build") {
      const view = getViewState();
      if (view.view === "model") {
        patchViewState({ view: window.matchMedia("(min-width: 861px)").matches ? "split" : "plan" });
      }
      if (!view.buildTutorialDone) tutorialStep = 0;
    }
    publish();
    onChange();
  });
  document.querySelector("#tool-row").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tool]");
    if (!button) return;
    tool = button.dataset.tool;
    publish();
  });
  hud.addEventListener("click", onHudClick);
  document.querySelector("#options-toggle").addEventListener("click", () => {
    optionsOpen = !optionsOpen;
    document.querySelector("#tool-options").hidden = !optionsOpen;
    document.querySelector("#options-toggle").setAttribute("aria-expanded", String(optionsOpen));
  });
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
    selection = null;
    warnings = [];
    publish();
  });
  tutorial.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.act === "next") tutorialStep += 1;
    if (button.dataset.act === "done" || tutorialStep >= TUTORIAL.length) {
      patchViewState({ buildTutorialDone: true });
      tutorialStep = TUTORIAL.length;
    }
    publish();
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select")) return;
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
    } else if (mode === "build" && (event.key === "Delete" || event.key === "Backspace") && selection) {
      event.preventDefault();
      eraseSelection();
    } else if (event.key === "Escape") {
      selection = null;
      publish();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") spaceHeld = false;
  });
  document.querySelector("#plan-canvas").addEventListener("pointermove", (event) => {
    if (mode !== "build" || gesture || (tool !== "door" && tool !== "window")) {
      if (hoverPlace) {
        hoverPlace = null;
        plan.setOverlay(makeOverlay());
      }
      return;
    }
    if (event.buttons) return;
    hoverPlace = openingSpot(plan.clientToWorld(event.clientX, event.clientY));
    plan.setOverlay(makeOverlay());
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

  function ratioOrMagnet(origin, world) {
    const magnet = snapDrawingPoint(world, { grid, walls: house.walls, magnetRadius: magnetRadius() });
    if (magnet.snapped === "end" || magnet.snapped === "mid") return magnet;
    return snapToRatioLength(
      origin,
      world,
      activeRatio(),
      house.proportion?.module || 8,
      house.walls.map((wall) => wallLength(wall)),
    );
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
    for (const room of house.rooms) {
      if (room.phase === "future" && !isFutureShown(getViewState())) continue;
      if (inside(world, room.polygon)) return { type: "room", id: room.id };
    }
    return null;
  }

  function onDown(event, world) {
    if (mode !== "build" || spaceHeld || event.button === 1 || event.button === 2) return false;
    window.clearTimeout(longTimer);
    const armPan = () => {
      longTimer = window.setTimeout(() => {
        gesture = null;
        plan.beginPan(event);
      }, 480);
    };
    if (tool === "select") {
      const hit = hitTest(world);
      if (!hit) {
        selection = null;
        publish();
        return false;
      }
      if (hit.type === "endpoint") selection = { type: "wall", id: hit.wallId };
      else selection = { type: hit.type, id: hit.id };
      gesture = { kind: hit?.type === "endpoint" ? "endpoint" : "select", hit, origin: world, moved: false, snapshot: cloneHouse(house) };
      armPan();
      publish();
      return true;
    }
    if (tool === "erase") {
      const hit = hitTest(world);
      if (hit?.type === "wall") commit(syncRooms(deleteWall(house, hit.id)));
      else if (hit?.type === "opening") commit(deleteOpening(house, hit.id));
      else if (hit?.type === "room") {
        const next = cloneHouse(house);
        next.rooms = next.rooms.filter((room) => room.id !== hit.id);
        commit(next);
      }
      selection = null;
      return true;
    }
    if (tool === "wall" || tool === "room") {
      const start = tool === "room"
        ? snapPointToGrid(world, grid)
        : snapDrawingPoint(world, { grid, walls: house.walls, magnetRadius: magnetRadius() });
      gesture = { kind: tool, start, origin: world, snapshot: cloneHouse(house) };
      armPan();
      return true;
    }
    if (tool === "door" || tool === "window") {
      const place = openingSpot(world);
      gesture = { kind: "opening", place, snapshot: cloneHouse(house) };
      armPan();
      publish();
      return true;
    }
    return false;
  }

  function onMove(event, world) {
    if (!gesture) return;
    if (Math.hypot(event.clientX - (gesture.clientX || event.clientX), event.clientY - (gesture.clientY || event.clientY)) > 8) {
      window.clearTimeout(longTimer);
    }
    gesture.clientX = event.clientX;
    gesture.clientY = event.clientY;
    if (gesture.kind === "wall" || gesture.kind === "room") {
      window.clearTimeout(longTimer);
      const end = gesture.kind === "room"
        ? { ...snapPointToGrid(world, grid), length: 0 }
        : snapMode === "ratio"
          ? ratioOrMagnet(gesture.start, world)
          : snapDrawingPoint(world, {
            grid,
            walls: house.walls,
            origin: gesture.start,
            magnetRadius: magnetRadius(),
          });
      gesture.end = end;
      gesture.moved = true;
      publish();
      return;
    }
    if (gesture.kind === "opening") {
      window.clearTimeout(longTimer);
      gesture.place = openingSpot(world);
      gesture.moved = true;
      publish();
      return;
    }
    if (gesture.kind === "endpoint" && gesture.hit) {
      if (Math.hypot(world.x - gesture.origin.x, world.y - gesture.origin.y) < 0.15) return;
      window.clearTimeout(longTimer);
      gesture.moved = true;
      const wall = gesture.snapshot.walls.find((item) => item.id === gesture.hit.wallId);
      const other = wall && Math.hypot(wall.start.x - gesture.hit.point.x, wall.start.y - gesture.hit.point.y) < 0.2
        ? wall.end
        : wall?.start;
      const others = gesture.snapshot.walls.filter((item) => item.id !== gesture.hit.wallId);
      const snapped = snapDrawingPoint(world, { grid, walls: others, origin: other || null, magnetRadius: magnetRadius() });
      preview(moveEndpointGroup(gesture.snapshot, gesture.hit.point, snapped));
      return;
    }
    if (gesture.kind === "select" && gesture.hit?.type === "wall") {
      const dx = world.x - gesture.origin.x;
      const dy = world.y - gesture.origin.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 0.2) return;
      window.clearTimeout(longTimer);
      gesture.moved = true;
      preview(translateWall(gesture.snapshot, gesture.hit.id, snapToGrid(dx, grid), snapToGrid(dy, grid)));
      return;
    }
    if (gesture.kind === "select" && gesture.hit?.type === "opening") {
      const opening = gesture.snapshot.openings.find((item) => item.id === gesture.hit.id);
      const wall = opening && gesture.snapshot.walls.find((item) => item.id === opening.wallId);
      if (!wall) return;
      const hit = projectOntoWall(world, wall);
      if (!hit) return;
      window.clearTimeout(longTimer);
      gesture.moved = true;
      const slid = snapOpeningOffset(wall, gesture.snapshot.openings, hit.offset - opening.width / 2, opening.width, grid, opening.id);
      const next = cloneHouse(gesture.snapshot);
      const target = next.openings.find((item) => item.id === opening.id);
      if (target && slid.ok) target.offset = slid.offset;
      preview(next);
    }
  }

  function onUp(event, world) {
    window.clearTimeout(longTimer);
    const current = gesture;
    gesture = null;
    if (!current) return;
    if (current.kind === "wall" && current.moved && current.end) {
      const chosen = suggestAssemblyId(current.start, current.end, assemblyId, assemblyExplicit, outwardForWall(current.start, current.end));
      const added = addWall(house, current.start, current.end, chosen);
      if (added.house !== house) commit(syncRooms(added.house));
      else warnings = added.warnings;
    } else if (current.kind === "room" && current.moved && current.end) {
      const added = addRoomRectangle(house, current.start, current.end, assemblyExplicit ? assemblyId : DEFAULT_EXTERIOR_ID);
      if (added.house !== house) commit(syncRooms(added.house));
      else warnings = added.warnings;
    } else if (current.kind === "opening" && current.place?.ok) {
      const placed = placeOpening(house, current.place.wall.id, catalogItem(), current.place.offset);
      if (placed.createdId) {
        selection = { type: "opening", id: placed.createdId };
        commit(placed.house);
      } else warnings = placed.warnings;
    } else if ((current.kind === "endpoint" || current.kind === "select") && current.moved) {
      commit(syncRooms(house), current.snapshot);
    }
    publish();
  }

  function openingSpot(world) {
    const item = catalogItem();
    let best = null;
    for (const wall of house.walls) {
      if (!visibleWall(wall)) continue;
      const hit = projectOntoWall(world, wall);
      if (!hit || hit.distance > wall.thickness / 2 + magnetRadius()) continue;
      const slid = snapOpeningOffset(wall, house.openings, hit.offset - item.width / 2, item.width, grid);
      if (!best || hit.distance < best.distance) {
        best = { wall, offset: slid.offset, width: item.width, ok: slid.ok, distance: hit.distance };
      }
    }
    return best;
  }

  function preview(next) {
    house = next;
    refreshWarnings();
    pushViews();
  }

  function commit(next, baseline = null) {
    const solved = solveConstraints(next);
    next = solved.house;
    const previous = baseline || house;
    if (JSON.stringify(previous) === JSON.stringify(next)) {
      house = previous;
      refreshWarnings();
      pushViews();
      return;
    }
    past.push(previous);
    if (past.length > 60) past.shift();
    future.length = 0;
    house = next;
    fromSave = true;
    warnings = [...solved.warnings, ...evaluateRules(house)];
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(house));
    } catch {
      // Ignore a full browser store. Export still works.
    }
    pushViews();
  }

  function undo() {
    if (!past.length) return;
    future.push(house);
    house = past.pop();
    selection = null;
    refreshWarnings();
    localStorage.setItem(DOC_KEY, JSON.stringify(house));
    pushViews();
    publish();
  }

  function redo() {
    if (!future.length) return;
    past.push(house);
    house = future.pop();
    selection = null;
    refreshWarnings();
    localStorage.setItem(DOC_KEY, JSON.stringify(house));
    pushViews();
    publish();
  }

  function eraseSelection() {
    if (!selection) return;
    if (selection.type === "wall") commit(syncRooms(deleteWall(house, selection.id)));
    else if (selection.type === "opening") commit(deleteOpening(house, selection.id));
    else if (selection.type === "room") {
      const next = cloneHouse(house);
      next.rooms = next.rooms.filter((room) => room.id !== selection.id);
      commit(next);
    }
    selection = null;
    publish();
  }

  function refreshWarnings() {
    warnings = evaluateRules(house);
  }

  function pushViews() {
    plan.setHouse(house);
    model.setHouse(house);
    model.setSelected?.(selection?.type === "wall" ? selection.id : null);
    plan.setOverlay(makeOverlay());
    publish();
    onChange();
  }

  function makeOverlay() {
    const targets = warningTargets(warnings);
    const draftAssembly = gesture?.kind === "wall" && gesture.end
      ? assemblyById[suggestAssemblyId(gesture.start, gesture.end, assemblyId, assemblyExplicit, outwardForWall(gesture.start, gesture.end))]
      : null;
    return {
      warningWalls: [...targets.walls],
      warningOpenings: [...targets.openings],
      selection: mode === "build" ? selection : null,
      draft: gesture?.kind === "wall" && gesture.end ? {
        start: gesture.start,
        end: gesture.end,
        color: draftAssembly?.swatch,
        lengthLabel: gesture.end.label || formatFeetFine(gesture.end.length || Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y)).construction,
        ticks: gesture.end.ticks || [],
      } : null,
      guides: guidesOn ? guideBoxes() : [],
      rect: gesture?.kind === "room" && gesture.end ? {
        x0: gesture.start.x,
        y0: gesture.start.y,
        x1: gesture.end.x,
        y1: gesture.end.y,
      } : null,
      ghostOpening: (gesture?.kind === "opening" && gesture.place) || hoverPlace ? {
        wallId: (gesture?.place || hoverPlace).wall.id,
        offset: (gesture?.place || hoverPlace).offset,
        width: catalogItem().width,
        ok: (gesture?.place || hoverPlace).ok,
      } : null,
    };
  }

  function publish() {
    hud.hidden = mode !== "build";
    document.querySelector("#mode-seg").querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });
    document.querySelectorAll("#tool-row button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    });
    document.querySelector("#undo").disabled = past.length === 0;
    document.querySelector("#redo").disabled = future.length === 0;
    paintToolOptions();
    paintInspector();
    paintTutorial();
    plan.setOverlay(mode === "build" ? makeOverlay() : null);
    model.setSelected?.(mode === "build" && selection?.type === "wall" ? selection.id : null);
  }

  function paintToolOptions() {
    const box = document.querySelector("#tool-options");
    box.hidden = !optionsOpen;
    document.querySelector("#options-toggle")?.setAttribute("aria-expanded", String(optionsOpen));
    if (tool === "door" || tool === "window") catalogItem();
    const key = `${mode}|${tool}|${selection?.type || ""}|${selection?.id || ""}|${catalogId}|${snapMode}|${guidesOn}`;
    if (key === optionsKey && box.childElementCount) {
      box.querySelector("[data-warn]")?.replaceChildren(document.createTextNode(warnings[0]?.message || ""));
      return;
    }
    optionsKey = key;
    if (tool === "wall" || tool === "room") {
      const note = assemblyById[assemblyId]?.note || "";
      box.innerHTML = `
        <div class="swatch-row">${assemblies.map((item) => `<button type="button" class="chip" data-assembly="${item.id}" aria-pressed="${item.id === assemblyId}"><span class="swatch" style="background:${item.swatch}"></span>${item.short}</button>`).join("")}
          <button type="button" class="info-btn" id="assembly-info" aria-expanded="false" aria-label="About this wall type">i</button>
        </div>
        <div class="option-line">
          <div class="seg" id="snap-mode">
            <button type="button" data-snap="grid" aria-pressed="${snapMode === "grid"}">Grid</button>
            <button type="button" data-snap="ratio" aria-pressed="${snapMode === "ratio"}">Ratio</button>
          </div>
          <label>Size <select id="grid-size"><option value="0.25">3 in</option><option value="0.5">6 in</option><option value="1">12 in</option></select></label>
          <label>Ratio <select id="project-ratio">${ratioLibrary.map((ratio) => `<option value="${ratio.id}">${ratio.symbol || ratio.name}</option>`).join("")}</select></label>
          <label>Module <input id="module-length" type="number" min="0.5" step="0.5" value="${house.proportion?.module || 8}" /> ft</label>
          <button type="button" id="guides-toggle" aria-pressed="${guidesOn}">Guides</button>
          <button type="button" id="snap-footprint" title="Snap the footprint to φ">Snap φ</button>
        </div>
        <p id="assembly-note" class="info-note" hidden>${note}</p>
        ${warnings[0]?.message ? `<p class="warn-line" data-warn>${warnings[0].message}</p>` : `<p class="warn-line" data-warn hidden></p>`}`;
      box.querySelector("#grid-size").value = String(grid);
      box.querySelector("#project-ratio").value = house.proportion?.ratioId || "golden";
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
    box.innerHTML = `<p class="fine">Drag empty space to pan. Drag a wall handle to resize it.</p>`;
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
    const snap = event.target.closest("button[data-snap]");
    if (snap) {
      snapMode = snap.dataset.snap;
      optionsKey = "";
      publish();
      return;
    }
    if (event.target.id === "guides-toggle") {
      guidesOn = !guidesOn;
      optionsKey = "";
      publish();
    } else if (event.target.id === "snap-footprint") {
      commit(solveConstraints(house, { includeFootprint: true }).house);
      publish();
    }
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
    if (event.target.id === "project-ratio") {
      const next = cloneHouse(house);
      next.proportion = { ...(next.proportion || { module: 8 }), ratioId: event.target.value };
      commit(next);
    }
    if (event.target.id === "module-length") {
      const module = Number(event.target.value);
      if (module > 0) {
        const next = cloneHouse(house);
        next.proportion = { ...(next.proportion || { ratioId: "golden" }), module };
        commit(next);
      }
    }
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

  function paintInspector() {
    if (mode !== "build" || !selection) {
      inspector.hidden = true;
      inspector.innerHTML = "";
      return;
    }
    inspector.hidden = false;
    if (selection.type === "wall") {
      const wall = house.walls.find((item) => item.id === selection.id);
      if (!wall) { inspector.hidden = true; return; }
      const assembly = assemblyById[wall.assemblyId];
      const detail = formatFeetFine(wallLength(wall));
      const linked = (house.constraints || []).find((item) => item.targetId === wall.id);
      const readout = linked && constraintReadout(house, linked, house.customRatios || []);
      const ratioOptions = ratioLibrary.map((ratio) => `<option value="${ratio.id}">${ratio.name}</option>`).join("");
      const wallOptions = house.walls
        .filter((item) => item.id !== wall.id)
        .map((item) => `<option value="${item.id}">${item.id} · ${formatFeetFine(wallLength(item)).construction}</option>`)
        .join("");
      inspector.innerHTML = `
        <h2>Wall</h2>
        <p>${detail.construction}${detail.fudged ? ` · exact ${detail.exact}` : ""} · ${assembly?.name || wall.assembly}</p>
        <p class="fine">${assembly?.note || ""}</p>
        ${linked ? `<p>Proportion: ${readout?.badge || "linked"}${readout?.exact ? " · exact" : ""}</p><button type="button" id="unlink">Unlink</button>` : `
          <label>Length <select id="prop-op"><option value="multiply">×</option><option value="divide">÷</option></select>
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
        <button type="button" id="edit-delete">Delete wall</button>
      `;
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
    } else if (selection.type === "room") {
      const room = house.rooms.find((item) => item.id === selection.id);
      if (!room) { inspector.hidden = true; return; }
      const proportion = roomProportion(room, house.customRatios || []);
      const ratioOptions = ratioLibrary.map((ratio) => `<option value="${ratio.id}" ${proportion.match?.ratio?.id === ratio.id ? "selected" : ""}>${ratio.name}</option>`).join("");
      inspector.innerHTML = `
        <h2>Room · ${formatArea(polygonArea(room.polygon))} sq ft</h2>
        <p>${formatFeetFine(proportion.width).construction} × ${formatFeetFine(proportion.depth).construction}</p>
        <p>${proportion.phrase}</p>
        <label>Make proportional <select id="make-ratio">${ratioOptions}</select></label>
        <button type="button" id="make-proportional">Make proportional</button>
        <label>Name <input id="edit-name" value="${escapeAttr(room.name)}" /></label>
        <label>Phase
          <select id="edit-phase">
            <option value="phase1" ${room.phase === "phase1" ? "selected" : ""}>Phase 1</option>
            <option value="future" ${room.phase === "future" ? "selected" : ""}>Later</option>
          </select>
        </label>
        <button type="button" id="edit-delete">Remove room label</button>
      `;
      inspector.querySelector("#make-proportional").addEventListener("click", () => {
        const result = snapRoomToRatio(house, room.id, inspector.querySelector("#make-ratio").value, house.customRatios || []);
        warnings = result.warnings;
        if (result.house !== house) commit(result.house);
        publish();
      });
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
    } else if (selection.type === "opening") {
      inspector.hidden = true;
      inspector.innerHTML = "";
      return;
    }
    inspector.querySelector("#edit-delete")?.addEventListener("click", eraseSelection);
  }

  function paintTutorial() {
    const done = getViewState().buildTutorialDone || tutorialStep >= TUTORIAL.length;
    tutorial.hidden = mode !== "build" || done;
    if (tutorial.hidden) return;
    const last = tutorialStep >= TUTORIAL.length - 1;
    tutorial.innerHTML = `
      <p><strong>Build ${tutorialStep + 1} of ${TUTORIAL.length}.</strong> ${TUTORIAL[tutorialStep]}</p>
      <button type="button" data-act="${last ? "done" : "next"}">${last ? "Got it" : "Next"}</button>
    `;
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
        fromSave = true;
        selection = null;
        localStorage.setItem(DOC_KEY, JSON.stringify(house));
        refreshWarnings();
        pushViews();
        publish();
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

  return {
    house: () => house,
    areas,
    mode: () => mode,
  };
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
