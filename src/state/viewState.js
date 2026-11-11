import { LAYER_DEFS } from "../layers.js";

const KEY = "house-builder.view.v1";

function defaultLayers() {
  return Object.fromEntries(LAYER_DEFS.map((layer) => [layer.id, !layer.stub]));
}

export function defaultViewState() {
  return {
    version: 2,
    view: "split",
    phase: "full",
    layers: defaultLayers(),
    plan: null,
    camera: null,
    hintDismissed: false,
  };
}

export function loadViewState() {
  const base = defaultViewState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      ...base,
      ...parsed,
      layers: {
        ...base.layers,
        ...(parsed.layers || {}),
        ...(parsed.version === 2 ? {} : { site: true }),
      },
    };
  } catch {
    return base;
  }
}

export function saveViewState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode and full storage should not break the viewer.
  }
}
