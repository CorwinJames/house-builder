import { costReport, effectiveRecord, formatMoney, materialsCsv, materialsDocument } from "../cost/list.js";
import { BRANCH_DROP_PERCENT, RULES, buildElectrical, deviceShare, wallMethod } from "../electrical/design.js";
import { buildPlumbing, fixtureShare, linkedElectrical, linkedWell } from "../plumbing/design.js";

const GROUPS = [
  ["hempcrete", "Hempcrete"],
  ["rammed-earth", "Rammed earth"],
  ["framing", "Framing"],
  ["openings", "Doors and windows"],
  ["finishes", "Finishes"],
  ["electrical", "Electrical"],
  ["plumbing", "Plumbing"],
  ["site", "Site"],
  ["labor", "Labor"],
  ["allowances", "Allowances, not in the total"],
];

export function attachCosts({ getHouse, getPhase, getSelection, setDiy, setPhase }) {
  const chip = document.querySelector("#cost-chip");
  const dialog = document.querySelector("#cost-dialog");
  let hireFinish = false;

  chip.addEventListener("click", () => {
    paint();
    if (!dialog.open) dialog.showModal();
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("#cost-phase")?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-phase]");
      if (!button || !setPhase) return;
      setPhase(button.dataset.phase);
    });
  dialog.querySelector("#cost-nav")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-jump]");
    if (!button) return;
    dialog.querySelector(`#cost-${button.dataset.jump}`)?.scrollIntoView({ block: "start" });
  });
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

    const pricedLines = report.lines.filter((line) => !line.priceNeeded && !line.allowance);
    const pricedCount = pricedLines.length;
    const itemCount = report.lines.filter((line) => !line.allowance).length || 1;
    dialog.querySelector("#cost-total").textContent = formatMoney(report.pricedTotal);
    for (const button of dialog.querySelectorAll("#cost-phase button")) {
      button.setAttribute("aria-pressed", String(button.dataset.phase === phase));
    }
    dialog.querySelector("#cost-progress").innerHTML = `
      <div class="cost-progress"><span style="width:${Math.round((pricedCount / itemCount) * 100)}%"></span></div>
      <p class="fine">Priced ${pricedCount} of ${itemCount} items. Lines with no published price, and the foundation, slab, and roof allowances, stay out of the total.</p>`;
    const tiles = [
      ["structure", "Structure", ["hempcrete", "rammed-earth", "framing", "openings"]],
      ["electrical", "Electrical", ["electrical"]],
      ["plumbing", "Plumbing", ["plumbing"]],
      ["site", "Site", ["site"]],
      ["finishes", "Finishes", ["finishes"]],
      ["labor", "Labor", ["labor"]],
      ["allowances", "Allowances", ["allowances"]],
    ];
    const subtotal = (ids) => report.lines.filter((line) => ids.includes(line.category) && typeof line.lineTotal === "number" && !line.allowance)
      .reduce((sum, line) => sum + line.lineTotal, 0);
    dialog.querySelector("#cost-nav").innerHTML = tiles.map(([id, label]) => `<button type="button" data-jump="${id}">${label}</button>`).join("");
    dialog.querySelector("#cost-focus").innerHTML = focused
      ? `<h3>This ${selection.type}</h3>${linesHtml(focused.lines)}<p class="fine">${formatMoney(focused.pricedTotal)} priced on this ${selection.type}. ${focused.unpricedCount} still need a price.</p>`
      : "";
    dialog.querySelector("#cost-groups").innerHTML = tiles.map(([id, label, ids]) => {
      const lines = report.lines.filter((line) => ids.includes(line.category));
      if (!lines.length && id !== "electrical" && id !== "plumbing") return "";
      const extra = id === "electrical" ? `<details class="tech"><summary>Service load and circuits</summary>${loadHtml(house, phase)}</details>` : "";
      const pipes = id === "plumbing" ? `<details class="tech"><summary>Drain sizes and the stub</summary>${plumbingHtml(house, phase)}</details>` : "";
      return `<section id="cost-${id}"><h3>${label}</h3><p class="fine">${id === "allowances" ? "Not in the total" : formatMoney(subtotal(ids))}</p>${linesHtml(lines)}${extra}${pipes}</section>`;
    }).join("") + report.hooks.map((hook) => `<section><h3>${hook.name}</h3><p class="fine">${hook.note}</p></section>`).join("");
  }

  return { paint };
}

