import { costReport, formatMoney, materialsCsv, materialsDocument } from "../cost/list.js";
import { buildElectrical } from "../electrical/design.js";

const GROUPS = [
  ["hempcrete", "Hempcrete"],
  ["rammed-earth", "Rammed earth"],
  ["framing", "Framing"],
  ["openings", "Doors and windows"],
  ["finishes", "Finishes"],
  ["electrical", "Electrical"],
  ["labor", "Labor"],
  ["allowances", "Allowances, not in the total"],
];

export function attachCosts({ getHouse, getPhase, getSelection, setDiy }) {
  const chip = document.querySelector("#cost-chip");
  const dialog = document.querySelector("#cost-dialog");
  let hireFinish = false;

  chip.addEventListener("click", () => {
    paint();
    if (!dialog.open) dialog.showModal();
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.querySelector("#cost-hire").addEventListener("change", (event) => {
    hireFinish = event.target.checked;
    setDiy(!hireFinish);
    paint();
  });
  dialog.querySelector("#cost-csv").addEventListener("click", () => download("materials.csv", materialsCsv(currentDocument()), "text/csv"));
  dialog.querySelector("#cost-json").addEventListener("click", () => download("materials.json", JSON.stringify(currentDocument(), null, 2), "application/json"));
  document.querySelector("#export-materials-csv")?.addEventListener("click", () => download("materials.csv", materialsCsv(currentDocument()), "text/csv"));
  document.querySelector("#export-materials-json")?.addEventListener("click", () => download("materials.json", JSON.stringify(currentDocument(), null, 2), "application/json"));

  function currentDocument() {
    const house = getHouse();
    return materialsDocument(house, {
      phase: getPhase(),
      diyFinish: house.cost?.diyFinish !== false,
      hireFinish,
      overrides: house.cost?.overrides || [],
      rates: house.cost?.rates || [],
    });
  }

  function paint() {
    const house = getHouse();
    const phase = getPhase();
    const selection = getSelection();
    const report = costReport(house, {
      phase,
      diyFinish: house.cost?.diyFinish !== false,
      hireFinish,
      overrides: house.cost?.overrides || [],
      rates: house.cost?.rates || [],
    });
    chip.querySelector("#cost-figure").textContent = formatMoney(phase === "phase1" ? report.phase1Total : report.fullTotal);
    chip.querySelector("#cost-note").textContent = report.unpricedCount ? `${report.unpricedCount} unpriced` : "all priced";
    chip.title = `Phase 1 ${formatMoney(report.phase1Total)}. Full house ${formatMoney(report.fullTotal)}. ${report.unpricedCount} items still need a price.`;

    const focused = selection?.type === "wall" || selection?.type === "room"
      ? costReport(house, {
        phase: "full",
        wallId: selection.type === "wall" ? selection.id : null,
        roomId: selection.type === "room" ? selection.id : null,
        diyFinish: house.cost?.diyFinish !== false,
        hireFinish,
        overrides: house.cost?.overrides || [],
        rates: house.cost?.rates || [],
      })
      : null;

    dialog.querySelector("#cost-summary").innerHTML = `
      <p><strong>${phase === "phase1" ? "Phase 1" : "Full house"} ${formatMoney(report.pricedTotal)}</strong></p>
      <p class="fine">Phase 1 ${formatMoney(report.phase1Total)} · Full house ${formatMoney(report.fullTotal)} · ${report.unpricedCount} price needed</p>
      <p class="fine">Foundation, slab, and roof are listed and left out of the total. Plumbing is a later stage. Electrical lines with no published price stay out of the total.</p>`;
    dialog.querySelector("#cost-load").innerHTML = loadHtml(house, phase);
    dialog.querySelector("#cost-focus").innerHTML = focused
      ? `<h3>This ${selection.type}</h3>${linesHtml(focused.lines)}<p class="fine">${formatMoney(focused.pricedTotal)} priced on this ${selection.type}. ${focused.unpricedCount} still need a price.</p>`
      : "";
    dialog.querySelector("#cost-groups").innerHTML = GROUPS.map(([id, label]) => {
      const lines = report.lines.filter((line) => line.category === id);
      if (!lines.length) return "";
      return `<section><h3>${label}</h3>${linesHtml(lines)}</section>`;
    }).join("") + report.hooks.map((hook) => `<section><h3>${hook.name}</h3><p class="fine">${hook.note}</p></section>`).join("");
  }

  return { paint };
}

export function selectionCostHtml(house, selection) {
  if (!selection || (selection.type !== "wall" && selection.type !== "room")) return "";
  const report = costReport(house, {
    phase: "full",
    wallId: selection.type === "wall" ? selection.id : null,
    roomId: selection.type === "room" ? selection.id : null,
    diyFinish: house.cost?.diyFinish !== false,
    overrides: house.cost?.overrides || [],
    rates: house.cost?.rates || [],
  });
  return `<div class="mini-cost"><h3>Cost</h3><p>${formatMoney(report.pricedTotal)} priced · ${report.unpricedCount} unpriced</p>${linesHtml(report.lines.slice(0, 8))}</div>`;
}

function loadHtml(house, phase) {
  const design = buildElectrical(house, { phase });
  const load = design.load;
  if (!design.panel && !design.devices.length) {
    return `<section><h3>Service load</h3><p class="fine">Place a panel or a device to see the Article 220 steps, the recommended service, and each circuit.</p></section>`;
  }
  const spaces = design.circuits.reduce((sum, circuit) => sum + circuit.breakerPoles, 0);
  const steps = load.steps.map((step) => `<li><strong>${escapeHtml(step.label)}</strong> ${escapeHtml(step.detail)} · ${step.va.toLocaleString()} VA<p class="fine">${escapeHtml(step.section)}</p></li>`).join("");
  const circuits = design.circuits.map((circuit) => `<li>Circuit ${circuit.number} ${escapeHtml(circuit.name)} · ${circuit.amps}A · ${circuit.gauge} AWG · ${circuit.length} ft · ${circuit.voltageDrop.volts} V drop (${circuit.voltageDrop.percent}%)${circuit.gfci ? " · GFCI" : ""}${circuit.afci ? " · AFCI" : ""}</li>`).join("");
  const gaps = (design.gaps || []).map((gap) => `<li class="warn-line">${escapeHtml(gap.message)} ${escapeHtml(gap.section)}. <a href="${escapeAttr(gap.adoptionUrl)}" target="_blank" rel="noreferrer">WAC 296-46B-010</a></li>`).join("");
  return `<section>
    <h3>Service load</h3>
    <p><strong>Recommended service ${load.service}A</strong> from ${load.amps}A calculated (${load.va.toLocaleString()} VA). ${spaces} breaker spaces used.</p>
    <p class="fine">${escapeHtml(load.adoption)} <a href="${escapeAttr(load.adoptionUrl)}" target="_blank" rel="noreferrer">WAC 296-46B-010</a></p>
    <ol class="cost-lines">${steps}</ol>
    ${gaps ? `<ul class="cost-lines">${gaps}</ul>` : ""}
    ${circuits ? `<h3>Circuits</h3><ul class="cost-lines">${circuits}</ul><p class="fine">Voltage drop is 2 × 12.9 × amps × feet to the far device ÷ circular mils, from NEC Chapter 9 Table 8 copper, and it assumes the whole circuit current goes that far. Confirm the table. The cable length includes a vertical drop at every device. Eight devices per general circuit is an assumption, not a code maximum. The route is Manhattan distance from the panel plus a vertical drop from a 10 ft plate.</p>` : ""}
  </section>`;
}

function linesHtml(lines) {
  if (!lines.length) return `<p class="fine">Nothing in this group.</p>`;
  return `<ul class="cost-lines">${lines.map((line) => `
    <li>
      <span class="cost-name">${escapeHtml(line.name)}</span>
      <span>${formatQty(line.quantity)} ${escapeHtml(line.unit)}${line.lineTotal == null ? "" : ` · ${formatMoney(line.lineTotal)}`}${line.unitPrice == null ? "" : ` @ ${formatMoney(line.unitPrice)}`}</span>
      ${line.priceNeeded ? `<span class="price-needed">Price needed</span>` : ""}
      ${line.url ? `<a href="${escapeAttr(line.url)}" target="_blank" rel="noreferrer">${escapeHtml(line.sourceName)}</a>` : `<span class="fine">${escapeHtml(line.sourceName)}</span>`}
    </li>`).join("")}</ul>`;
}

function formatQty(value) {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
