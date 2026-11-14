import "./styles.css";
import house from "../data/sample-house.json";
import { LAYER_DEFS } from "./layers.js";
import { formatArea } from "./lib/format.js";
import { loadViewState, saveViewState } from "./state/viewState.js";
import { createPlanView } from "./render/plan2d.js";
import { createView3d } from "./render/view3d.js";
import { areaReport } from "./build/areas.js";
import { footprintMatch } from "./build/constraints.js";
import { attachEditor } from "./ui/editor.js";
import { attachAccount } from "./ui/account.js";
import { attachCosts } from "./ui/costs.js";
import { attachWarnings } from "./ui/warnings.js";
import { siteCardHtml } from "./ui/sitePanel.js";
import { blankPlan, fourRoomSample } from "./build/newPlan.js";

const wideQuery = window.matchMedia("(min-width: 861px)");
const state = loadViewState();
let panelOpen = false;
let buildRoofHold = null;
let frameKey = "";
let frameTicket = 0;
let frameImportPending = false;
let holdView = false;
let orbit3d = true;
let cutaway3d = false;

const app = document.querySelector("#app");
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <svg class="mark" viewBox="0 0 36 36" aria-hidden="true">
          <rect width="36" height="36" rx="10" fill="#F3D2C6"/>
          <path d="M6 18 L18 8 L30 18 V29 H6 Z" fill="#C4654A"/>
          <path d="M6 18 L18 8 L30 18" fill="none" stroke="#2F5D45" stroke-width="2"/>
          <rect x="15" y="21" width="6" height="8" fill="#F7F3EB"/>
        </svg>
        <h1>House Builder</h1>
      </div>
      <div class="app-menu" id="app-menu">
        <div class="mode-switch" id="mode-seg" role="group" aria-label="View or build">
          <button type="button" data-mode="view">View</button>
          <button type="button" data-mode="build">Build</button>
        </div>
        <div class="controls">
          <div class="seg" id="phase-seg" role="group" aria-label="Which phase to show">
            <button type="button" data-phase="phase1">Phase 1</button>
            <button type="button" data-phase="full">Full house</button>
          </div>
          <div class="seg" id="view-seg" role="group" aria-label="Plan or 3D">
            <button type="button" data-view="plan">Plan</button>
            <button type="button" data-view="split" class="wide-only">Split</button>
            <button type="button" data-view="model">3D</button>
          </div>
          <button type="button" class="layers-btn" id="layers-btn" aria-expanded="false">Layers</button>
        </div>
        <div class="controls-end">
          <button type="button" id="save-status" class="save-status" hidden></button>
          <details class="file-menu" id="file-menu">
            <summary>File</summary>
            <div class="file-menu-panel">
              <p class="menu-label">Plan</p>
              <button type="button" id="menu-new">New plan</button>
              <button type="button" id="drive-open">Open…</button>
              <button type="button" id="drive-save">Save</button>
              <p class="menu-label">Drive</p>
              <button type="button" id="drive-save-as">Save as…</button>
              <button type="button" id="drive-share">Share with…</button>
              <p class="menu-label">This device</p>
              <button type="button" id="export-json">Export JSON</button>
              <button type="button" id="export-materials-csv">Export materials CSV</button>
              <button type="button" id="export-materials-json">Export materials JSON</button>
              <button type="button" id="import-json">Import JSON</button>
              <button type="button" id="import-site">Import parcel JSON</button>
              <button type="button" id="reset-sample">Reset to sample</button>
            </div>
          </details>
          <div id="account" class="account"></div>
          <input id="import-file" type="file" accept="application/json,.json" hidden />
          <input id="import-site-file" type="file" accept="application/json,.json" hidden />
        </div>
      </div>
      <p id="status-meta" class="status-meta"></p>
      <p class="sample-chip" hidden title="Sample layout · not a final design">Sample · not final</p>
      <button type="button" id="cost-chip" class="cost-chip" title="Materials and labor">
        <span id="cost-figure">—</span>
        <span id="cost-note"></span>
      </button>
      <button type="button" id="warn-chip" class="warn-chip" title="Code checks">
        <span id="warn-count">0</span>
      </button>
      <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="app-menu">Menu</button>
    </header>
    <div class="workspace" id="workspace">
      <div class="stage" id="stage" data-view="split">
        <section class="viewport viewport-plan" aria-label="Plan view">
          <div class="plan-frame"><canvas id="plan-canvas"></canvas></div>
          <div class="hud glass">
            <span>Plan · north up</span>
            <button type="button" id="fit-plan">Fit</button>
            <button type="button" id="undo" disabled>Undo</button>
            <button type="button" id="redo" disabled>Redo</button>
          </div>
        </section>
        <section class="viewport viewport-model" aria-label="3D view">
          <canvas id="model-canvas"></canvas>
          <div class="hud glass"><span id="model-mode-label">3D · orbit</span><button type="button" id="edit-3d" aria-pressed="false">Edit</button><button type="button" id="orbit-3d" aria-pressed="true">Orbit</button><button type="button" id="cutaway-3d" aria-pressed="false">Cutaway</button><button type="button" id="roof-toggle" aria-pressed="true">Roof</button><button type="button" id="reset-3d">Reset view</button></div>
          <p class="webgl-fallback" id="webgl-fallback" hidden></p>
        </section>
        <div id="build-hud" class="build-hud" hidden>
          <div id="coach-dock" class="coach-dock glass" hidden>
            <div class="coach">
              <details id="guide-card" class="guide-card" open>
                <summary>Guide</summary>
                <div id="coach-line">Build mode. Pick a tool.</div>
              </details>
              <details id="action-history" open>
                <summary>Recent</summary>
                <ol id="history-list"></ol>
              </details>
            </div>
          </div>
          <div id="build-tutorial" class="tool-hint" hidden></div>
          <div id="options-shell" class="options-shell"><div class="options-clip"><div id="tool-options" class="tool-options glass"></div></div></div>
          <div class="tool-dock glass">
            <div id="tool-row" class="tool-row"></div>
            <span class="dock-rule" aria-hidden="true"></span>
            <button type="button" id="snap-toggle" class="hud-pill" aria-pressed="false" title="Line up wall ends while you drag">Snap to grid</button>
            <button type="button" id="tidy-shape" class="hud-pill" title="Square the selected walls and round their lengths">Tidy up shape</button>
            <button type="button" id="options-toggle" class="options-toggle hud-pill" aria-expanded="false" aria-controls="tool-options">Options</button>
            <button type="button" id="issues-toggle" class="hud-pill" aria-pressed="false">Issues only</button>
            <button type="button" id="labor-open" class="hud-pill">Labor</button>
            <button type="button" id="guide-toggle" class="hud-pill" aria-expanded="false" aria-controls="coach-dock" title="What each tool does, and your recent actions">Guide</button>
            <button type="button" id="details-open" class="hud-pill phone-only">Details</button>
          </div>
        </div>
      </div>
      <aside class="layer-panel" id="layer-panel">
        <div class="sheet-bar">
          <button type="button" class="icon-btn" id="layers-close" aria-label="Close layers">Close</button>
        </div>
        <div id="inspector" class="inspector glass" hidden></div>
        <section class="panel-card glass" id="panel-card">
          <button type="button" class="panel-collapse" id="panel-collapse" aria-expanded="true" aria-controls="panel-body" title="Hide or show the layers">
            <span class="panel-collapse-label">Layers</span><span class="chev" aria-hidden="true">‹</span>
          </button>
          <div class="panel-body" id="panel-body">
            <details id="layer-fold" class="layer-fold" open>
            <summary>Layers</summary>
            <div class="layer-list" id="layer-list"></div>
            <div class="legend">
              <h2>Materials</h2>
              <div class="swatch-row"><span class="swatch earth"></span> Rammed earth, south walls</div>
              <div class="swatch-row"><span class="swatch hemp"></span> Hempcrete, other exterior walls</div>
              <div class="swatch-row"><span class="swatch frame"></span> Wood framing, interior walls</div>
              <div class="swatch-row"><span class="swatch later"></span> Later wings, dashed</div>
            </div>
            </details>
            <details id="site-fold" class="site-fold">
              <summary>Lot</summary>
              <div id="site-card"></div>
            </details>
          </div>
        </section>
      </aside>
    </div>
  </div>
  <div id="budget-toast" class="budget-toast" hidden></div>
  <div id="app-toast" class="app-toast" hidden></div>
  <form id="wall-measure" class="wall-measure" hidden>
    <p class="fine" id="measure-join">0° points east. The angle turns counterclockwise.</p>
    <label>Length <input id="measure-length" autocomplete="off" inputmode="decimal" /></label>
    <label>Angle (°) <input id="measure-angle" autocomplete="off" inputmode="decimal" /></label>
    <div class="measure-actions">
      <button type="submit" class="primary">Set it</button>
      <button type="button" id="measure-cancel">Cancel</button>
    </div>
  </form>
  <div class="scrim" id="scrim" hidden></div>
  <dialog id="new-plan-dialog" class="cost-dialog">
    <header class="cost-head"><h2>New plan</h2><button type="button" data-close>Close</button></header>
    <p id="new-plan-warn" class="fine"></p>
    <div class="new-plan-actions">
      <button type="button" id="new-blank">Blank plan</button>
      <button type="button" class="primary" id="new-sample">Four-room sample</button>
    </div>
    <p class="fine">Blank starts with an empty floor and a sample lot. The four-room sample is the phase 1 living, kitchen, bathroom, and bedroom.</p>
  </dialog>
  <dialog id="labor-dialog" class="cost-dialog">
    <header class="cost-head"><h2>Labor assumptions</h2><button type="button" data-close>Close</button></header>
    <p class="fine">These hours are assumptions you can edit. The wage stays the published Jefferson County rate.</p>
    <label>Hours per device <input id="labor-device" type="number" min="0" step="0.05" /></label>
    <label>Panel hours <input id="labor-panel" type="number" min="0" step="0.25" /></label>
    <label>Hours per foot of cable <input id="labor-foot" type="number" min="0" step="0.005" /></label>
    <label>Hours per fixture <input id="plumb-fixture" type="number" min="0" step="0.25" /></label>
    <label>Hours per foot of pipe <input id="plumb-foot" type="number" min="0" step="0.005" /></label>
  </dialog>
  <dialog id="drive-dialog" class="drive-dialog"></dialog>
  <dialog id="warn-dialog" class="warn-dialog">
    <header class="cost-head">
      <h2>Code check</h2>
      <button type="button" data-close>Close</button>
    </header>
    <p class="fine">Clear the blockers and warnings and this design matches the rules below.</p>
    <div id="warn-list"></div>
  </dialog>
  <dialog id="cost-dialog" class="cost-dialog">
    <div class="cost-top">
      <header class="cost-head">
        <h2>Costs</h2>
        <button type="button" data-close>Close</button>
      </header>
      <p class="fine" id="cost-phase-label">Full house</p>
      <p id="cost-total" class="cost-total">—</p>
      <div class="seg" id="cost-phase" role="group" aria-label="Which phase to price">
        <button type="button" data-phase="phase1">Phase 1</button>
        <button type="button" data-phase="full">Full house</button>
      </div>
      <div id="cost-progress"></div>
      <label class="hire-toggle"><input id="cost-hire" type="checkbox" /> Show hired finish labor</label>
      <nav id="cost-nav" class="seg" aria-label="Cost categories"></nav>
    </div>
    <div id="cost-focus"></div>
    <div id="cost-groups"></div>
    <p class="dialog-actions">
      <button type="button" id="cost-csv">Export CSV</button>
      <button type="button" id="cost-json">Export JSON</button>
    </p>
  </dialog>
  <div class="hint" id="hint" role="dialog" aria-labelledby="hint-title">
    <p id="hint-title">Drag the plan to move around. Scroll or pinch to zoom. In 3D, a click places and Orbit looks around. Solid rooms are the first part to build. Dashed rooms are later wings.</p>
    <button type="button" id="hint-ok">Got it</button>
  </div>
