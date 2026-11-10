/**
 * Layer registry shared by the plan and the 3D view.
 *
 * To add a layer, see "How to add a new layer" in AGENTS.md.
 * Stub layers (electrical, plumbing, site) have toggles and empty
 * draw groups so later stages can fill them without a new UI concept.
 */
export const LAYER_DEFS = [
  { id: "framing", label: "Framing", stub: false },
  { id: "infill", label: "Hempcrete / wall infill", stub: false },
  { id: "finishes", label: "Finishes", stub: false },
  { id: "future", label: "Future wings", stub: false },
  { id: "dimensions", label: "Dimensions", stub: false },
  { id: "labels", label: "Labels", stub: false },
  { id: "electrical", label: "Electrical", stub: true },
  { id: "plumbing", label: "Plumbing", stub: true },
  { id: "site", label: "Site", stub: true },
];

export const LAYER_IDS = LAYER_DEFS.map((layer) => layer.id);

/** Which drawing layer a wall belongs to. Future-ness is a separate filter. */
export function wallLayerId(wall) {
  return wall.assembly === "framed" ? "framing" : "infill";
}
