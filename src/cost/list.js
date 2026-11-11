import pricesFile from "../../data/prices.json" with { type: "json" };
import assumptions from "../../data/cost-assumptions.json" with { type: "json" };
import { takeoff } from "./takeoff.js";

export const priceRecords = pricesFile.records;

const byId = Object.fromEntries(priceRecords.map((record) => [record.id, record]));

export function priceProblems(records = priceRecords) {
  const problems = [];
  for (const record of records) {
    if (!record.sourceName) problems.push(`${record.id} is missing a source`);
    if (!record.dateChecked) problems.push(`${record.id} is missing a date`);
    if (!record.unit) problems.push(`${record.id} is missing a unit`);
    if (record.kind !== "material" && record.kind !== "labor") problems.push(`${record.id} needs kind material or labor`);
    if (!record.sourceType) problems.push(`${record.id} is missing a source type`);
    if (typeof record.amount === "number" && !record.url) problems.push(`${record.id} has a price and no URL`);
  }
  return problems;
}

export function effectiveRecord(id, overrides = []) {
  const base = byId[id];
  if (!base) return null;
  const bid = overrides.find((item) => item.priceId === id && (item.sourceType === "bid" || item.sourceType === "user-entry"));
  if (!bid || typeof bid.amount !== "number") return base;
  return {
    ...base,
    amount: bid.amount,
    sourceType: bid.sourceType,
    sourceName: bid.note || "Your figure",
    url: bid.url || base.url,
    dateChecked: bid.date || base.dateChecked,
  };
}

function laborName(id) {
  if (id === "hempcrete-place") return "Place hempcrete";
  if (id === "rammed-place") return "Rammed earth labor";
  if (id === "frame") return "Framing labor";
  if (id === "paint-labor") return "Paint labor";
  if (id === "flooring-labor") return "Flooring labor";
  if (id === "tile-labor") return "Tile labor";
  return id;
}

function money(quantity, unitPrice) {
  if (typeof unitPrice !== "number") return null;
  return Math.round(quantity * unitPrice * 100) / 100;
}

/**
 * Priced lines for one phase. Allowances stay on the list and out of the total.
 * DIY finish labor is $0 until hireFinish is true.
 */
export function costLines(house, { phase = "full", diyFinish = true, hireFinish = false, overrides = [], rates = [], wallId = null, roomId = null } = {}) {
  const useDiy = diyFinish && !hireFinish;
  const rows = takeoff(house, { phase, wallId, roomId, rates });
  return rows.map((row) => {
    const record = effectiveRecord(row.wageId || row.id, overrides);
    const diy = Boolean(row.diy) && useDiy && row.kind === "labor";
    let unitPrice = record ? record.amount : null;
    let sourceName = record?.sourceName || "Price needed";
    let sourceType = record?.sourceType || "assumption";
    let url = record?.url || "";
    let dateChecked = record?.dateChecked || "";
    let name = row.kind === "labor" ? laborName(row.id) : (record?.name || row.id);
    if (diy) {
      unitPrice = 0;
      name = `${name} · DIY (James)`;
      sourceName = "DIY (James)";
      sourceType = "user-entry";
      url = "";
      dateChecked = "2026-11-11";
    }
    const allowance = Boolean(row.allowance);
    const priceNeeded = !allowance && typeof unitPrice !== "number";
    const lineTotal = allowance || priceNeeded ? null : money(row.quantity, unitPrice);
    return {
      ...row,
      name,
      unitPrice: priceNeeded ? null : unitPrice,
      lineTotal,
      priceNeeded,
      allowance,
      sourceName,
      sourceType,
      url,
      dateChecked,
      note: [record?.note, row.basis].filter(Boolean).join(" "),
    };
  });
}

export function summarize(lines) {
  const priced = lines.filter((line) => !line.allowance && !line.priceNeeded);
  const pricedTotal = Math.round(priced.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100;
  const unpricedCount = lines.filter((line) => line.priceNeeded).length;
  return { pricedTotal, unpricedCount };
}

export function costReport(house, options = {}) {
  const diyFinish = options.diyFinish !== false;
  const shared = {
    diyFinish,
    hireFinish: options.hireFinish === true,
    overrides: options.overrides || house.cost?.overrides || [],
    rates: options.rates || house.cost?.rates || [],
    wallId: options.wallId || null,
    roomId: options.roomId || null,
  };
  const lines = costLines(house, { ...shared, phase: options.phase || "full" });
  const phase1 = summarize(costLines(house, { ...shared, phase: "phase1", wallId: null, roomId: null }));
  const full = summarize(costLines(house, { ...shared, phase: "full", wallId: null, roomId: null }));
  const active = summarize(lines);
  return {
    lines,
    pricedTotal: active.pricedTotal,
    unpricedCount: active.unpricedCount,
    phase1Total: phase1.pricedTotal,
    fullTotal: full.pricedTotal,
    hooks: assumptions.hooks,
  };
}

export function materialsDocument(house, options = {}) {
  const phase = options.phase || "full";
  const report = costReport(house, { ...options, phase });
  return {
    format: "house-builder.materials",
    formatVersion: 1,
    houseId: house.id || "",
    houseName: house.name || "",
    phase,
    diyFinish: options.diyFinish !== false && options.hireFinish !== true,
    pricedTotal: report.pricedTotal,
    unpricedCount: report.unpricedCount,
    phase1Total: report.phase1Total,
    fullTotal: report.fullTotal,
    hooks: report.hooks,
    lines: report.lines.map((line) => ({
      id: line.id,
      category: line.category,
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      priceNeeded: line.priceNeeded,
      sourceName: line.sourceName,
      sourceUrl: line.url,
      dateChecked: line.dateChecked,
      sourceType: line.sourceType,
      note: line.note || "",
    })),
  };
}

export function materialsCsv(document) {
  const header = ["category", "name", "quantity", "unit", "unit price", "line total", "source", "url", "date", "price needed"];
  const rows = document.lines.map((line) => [
    line.category,
    line.name,
    line.quantity,
    line.unit,
    line.unitPrice ?? "",
    line.lineTotal ?? "",
    line.sourceName,
    line.sourceUrl,
    line.dateChecked,
    line.priceNeeded ? "yes" : "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function formatMoney(value) {
  if (typeof value !== "number") return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
