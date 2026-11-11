import { SEPTIC_KINDS, WELL_KINDS, buildSite } from "../site/design.js";

export const SITE_KINDS = [
  { id: "well", label: "Well" },
  { id: "tank", label: "Tank" },
  { id: "drainfield", label: "Field" },
  { id: "reserve", label: "Reserve" },
];

function round(value) {
  return Math.round(value * 10) / 10;
}

export function siteCardHtml(house) {
  const view = buildSite(house);
  if (!view) return "";
  const soil = house.site.soil?.mapUnitName || "Not mapped";
  const gravity = view.gravity;
  const fall = gravity?.pumped
    ? "Pump · gravity not required"
    : gravity?.ok
      ? `Gravity reaches · ground ${round(gravity.groundInches)} in, need ${round(gravity.needInches)} in`
      : gravity?.reason === "missing"
        ? "Place a tank to check gravity"
        : `Gravity short ${round(gravity.shortInches)} in`;
  return `
    <p class="site-kicker">${escapeHtml(house.site.label || "Parcel")}</p>
    <p class="site-title">${view.acres.toFixed(2)} acres</p>
    <p>${escapeHtml(soil)}</p>
    <p>${escapeHtml(fall)}</p>
    <p>Pad cut ${round(view.grade.cutYd)} yd · fill ${round(view.grade.fillYd)} yd</p>
    <details>
      <summary>Setbacks and pad</summary>
      <p>${escapeHtml(house.site.zone?.district || "Zone")} · road ${escapeHtml(house.site.zone?.roadClass || "local-access")}. Front ${house.site.zone?.frontFt || 20} ft, side and rear ${house.site.zone?.sideFt || 5} ft. JCC 18.30.050 Table 6-1.</p>
      <p>Pad at ${round(view.grade.padFt)} ft. Cut and fill are a grid estimate. Price needed.</p>
      <p class="fine">${escapeHtml(house.site.terrain?.note || "")}</p>
      <p class="fine">${escapeHtml(house.site.parcel?.note || "")}</p>
    </details>`;
}

export function siteOptionsHtml(kind) {
  return `<div class="seg" id="site-kind">${SITE_KINDS.map((item) => `<button type="button" data-site="${item.id}" aria-pressed="${item.id === kind}">${item.label}</button>`).join("")}</div>
    <p class="fine">Click the lot to place it. Driveway and power are dashed placeholders.</p>`;
}

export function siteInspectorHtml(house, selection) {
  const view = buildSite(house);
  if (!view || !selection) return "";
  if (selection.type === "well" && house.site.well) {
    const well = house.site.well;
    const pump = (house.electrical?.devices || []).some((device) => device.kind === "well-pump" && !device.ghost);
    const entry = house.plumbing?.entry;
    return `
      <h2>Well</h2>
      <p>${labelOf(WELL_KINDS, well.kind)}</p>
      <label>Kind <select id="well-kind">${WELL_KINDS.map((item) => `<option value="${item.id}" ${item.id === well.kind ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
      <p>${entry ? "Tied to the water entry." : "No water entry yet."} ${pump ? "Well-pump circuit is on." : "No well-pump circuit yet."}</p>
      <p class="fine">Price needed.</p>
      <details>
        <summary>Distances</summary>
        <p>100 ft from a drainfield. ${well.kind === "public" ? "100" : "50"} ft from the tank. 5 ft from the house. WAC 173-160-171 and Table IV.</p>
      </details>
      <button type="button" id="edit-delete">Delete well</button>`;
  }
  if (selection.type === "septic" || selection.type === "drainfield" || selection.type === "reserve") {
    const septic = house.site.septic;
    const gravity = view.gravity;
    const headline = gravity.pumped
      ? "Pump system"
      : gravity.ok
        ? "Gravity reaches"
        : `Short ${round(gravity.shortInches)} in`;
    return `
      <h2>Septic</h2>
      <p>${headline}</p>
      <p>Stub ${round(gravity.stubInches)} in down · ${round(gravity.runFt)} ft to the tank · ground falls ${round(gravity.groundInches)} in</p>
      <label>Kind <select id="septic-kind">${SEPTIC_KINDS.map((item) => `<option value="${item.id}" ${item.id === septic?.kind ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
      <details open>
        <summary>Field</summary>
        <p>${view.bedrooms} bedrooms · ${view.flow} gal/day. Primary ${Math.round(view.primarySqFt)} sq ft. Reserve ${Math.round(view.reserveSqFt)} sq ft. Rate ${septic?.loadingRate || 0.2} · confirm Table VIII.</p>
      </details>
      <p class="fine">Price needed.</p>
      <button type="button" id="edit-delete">Delete septic</button>`;
  }
  return "";
}

function labelOf(list, id) {
  return list.find((item) => item.id === id)?.label || id;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
