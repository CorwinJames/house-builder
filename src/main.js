import "./styles.css";
import house from "../data/sample-house.json";
import { LAYER_DEFS } from "./layers.js";
import { formatArea } from "./lib/format.js";
import { loadViewState, saveViewState } from "./state/viewState.js";
import { createPlanView } from "./render/plan2d.js";
import { createView3d } from "./render/view3d.js";
import { polygonArea } from "./lib/geom.js";
import { footprintMatch } from "./build/constraints.js";
import { attachEditor } from "./ui/editor.js";

const wideQuery = window.matchMedia("(min-width: 861px)");
const state = loadViewState();
let panelOpen = false;

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
        <div>
          <p class="eyebrow">James &amp; Sophie · Jefferson County, WA</p>
          <h1>House Builder</h1>
        </div>
      </div>
      <p class="sample-chip">Sample layout · not a final design</p>
      <div class="controls">
        <div class="seg" id="mode-seg" role="group" aria-label="View or build">
          <button type="button" data-mode="view">View</button>
          <button type="button" data-mode="build">Build</button>
        </div>
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
      <div id="build-bar" class="build-bar" hidden></div>
    </header>
    <div class="workspace">
      <aside class="layer-panel" id="layer-panel">
        <div id="inspector" class="inspector" hidden></div>
        <div class="panel-head">
          <h2>Layers</h2>
          <button type="button" class="icon-btn" id="layers-close" aria-label="Close layers">Close</button>
        </div>
        <div class="layer-list" id="layer-list"></div>
        <div class="legend">
          <h2>Materials</h2>
          <div class="swatch-row"><span class="swatch earth"></span> Rammed earth, south walls</div>
          <div class="swatch-row"><span class="swatch hemp"></span> Hempcrete, other exterior walls</div>
          <div class="swatch-row"><span class="swatch frame"></span> Wood framing, interior walls</div>
          <div class="swatch-row"><span class="swatch later"></span> Later wings, dashed</div>
        </div>
      </aside>
      <div class="stage" id="stage" data-view="split">
        <section class="viewport viewport-plan" aria-label="Plan view">
          <canvas id="plan-canvas"></canvas>
          <div class="hud"><span>Plan · north up</span><button type="button" id="fit-plan">Fit</button></div>
        </section>
        <section class="viewport viewport-model" aria-label="3D view">
          <canvas id="model-canvas"></canvas>
          <div class="hud"><span>3D · roof is a placeholder</span><button type="button" id="reset-3d">Reset view</button></div>
          <p class="webgl-fallback" id="webgl-fallback" hidden></p>
        </section>
      </div>
    </div>
    <footer class="statusbar" id="status"></footer>
  </div>
  <div class="scrim" id="scrim" hidden></div>
  <div class="hint" id="build-tutorial" hidden></div>
  <div class="hint" id="hint" role="dialog" aria-labelledby="hint-title">
    <p id="hint-title">Drag the plan to move around. Scroll or pinch to zoom. In 3D, drag to look around the house. Solid rooms are Phase 1, the first part to build. Dashed rooms are later wings. This sample is a starting point, not the final house.</p>
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
const plan = createPlanView(planCanvas, house);
const model = createView3d(modelCanvas, house);
let editor;
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
    if (editor) publish();
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

function wide() {
  return wideQuery.matches;
}

function effectiveView() {
  if (!wide() && state.view === "split") return "plan";
  return state.view;
}

function statusText() {
  const doc = editor.house();
  let phase1 = 0;
  let all = 0;
  for (const room of doc.rooms) {
    const area = polygonArea(room.polygon);
    all += area;
    if (room.phase === "phase1") phase1 += area;
  }
  const stubs = LAYER_DEFS.filter((layer) => layer.stub && state.layers[layer.id]).map((layer) => layer.label);
  const stubNote = stubs.length ? ` · ${stubs.join(", ")}: nothing in this layer yet` : "";
  const futureNote = state.phase === "full" && !state.layers.future ? " · Future wings layer is off" : "";
  const phaseNote = state.phase === "phase1" ? "Phase 1 only" : "Full house";
  const foot = footprintMatch(doc, doc.customRatios || []);
  let footNote = "";
  if (foot?.badge) {
    const percent = foot.deviation * 100;
    footNote = foot.exact
      ? ` · Footprint ${foot.badge} exact`
      : ` · Footprint ${foot.badge} ${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)}%`;
  }
  return `${phaseNote} · Phase 1 rooms ${formatArea(phase1)} sq ft · All rooms ${formatArea(all)} sq ft${footNote}${futureNote}${stubNote}`;
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
  document.querySelector("#status").textContent = statusText();
  document.querySelector("#hint").hidden = !!state.hintDismissed;
  const showPanel = panelOpen && !wide();
  document.querySelector("#layer-panel").classList.toggle("open", showPanel);
  document.querySelector("#scrim").hidden = !showPanel;
  document.querySelector("#layers-btn").setAttribute("aria-expanded", String(showPanel));
}

function publish() {
  saveViewState(state);
  syncControls();
  plan.setState(state);
  model.setState(state);
  requestAnimationFrame(() => {
    plan.resize();
    model.resize();
  });
}

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
document.querySelector("#fit-plan").addEventListener("click", () => plan.fit());
document.querySelector("#reset-3d").addEventListener("click", () => model.resetCamera());

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
  plan.resize();
  model.resize();
});
observer.observe(planCanvas.parentElement);
observer.observe(modelCanvas.parentElement);

if (document.fonts?.ready) {
  document.fonts.ready.then(() => plan.redraw());
}

publish();
