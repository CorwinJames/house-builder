import assembliesFile from "../../data/assemblies.json" with { type: "json" };
import headersFile from "../../data/headers.json" with { type: "json" };
import openingCatalog from "../../data/opening-catalog.json" with { type: "json" };

export const assemblies = assembliesFile.assemblies;
export const assemblyById = Object.fromEntries(assemblies.map((item) => [item.id, item]));
export const headersTable = headersFile;
export const openingItems = openingCatalog.items;

/** Door tool lists doors only. Window tool lists windows only. */
export function catalogForTool(tool) {
  if (tool === "door") return openingItems.filter((item) => item.type === "door");
  if (tool === "window") return openingItems.filter((item) => item.type === "window");
  return [];
}

export const DEFAULT_EXTERIOR_ID = assemblies.find((item) => item.defaultExterior)?.id || assemblies[0].id;
export const RAMMED_EARTH_ID = "rammed-earth-exterior";
export const INTERIOR_ID = "interior-partition";

export function assemblyForRender(renderAssembly) {
  return assemblies.find((item) => item.renderAssembly === renderAssembly) || assemblies[0];
}

/** How far an exterior face can turn from due south and still suggest rammed earth. */
export const SOUTH_FACE_TOLERANCE_DEG = 30;

/**
 * True when `outward` points south, within SOUTH_FACE_TOLERANCE_DEG.
 * Plan north is +y, so south is −y.
 */
export function facePointsSouth(outward, degrees = SOUTH_FACE_TOLERANCE_DEG) {
  const length = Math.hypot(outward?.x || 0, outward?.y || 0);
  if (length < 1e-8) return false;
  const southward = -outward.y / length;
  return southward >= Math.cos((degrees * Math.PI) / 180) - 1e-12;
}

/**
 * Suggest rammed earth only for an exterior wall whose outward face points south.
 * Every other exterior wall stays hempcrete. An explicit palette choice is kept.
 * `outward` is the outside normal in plan coordinates (north is +y).
 */
export function suggestAssemblyId(start, end, selectedId, explicit, outward = null) {
  void start;
  void end;
  if (explicit || selectedId !== DEFAULT_EXTERIOR_ID) return selectedId;
  if (facePointsSouth(outward)) return RAMMED_EARTH_ID;
  return DEFAULT_EXTERIOR_ID;
}

export function headerForSpan(span) {
  const entry = headersTable.entries.find((item) => span <= item.maxSpan) || headersTable.entries.at(-1);
  return {
    placeholder: true,
    label: entry.label,
    depth: entry.depth,
    height: entry.height,
    note: "placeholder: needs engineer/code verification",
  };
}

export function cornerClearance() {
  return headersTable.clearanceFromCorner;
}
