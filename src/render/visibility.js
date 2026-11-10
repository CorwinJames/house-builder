/**
 * Phase and the Future wings layer both have to allow a future element.
 * Phase 1 only hides later wings even if that layer is on.
 * Full house hides them when the layer is off.
 */
export function isFutureShown(state) {
  return state.phase === "full" && !!state.layers.future;
}

export function isPhaseVisible(phase, state) {
  if (phase !== "future") return true;
  return isFutureShown(state);
}
