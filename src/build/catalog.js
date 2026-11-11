import assembliesFile from "../../data/assemblies.json" with { type: "json" };
import headersFile from "../../data/headers.json" with { type: "json" };
import openingCatalog from "../../data/opening-catalog.json" with { type: "json" };

export const assemblies = assembliesFile.assemblies;
export const assemblyById = Object.fromEntries(assemblies.map((item) => [item.id, item]));
export const headersTable = headersFile;
export const openingItems = openingCatalog.items;

export const DEFAULT_EXTERIOR_ID = assemblies.find((item) => item.defaultExterior)?.id || assemblies[0].id;
export const RAMMED_EARTH_ID = "rammed-earth-exterior";
export const INTERIOR_ID = "interior-partition";

export function assemblyForRender(renderAssembly) {
  return assemblies.find((item) => item.renderAssembly === renderAssembly) || assemblies[0];
}

/** South-running walls in this house are the rammed-earth ones. East-west means the wall itself runs east-west. */
export function suggestAssemblyId(start, end, selectedId, explicit) {
  if (explicit) return selectedId;
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const eastWest = dx > dy * 2;
  if (eastWest && selectedId === DEFAULT_EXTERIOR_ID) return RAMMED_EARTH_ID;
  return selectedId;
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