const WIRE_METHODS = [
  ["stud-bay", "Stud bay"],
  ["conduit", "Conduit in the wall"],
  ["raceway", "Surface raceway"],
];

function priceTakeoffRows(house, rows) {
  const overrides = house.cost?.overrides || [];
  return rows.map((row) => {
    const record = effectiveRecord(row.wageId || row.id, overrides);
    const unitPrice = record ? record.amount : null;
    const priceNeeded = typeof unitPrice !== "number";
    const lineTotal = priceNeeded ? null : Math.round(row.quantity * unitPrice * 100) / 100;
    return {
      ...row,
      name: row.kind === "labor" ? "Electrical labor" : (record?.name || row.id),
      unitPrice: priceNeeded ? null : unitPrice,
      lineTotal,
      priceNeeded,
      sourceName: record?.sourceName || "Price needed",
      url: record?.url || "",
    };
  });
}

function summarizeRows(lines) {
  const pricedTotal = Math.round(lines.filter((line) => !line.priceNeeded).reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100;
  const unpricedCount = lines.filter((line) => line.priceNeeded).length;
  return { lines, pricedTotal, unpricedCount };
}

function wallCost(house, wallId) {
  const design = buildElectrical(house, { phase: "full" });
  const rows = design.devices
    .filter((device) => device.wallId === wallId)
    .flatMap((device) => deviceShare(house, device.id));
  return summarizeRows(priceTakeoffRows(house, rows));
}

function methodDiff(base, alt) {
  if (!base || !alt) return "";
  const delta = Math.round((alt.pricedTotal - base.pricedTotal) * 100) / 100;
  const money = delta === 0 ? "same priced total" : `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))} priced`;
  const unpriced = alt.unpricedCount - base.unpricedCount;
  const extra = unpriced > 0 ? " · more price-needed lines" : unpriced < 0 ? " · fewer price-needed lines" : "";
  return `${money}${extra}`;
}

function pricedShare(house, fixtureId) {
  return summarizeRows(priceTakeoffRows(house, fixtureShare(house, fixtureId)));
}

export function fixtureCostHtml(house, fixture) {
  const own = pricedShare(house, fixture.id);
  const methods = ["manifold", "trunk"].map((id) => {
    const next = JSON.parse(JSON.stringify(house));
    next.plumbing.supplyMethod = id;
    return { id, label: id === "manifold" ? "PEX home-run manifold" : "Trunk and branch", report: pricedShare(next, fixture.id) };
  });
  const currentMethod = house.plumbing?.supplyMethod || "manifold";
  const current = methods.find((item) => item.id === currentMethod)?.report;
  const heaters = fixture.kind === "water-heater" ? ["electric-tank", "heat-pump"].map((id) => {
    const next = JSON.parse(JSON.stringify(house));
    const target = next.plumbing.fixtures.find((item) => item.id === fixture.id);
    if (target) target.heaterType = id;
    return { id, label: id === "electric-tank" ? "Electric tank" : "Heat-pump water heater", report: pricedShare(next, fixture.id) };
  }) : [];
  const design = buildPlumbing(house);
  const hot = design.supply.filter((item) => item.fixtureId === fixture.id && item.service === "hot");
  const gallons = hot.reduce((sum, item) => sum + item.gallons, 0);
  const wait = gallons > 0 ? roundSeconds(gallons / 2 * 60) : 0;
  const link = linkedElectrical(house, fixture);
  const well = fixture.kind === "water-heater" ? null : linkedWell(house);
  return `
    <div class="method-list">${methods.map((item) => `
      <button type="button" class="method-choice" data-supply="${item.id}" aria-pressed="${item.id === currentMethod}">
        <span>${item.label}</span>
        <span class="fine">${item.id === currentMethod ? "This house now" : escapeHtml(`For this fixture, ${methodDiff(current, item.report)}`)}</span>
      </button>`).join("")}</div>
    ${heaters.length ? `<div class="method-list">${heaters.map((item) => `
      <button type="button" class="method-choice" data-heater="${item.id}" aria-pressed="${fixture.heaterType === item.id}">
        <span>${item.label}</span>
        <span class="fine">${fixture.heaterType === item.id ? "This heater now" : escapeHtml(`For this fixture, ${methodDiff(heaters.find((row) => row.id === fixture.heaterType)?.report || item.report, item.report)}`)}</span>
      </button>`).join("")}</div>` : ""}
    <details class="tech">
      <summary>Technical details</summary>
      ${heaters.length ? `<p class="fine">${link ? `Tied to the stage 5 ${link.kind} circuit.` : "No matching 240V circuit yet. Place a water heater or heat pump in Electrical."}</p>` : ""}
      ${fixture.kind !== "water-heater" && house.plumbing?.entry ? `<p class="fine">${well ? "The water entry is tied to the well-pump circuit." : "The well pump's 240V circuit is not placed yet."}</p>` : ""}
      ${gallons ? `<p>Hot water in this run: ${gallons} gal. At an assumed 2 gpm that is about ${wait} seconds. The flow rate is an assumption.</p>` : ""}
      ${design.building.length ? `<p class="fine">Building drain ${design.building.size} in., ${design.building.length} ft, slope ${design.building.slope.inchesPerFoot} in./ft, invert drop ${design.building.slope.inches} in. at the septic stub.</p>` : ""}
      ${own.lines.length ? `${linesHtml(own.lines)}<p class="fine">${formatMoney(own.pricedTotal)} priced on this fixture · ${own.unpricedCount} still need a price.</p>` : `<p class="fine">Accept the suggestion to price this fixture.</p>`}
    </details>`;
}

function roundSeconds(value) {
  return Math.round(value);
}

function plumbingHtml(house, phase) {
  const design = buildPlumbing(house, { phase });
  if (!design.fixtures.length && !design.entry) {
    return `<section><h3>Plumbing</h3><p class="fine">Place a fixture to see the drain size, the slope, and the septic stub.</p></section>`;
  }
  const arms = design.dwv.map((leg) => `<li>${escapeHtml(leg.kind)} · ${leg.dfu} DFU · ${leg.size} in. drain · trap arm ${leg.trapArm} ft</li>`).join("");
  return `<section>
    <h3>Drains and the septic stub</h3>
    <p><strong>${design.dfu} DFU</strong> · building drain ${design.building.size || "—"} in. · ${design.building.length} ft · slope ${design.building.slope.inchesPerFoot} in. per ft · invert drop ${design.building.slope.inches} in. at the exit.</p>
    <p class="fine">Supply fixture units ${design.wsfu.total} (cold ${design.wsfu.cold}, hot ${design.wsfu.hot}). Home-run branches are assumed 1/2 in. PEX until UPC Table 610.4 is confirmed for the water pressure. ${design.vent.size ? `Vent ${design.vent.size} in.` : "No vent yet."} ${design.cleanouts} cleanouts.</p>
    ${arms ? `<ul class="cost-lines">${arms}</ul>` : ""}
  </section>`;
}

export function deviceCostHtml(house, device) {
  const own = summarizeRows(priceTakeoffRows(house, deviceShare(house, device.id)));
  const wall = (house.walls || []).find((item) => item.id === device.wallId);
  const methods = wall ? WIRE_METHODS.map(([id, label]) => {
    const next = JSON.parse(JSON.stringify(house));
    next.electrical.wallMethods = { ...(next.electrical.wallMethods || {}), [wall.id]: id };
    return { id, label, report: wallCost(next, wall.id) };
  }) : [];
  const currentId = wall ? wallMethod(house, wall) : "";
  const current = methods.find((item) => item.id === currentId)?.report;
  const choices = methods.map((item) => `
    <button type="button" class="method-choice" data-method="${item.id}" aria-pressed="${item.id === currentId}">
      <span>${escapeHtml(item.label)}</span>
      <span class="fine">${item.id === currentId ? "This wall now" : escapeHtml(`For this wall, ${methodDiff(current, item.report)}`)}</span>
    </button>`).join("");
  return `
    ${wall ? `<div class="method-list">${choices}</div>` : ""}
    <details class="tech">
      <summary>Technical details</summary>
      <p class="fine">${wall ? "Choosing one sets it for the whole wall. Hempcrete and rammed earth default to conduit so the cable is not buried in the mass. Surface raceway stays out of that mass. Both need an electrician and the inspector to confirm." : "This one is not on a wall, so the run is treated as ceiling or attic cable."}</p>
      ${own.lines.length ? `${linesHtml(own.lines)}<p class="fine">${formatMoney(own.pricedTotal)} priced on this device · ${own.unpricedCount} still need a price.</p>` : `<p class="fine">Accept the suggestion to price this device.</p>`}
    </details>`;
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
  const circuits = design.circuits.map((circuit) => `<li${circuit.voltageDrop.percent > BRANCH_DROP_PERCENT ? ` class="warn-line"` : ""}>Circuit ${circuit.number} ${escapeHtml(circuit.name)} · ${circuit.amps}A · ${circuit.gauge} AWG · ${circuit.length} ft · ${circuit.voltageDrop.volts} V drop (${circuit.voltageDrop.percent}%)${circuit.gfci ? " · GFCI" : ""}${circuit.afci ? " · AFCI" : ""}${circuit.voltageDrop.percent > BRANCH_DROP_PERCENT ? `. Over 3% branch-circuit guidance (${escapeHtml(RULES.voltageDrop.section)}).` : ""}</li>`).join("");
  const gaps = (design.gaps || []).map((gap) => `<li class="warn-line">${escapeHtml(gap.message)} ${escapeHtml(gap.section)}. <a href="${escapeAttr(gap.adoptionUrl)}" target="_blank" rel="noreferrer">WAC 296-46B-010</a></li>`).join("");
  return `<section>
    <h3>Service load</h3>
    <p><strong>Recommended service ${load.service}A</strong> from ${load.amps}A calculated (${load.va.toLocaleString()} VA). ${spaces} breaker spaces used.</p>
    <p class="fine">${escapeHtml(load.adoption)} <a href="${escapeAttr(load.adoptionUrl)}" target="_blank" rel="noreferrer">WAC 296-46B-010</a></p>
    <ol class="cost-lines">${steps}</ol>
    ${gaps ? `<ul class="cost-lines">${gaps}</ul>` : ""}
    ${circuits ? `<h3>Circuits</h3><ul class="cost-lines">${circuits}</ul><p class="fine">Voltage drop is 2 × 12.9 × amps × feet to the far device ÷ circular mils, from NEC Chapter 9 Table 8 copper, and it assumes the whole circuit current goes that far. Confirm the table. ${escapeHtml(RULES.voltageDrop.section)} recommends 3% on the branch and 5% with the feeder. It is guidance. The cable length includes a vertical drop at every device. Circuits are split to stay near that 3% when they can. Eight devices per circuit is still the assumed cap, not a code maximum.</p>` : ""}
  </section>`;
}

function linesHtml(lines) {
  if (!lines.length) return `<p class="fine">Nothing in this group.</p>`;
  return `<ul class="cost-lines">${lines.map((line) => `
    <li class="shop-row">
      <span class="cost-name">${escapeHtml(line.name)}</span>
      <span>${formatQty(line.quantity)} ${escapeHtml(line.unit)}</span>
      ${line.priceNeeded ? `<span class="price-needed">Price needed</span>` : `<span>${formatMoney(line.lineTotal)}</span>`}
      ${line.url ? `<a href="${escapeAttr(line.url)}" target="_blank" rel="noreferrer">${escapeHtml(line.sourceName)}</a>` : (line.priceNeeded ? `<span></span>` : `<span class="fine">${escapeHtml(line.sourceName || "")}</span>`)}
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
