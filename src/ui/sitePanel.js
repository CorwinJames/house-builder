import { SEPTIC_KINDS, WELL_KINDS, buildSite, siteBom } from "../site/design.js";
import { fallCard, gameHead, quietDelete, statTiles, techBlock } from "./gamecard.js";

export const SITE_KINDS = [
  { id: "well", label: "Well" },
  { id: "tank", label: "Septic tank" },
  { id: "drainfield", label: "Drain field" },
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

export function siteOptionsHtml(kind, ghosts = []) {
  const chosen = SITE_KINDS.find((item) => item.id === kind);
  const preview = ghosts.length
    ? `<div class="suggest-list">
        <div class="suggest-head"><strong>Preview</strong><button type="button" class="hud-pill pill-primary" id="accept-all-site">Accept all</button></div>
        ${ghosts.map((ghost) => `<div class="suggest-row"><span>${escapeHtml(ghost.label)}</span>
          <button type="button" class="hud-pill" data-accept-site="${ghost.kind}">Accept</button>
          <button type="button" class="hud-pill" data-skip-site="${ghost.kind}">Skip</button></div>`).join("")}
      </div>`
    : "";
  return `<div class="seg" id="site-kind">${SITE_KINDS.map((item) => `<button type="button" data-site="${item.id}" aria-pressed="${item.id === kind}">${item.label}</button>`).join("")}</div>
    <p class="fine">Placing ${escapeHtml(chosen?.label || "a site item")}. A ghost follows the pointer. Click the lot to place it.</p>
    <button type="button" class="hud-pill" id="suggest-site">Suggest placements</button>
    ${preview}`;
}

function priceLine(house, ids) {
  const row = siteBom(house).find((item) => ids.includes(item.id));
  const detail = row?.basis || "No published price was found.";
  return `<p class="cost-line"><strong>Price needed</strong> · ${escapeHtml(detail)} This stays out of the total.</p>`;
}

export function siteInspectorHtml(house, selection) {
  const view = buildSite(house);
  if (!view || !selection) return "";
  if (selection.type === "well" && house.site.well) {
    const well = house.site.well;
    const pump = (house.electrical?.devices || []).some((device) => device.kind === "well-pump" && !device.ghost);
    const entry = house.plumbing?.entry;
    return `
      ${gameHead("Well", [])}
      ${statTiles([
        { icon: "W", value: labelOf(WELL_KINDS, well.kind), label: "Kind" },
        { icon: "↪", value: entry ? "Tied in" : "No entry", label: "Water entry" },
        { icon: "⚡", value: pump ? "On" : "Missing", label: "Pump circuit" },
        { icon: "$", value: "Needed", label: "Price" },
      ])}
      <label>Kind <select id="well-kind">${WELL_KINDS.map((item) => `<option value="${item.id}" ${item.id === well.kind ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
      ${priceLine(house, ["well-drilled", "well-shared"])}
      ${techBlock(`<p>100 ft from a drainfield. ${well.kind === "public" ? "100" : "50"} ft from the tank. 5 ft from the house. WAC 173-160-171 and Table IV. No published drilling price was found.</p>`)}
      ${quietDelete("Delete well")}`;
  }
  if (selection.type === "septic" || selection.type === "drainfield" || selection.type === "reserve") {
    const septic = house.site.septic;
    const gravity = view.gravity;
    const headline = gravity.pumped
      ? "Pump system"
      : gravity.ok
        ? "Gravity reaches"
        : `Short ${round(gravity.shortInches)} in`;
    const issues = gravity.ok || gravity.pumped ? [] : [{ severity: "warning", title: headline, why: "" }];
    const fall = gravity.pumped
      ? fallCard("Pump system", "Gravity fall is not the limit for this kind.", true)
      : fallCard(headline, `Needs ${round(gravity.needInches)} in · ground falls ${round(gravity.groundInches)} in`, gravity.ok);
    const action = !gravity.pumped && !gravity.ok && gravity.reason !== "missing"
      ? `<p class="action-line">Move the tank closer to the house so the ground can fall ${round(gravity.needInches)} in, or switch Kind to Pressure or Mound.</p>`
      : "";
    return `
      ${gameHead("Septic", issues)}
      ${fall}
      ${action}
      ${statTiles([
        { icon: "↓", value: `${round(gravity.stubInches)} in`, label: "Stub drop" },
        { icon: "↔", value: `${round(gravity.runFt)} ft`, label: "To tank" },
        { icon: "▦", value: `${Math.round(view.primarySqFt)} sf`, label: "Field" },
        { icon: "R", value: `${Math.round(view.reserveSqFt)} sf`, label: "Reserve" },
      ])}
      <label>Kind <select id="septic-kind">${SEPTIC_KINDS.map((item) => `<option value="${item.id}" ${item.id === septic?.kind ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
      ${priceLine(house, ["septic-tank", "drainfield"])}
      ${techBlock(`<p>${view.bedrooms} bedrooms · ${view.flow} gal/day. Primary ${Math.round(view.primarySqFt)} sq ft. Reserve ${Math.round(view.reserveSqFt)} sq ft. Rate ${septic?.loadingRate || 0.2} gal/sq ft/day · confirm Table VIII. Price needed.</p>`)}
      ${quietDelete("Delete septic")}`;
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