`;

const layerList = document.querySelector("#layer-list");
layerList.innerHTML = LAYER_DEFS.map((layer, index) => {
  const divider = layer.stub && !LAYER_DEFS[index - 1]?.stub
    ? `<p class="later-label">Later stages</p>`
    : "";
  return `${divider}<button type="button" class="layer${layer.stub ? " is-stub" : ""}" data-layer="${layer.id}" aria-pressed="false">
      <span class="switch" aria-hidden="true"></span>
      <span class="layer-name">${layer.label}</span>
      ${layer.stub ? `<span class="soon">Later</span>` : ""}
    </button>`;
}).join("");

const planCanvas = document.querySelector("#plan-canvas");
const modelCanvas = document.querySelector("#model-canvas");
planCanvas.addEventListener("contextmenu", (event) => event.preventDefault());
bindShell();
let plan = null;
let model = null;
let editor = null;
let warningsUi = null;
let onDocument = () => {};
let account = null;
let costs = null;
try {
plan = createPlanView(planCanvas, house);
model = createView3d(modelCanvas, house);
plan.setState(state);
editor = attachEditor({
  plan,
  model,
  sample: house,
  getViewState: () => state,
  patchViewState(partial) {
    Object.assign(state, partial);
    saveViewState(state);
  },
  onChange() {
    publish();
  },
  onDocument(source) {
    onDocument(source);
  },
});
account = attachAccount({ editor });
onDocument = account.onDocument;
warningsUi = attachWarnings({
  getHouse: () => editor.house(),
  getPhase: () => state.phase,
  plan,
  replaceHouse: (next) => editor.loadHouse(next, { keepView: true }),
});
costs = attachCosts({
  getHouse: () => editor.house(),
  getPhase: () => (state.phase === "phase1" ? "phase1" : "full"),
  getSelection: () => editor.selection(),
  setDiy(diyFinish) {
    editor.setCost({ diyFinish });
  },
  setPhase(phase) {
    state.phase = phase;
    publish();
  },
});

plan.setOnChange((planCamera) => {
  state.plan = planCamera;
  saveViewState(state);
});
model.setOnChange((camera) => {
  state.camera = camera;
  saveViewState(state);
});

if (model.failed) {
  const fallback = document.querySelector("#webgl-fallback");
  fallback.hidden = false;
  fallback.textContent = model.message;
}
} catch (error) {
  console.error(error);
}

function wide() {
  return wideQuery.matches;
}

/** The Guide and Recent list stay out of the way until the Guide pill opens them. */
function syncGuide() {
  const dock = document.querySelector("#coach-dock");
  const toggle = document.querySelector("#guide-toggle");
  if (!dock || !toggle) return;
  const open = !!state.guideOpen;
  dock.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
}

/**
 * The layer panel floats over the plan, so opening or hiding it never resizes
 * the drawing. The selection card stays up while the layers are hidden.
 */
function syncPanel() {
  const panel = document.querySelector("#layer-panel");
  const button = document.querySelector("#panel-collapse");
  if (!panel || !button) return;
  const collapsed = !!state.panelCollapsed && wide();
  panel.classList.toggle("collapsed", collapsed);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.title = collapsed ? "Show the layers" : "Hide the layers";
  const inspecting = !document.querySelector("#inspector")?.hidden;
  const panelWide = wide() && (!collapsed || inspecting);
  document.querySelector("#workspace")?.classList.toggle("panel-wide", panelWide);
  plan?.setInsets?.({ left: panelWide && effectiveView() !== "model" ? 290 : 0 });
}

function effectiveView() {
  if (!wide() && state.view === "split") return "plan";
  return state.view;
}

function statusText() {
  if (!editor) return "";
  const doc = editor.house();
  const areas = areaReport(doc);
  const stubs = LAYER_DEFS.filter((layer) => layer.stub && state.layers[layer.id]).map((layer) => layer.label);
  const stubNote = stubs.length ? ` · ${stubs.join(", ")}: nothing in this layer yet` : "";
  const futureNote = state.phase === "full" && !state.layers.future ? " · Future wings layer is off" : "";
  const phaseNote = state.phase === "phase1" ? "Phase 1 only" : "Full house";
  const foot = footprintMatch(doc, doc.customRatios || []);
  let footNote = "";
  const planShowsFootprint = effectiveView() !== "model";
  if (foot?.badge && !planShowsFootprint) {
    const percent = foot.deviation * 100;
    footNote = foot.exact
      ? ` · Footprint ${foot.badge} exact`
      : ` · Footprint ${foot.badge} ${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)}%`;
  }
  const studio = areas.studio >= 1 ? ` · Studio ${formatArea(areas.studio)} sq ft` : "";
  return `${phaseNote} · Phase 1 heated ${formatArea(areas.phase1Heated)} sq ft · Heated ${formatArea(areas.heated)} sq ft · Covered outdoor ${formatArea(areas.covered)} sq ft${studio}${footNote}${futureNote}${stubNote}`;
}

function syncControls() {
  for (const button of document.querySelectorAll("#phase-seg button")) {
    button.setAttribute("aria-pressed", String(button.dataset.phase === state.phase));
  }
  const view = effectiveView();
  for (const button of document.querySelectorAll("#view-seg button")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  for (const button of layerList.querySelectorAll("button[data-layer]")) {
    button.setAttribute("aria-pressed", String(!!state.layers[button.dataset.layer]));
  }
  document.querySelector("#stage").dataset.view = view;
  const meta = document.querySelector("#status-meta");
  if (meta) {
    meta.textContent = statusText();
    meta.title = meta.textContent;
  }
  const sampleChip = document.querySelector(".sample-chip");
  if (sampleChip && editor) sampleChip.hidden = !editor.house()?.sample;
  syncGuide();
  syncPanel();
  const hint = document.querySelector("#hint");
  if (hint) hint.hidden = !!state.hintDismissed;
  const showPanel = panelOpen && !wide();
  document.querySelector("#layer-panel")?.classList.toggle("open", showPanel);
  const scrim = document.querySelector("#scrim");
  if (scrim) scrim.hidden = !showPanel;
  document.querySelector("#layers-btn")?.setAttribute("aria-expanded", String(showPanel));
}

function syncBuildRoof() {
  const building = editor?.mode() === "build";
  if (building && buildRoofHold === null) {
    buildRoofHold = state.roof !== false;
    state.roof = false;
  } else if (!building && buildRoofHold !== null) {
    state.roof = buildRoofHold ? undefined : false;
    buildRoofHold = null;
  }
}

function publish() {
  if (!plan || !model) return;
  try { syncBuildRoof(); } catch (error) { console.error(error); }
  try { saveViewState(state); } catch (error) { console.error(error); }
  try { plan.setState(state); } catch (error) { console.error(error); }
  try { model.setState({ ...state, building: editor?.mode() === "build" }); } catch (error) { console.error(error); }
  try { syncControls(); } catch (error) { console.error(error); }
  try { costs?.paint(); } catch (error) { console.error(error); }
  try { warningsUi?.paint(); } catch (error) { console.error(error); }
  try {
    const siteCard = document.querySelector("#site-card");
    const siteFold = document.querySelector("#site-fold");
    if (siteCard && siteFold && editor) {
      const show = state.layers.site !== false;
      const html = show ? siteCardHtml(editor.house()) : "";
      siteFold.hidden = !html;
      if (html && siteCard.dataset.html !== html) {
        const open = siteCard.querySelector("details")?.open;
        siteCard.innerHTML = html;
        siteCard.dataset.html = html;
        const details = siteCard.querySelector("details");
        if (details && open) details.open = true;
      }
    }
  } catch (error) {
    console.error(error);
  }
  try { sync3d(); } catch (error) { console.error(error); }
  try { plan.resize(); } catch (error) { console.error(error); }
  try { model.resize(); } catch (error) { console.error(error); }
  try { frameBuildIfNeeded(); } catch (error) { console.error(error); }
}

document.addEventListener("plan-imported", () => {
  frameImportPending = true;
});
document.addEventListener("preserve-view", () => {
  holdView = true;
});
function frameShownModel(imported = false) {
  model.resize?.();
  if (imported || editor?.mode() === "build") model.frameHouse?.();
  else model.frameWhole?.();
}
function frameBuildIfNeeded() {
  if (!editor) return;
  const building = editor.mode() === "build";
  const view = effectiveView();
  const shows3d = view === "model" || view === "split";
  const phone = !wide();
  const pendingImport = frameImportPending;
  const house = editor.house();
  // Edits never move the camera. Adding, moving, or deleting walls, rooms, or
  // anything else leaves the plan and the 3D view exactly where they were.
  // Only a different plan (New plan, Open, Import) frames itself again.
  const docKey = house?.id || "";
  const key = `${building}:${shows3d}:${view}:${phone}:${docKey}:${pendingImport ? "import" : ""}`;
  if (key === frameKey && !pendingImport) {
    holdView = false;
    return;
  }
  if (holdView && !pendingImport) {
    frameKey = key;
    holdView = false;
    return;
  }
  const newDoc = frameKey !== "" && !frameKey.includes(`:${docKey}:`);
  frameKey = key;
  if (newDoc) plan.fit?.();
  if (pendingImport && !shows3d) return;
  const imported = pendingImport && shows3d;
  if (imported) frameImportPending = false;
  if (!shows3d || !(imported || phone || building)) return;
  const ticket = ++frameTicket;
  frameShownModel(imported);
  requestAnimationFrame(() => {
    if (ticket !== frameTicket) return;
    frameShownModel(imported);
  });
}

function sync3d() {
  const editing = editor?.mode() === "build" && !orbit3d;
  document.body.dataset.orbit = String(!editing);
  model.setEditing?.(editing);
  model.setCutaway?.(cutaway3d);
  document.querySelector("#edit-3d")?.setAttribute("aria-pressed", String(editing));
  document.querySelector("#orbit-3d")?.setAttribute("aria-pressed", String(!editing));
  document.querySelector("#cutaway-3d")?.setAttribute("aria-pressed", String(cutaway3d));
  const roofBtn = document.querySelector("#roof-toggle");
  const building = editor?.mode() === "build";
  if (roofBtn) {
    const on = state.roof !== false;
    roofBtn.setAttribute("aria-pressed", String(on));
    roofBtn.dataset.ghost = String(building && on && !cutaway3d);
    roofBtn.title = building && on && !cutaway3d
      ? "The roof is see-through while you build. Click to hide it."
      : "Show or hide the roof.";
  }
  const label = document.querySelector("#model-mode-label");
  if (label) label.textContent = editing ? "3D · edit" : "3D · orbit";
}

function bindShell() {
document.querySelector("#phase-seg").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-phase]");
  if (!button) return;
  state.phase = button.dataset.phase;
  publish();
});

document.querySelector("#view-seg").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  publish();
});

layerList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-layer]");
  if (!button) return;
  const id = button.dataset.layer;
  state.layers[id] = !state.layers[id];
  publish();
});

document.addEventListener("house-selection", () => {
  syncControls();
});
function closePhoneMenu() {
  if (!window.matchMedia("(max-width: 860px)").matches) return;
  document.querySelector(".topbar").classList.remove("menu-open");
  document.querySelector("#menu-btn").setAttribute("aria-expanded", "false");
}
document.querySelector("#menu-btn").addEventListener("click", () => {
  const open = document.querySelector(".topbar").classList.toggle("menu-open");
  document.querySelector("#menu-btn").setAttribute("aria-expanded", String(open));
});
document.querySelector("#app-menu").addEventListener("click", (event) => {
  if (event.target.closest("summary")) return;
  if (event.target.closest("button")) closePhoneMenu();
});
document.querySelector("#guide-toggle").addEventListener("click", () => {
  state.guideOpen = !state.guideOpen;
  saveViewState(state);
  syncGuide();
});
document.querySelector("#panel-collapse").addEventListener("click", () => {
  state.panelCollapsed = !state.panelCollapsed;
  saveViewState(state);
  syncPanel();
  document.dispatchEvent(new CustomEvent("app-toast", { detail: { text: state.panelCollapsed ? "Layers hidden" : "Layers shown" } }));
});
document.querySelector("#details-open").addEventListener("click", () => {
  panelOpen = true;
  syncControls();
});
document.querySelector("#layers-btn").addEventListener("click", () => {
  panelOpen = true;
  syncControls();
});
document.querySelector("#layers-close").addEventListener("click", () => {
  panelOpen = false;
  syncControls();
});
document.querySelector("#scrim").addEventListener("click", () => {
  panelOpen = false;
  syncControls();
});
document.querySelector("#hint-ok").addEventListener("click", () => {
  state.hintDismissed = true;
  publish();
});
document.querySelector("#fit-plan").addEventListener("click", () => plan?.fit());
document.querySelector("#import-site").addEventListener("click", () => {
  document.querySelector("#import-site-file").click();
});
document.querySelector("#import-site-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const site = parsed.site || parsed;
    if (!editor.applySite(site)) return;
  } catch {
    // A bad parcel file leaves the current lot in place.
  }
});
document.querySelector("#reset-3d").addEventListener("click", () => {
  model?.resetCamera();
  plan?.fit();
});
document.querySelector("#edit-3d").addEventListener("click", () => {
  if (!editor) return;
  orbit3d = false;
  if (editor.mode() !== "build") document.querySelector("[data-mode=build]").click();
  else publish();
});
document.querySelector("#orbit-3d").addEventListener("click", () => {
  orbit3d = true;
  publish();
});
document.querySelector("#cutaway-3d").addEventListener("click", () => {
  cutaway3d = !cutaway3d;
  publish();
});
document.querySelector("#menu-new").addEventListener("click", openNewPlan);
document.querySelector("#new-plan-dialog [data-close]").addEventListener("click", () => document.querySelector("#new-plan-dialog").close());
document.querySelector("#new-blank").addEventListener("click", () => startNew("blank"));
document.querySelector("#new-sample").addEventListener("click", () => startNew("sample"));

function openNewPlan() {
  if (!editor || !account) return;
  document.querySelector("#file-menu").open = false;
  const warn = document.querySelector("#new-plan-warn");
  warn.textContent = editor.isDirty()
    ? (account.isSignedIn()
      ? "This plan has unsaved changes. A new Drive file keeps this copy, then the plan on screen is replaced."
      : "This plan has unsaved changes on this device. Starting a new plan discards them. Export JSON from the File menu if you want a copy.")
    : "The plan on screen is replaced. Open and Save are in the File menu.";
  document.querySelector("#new-plan-dialog").showModal();
}

async function startNew(kind) {
  if (!editor || !account) return;
  if (editor.isDirty()) {
    const signed = account.isSignedIn();
    const ok = window.confirm(signed
      ? "Save a new Drive copy of this plan, then start fresh?"
      : "Discard the unsaved changes and start a new plan?");
    if (!ok) return;
    if (signed) {
      const saved = await account.saveUnsavedCopy();
      if (!saved && !window.confirm("Drive did not save a copy. Discard the changes anyway?")) return;
    }
  }
  account.unbind();
  editor.replaceDocument(kind === "blank" ? blankPlan() : fourRoomSample(house));
  document.querySelector("#new-plan-dialog").close();
  document.dispatchEvent(new CustomEvent("app-toast", { detail: { text: kind === "blank" ? "Blank plan" : "Four-room sample" } }));
}
document.querySelector("#roof-toggle").addEventListener("click", () => {
  state.roof = state.roof === false;
  document.querySelector("#roof-toggle").setAttribute("aria-pressed", String(state.roof !== false));
  publish();
});
document.querySelector("#issues-toggle").addEventListener("click", () => {
  state.issuesOnly = !state.issuesOnly;
  document.querySelector("#issues-toggle").setAttribute("aria-pressed", String(!!state.issuesOnly));
  publish();
});
document.querySelector("#labor-open").addEventListener("click", () => document.querySelector("#labor-dialog").showModal());
document.querySelector("#labor-dialog [data-close]").addEventListener("click", () => document.querySelector("#labor-dialog").close());
}
function placeToast(toast) {
  const phone = !wide();
  toast.classList.toggle("toast-dock", phone);
  if (!phone) {
    toast.style.bottom = "";
    return;
  }
  const build = document.querySelector("#build-hud");
  const buildBox = build && !build.hidden ? build.getBoundingClientRect() : null;
  const lift = buildBox ? Math.max(12, window.innerHeight - buildBox.top + 10) : 132;
  toast.style.bottom = `${lift}px`;
}
document.addEventListener("budget-delta", (event) => {
  const toast = document.querySelector("#budget-toast");
  toast.textContent = event.detail.text;
  toast.hidden = false;
  placeToast(toast);
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => { toast.hidden = true; }, wide() ? 1600 : 1400);
});
document.addEventListener("app-toast", (event) => {
  const toast = document.querySelector("#app-toast");
  toast.replaceChildren(document.createTextNode(event.detail.text || ""));
  if (event.detail.undo) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Undo";
    button.addEventListener("click", () => {
      document.querySelector("#undo")?.click();
      toast.hidden = true;
    });
    toast.append(" ", button);
  }
  toast.hidden = false;
  placeToast(toast);
  window.clearTimeout(toast._timer);
  const phone = !wide();
  toast._timer = window.setTimeout(() => { toast.hidden = true; }, event.detail.undo ? (phone ? 2400 : 4200) : (phone ? 1600 : 2400));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    panelOpen = false;
    syncControls();
  }
});

wideQuery.addEventListener("change", () => {
  if (wide()) panelOpen = false;
  publish();
});

const observer = new ResizeObserver(() => {
  plan?.resize();
  model?.resize();
});
observer.observe(planCanvas.parentElement);
observer.observe(modelCanvas.parentElement);

if (document.fonts?.ready) {
  document.fonts.ready.then(() => plan?.redraw());
}

publish();
