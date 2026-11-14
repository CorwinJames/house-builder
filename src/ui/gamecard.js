export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function statusChip(issues) {
  const count = (issues || []).filter((item) => item.severity !== "tip").length;
  if (!count) return `<span class="status-chip ok">Up to code</span>`;
  return `<span class="status-chip bad">${count} issue${count === 1 ? "" : "s"}</span>`;
}

export function gameHead(title, issues) {
  return `<header class="game-head"><h2>${escapeHtml(title)}</h2>${statusChip(issues)}</header>`;
}

export function statTiles(tiles) {
  return `<div class="stat-row">${tiles.filter(Boolean).map((tile) => `
    <div class="stat-tile" title="${escapeHtml(tile.title || `${tile.label}: ${tile.value}`)}">
      <span class="stat-value">${escapeHtml(tile.value)}</span>
      <span class="stat-label"><span class="stat-icon" aria-hidden="true">${tile.icon}</span> ${escapeHtml(tile.label)}</span>
    </div>`).join("")}</div>`;
}

export function issueCards(issues, actionHtml = "") {
  return (issues || []).map((item, index) => `
    <article class="issue-card ${escapeHtml(item.severity || "warning")}">
      <strong>${escapeHtml(item.title)}</strong>
      ${item.why ? `<p>${escapeHtml(item.why)}</p>` : ""}
      ${index === 0 ? actionHtml : ""}
    </article>`).join("");
}

export function techBlock(html) {
  return `<details class="tech"><summary>Technical details</summary>${html}</details>`;
}

export function quietDelete(label) {
  return `<button type="button" class="btn-quiet" id="edit-delete">${escapeHtml(label)}</button>`;
}

export function fallCard(title, detail, ok) {
  return `<div class="fall-card ${ok ? "ok" : "bad"}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

export function budgetPhrase(before, after) {
  const priced = Math.round(((after?.priced || 0) - (before?.priced || 0)) * 100) / 100;
  if (priced > 0) return { sign: "+", text: formatDelta(priced) };
  if (priced < 0) return { sign: "−", text: formatDelta(priced) };
  const unpriced = (after?.unpriced || 0) - (before?.unpriced || 0);
  if (unpriced > 0) return { sign: "+", text: "price needed" };
  if (unpriced < 0) return { sign: "−", text: "price needed" };
  return null;
}

function formatDelta(value) {
  const amount = Math.abs(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return value < 0 ? `−${amount}` : `+${amount}`;
}

export function suggestionGroupLabel(items) {
  const counts = new Map();
  for (const item of items || []) {
    const kind = item.kind || "item";
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => {
    if (kind === "receptacle" || kind === "wr-receptacle") return `${count} outlet${count === 1 ? "" : "s"}`;
    if (kind === "gfci") return count === 1 ? "1 outlet near water" : `${count} outlets near water`;
    const name = String(kind).replaceAll("-", " ");
    return `${count} ${name}${count === 1 || name.endsWith("s") ? "" : "s"}`;
  }).join(", ");
}

export function groupByRoom(items, rooms) {
  const map = new Map();
  for (const item of items || []) {
    const id = item.roomId || "other";
    const room = (rooms || []).find((entry) => entry.id === id);
    if (!map.has(id)) map.set(id, { id, name: room?.name || "Outside a room", count: 0, items: [] });
    const group = map.get(id);
    group.count += 1;
    group.items.push(item);
  }
  return [...map.values()].map((group) => ({ ...group, label: suggestionGroupLabel(group.items) }));
}

export function issueRows(issues) {
  return (issues || []).map((item) => {
    const explain = item.fix?.explain || item.why || "";
    return `
    <div class="issue-row">
      <div>
        <span>${escapeHtml(item.title)}</span>
        ${explain ? `<p class="fine">${escapeHtml(explain)}</p>` : ""}
      </div>
      <button type="button" title="${escapeHtml(explain)}" data-fix-finding="${escapeHtml(item.id)}">${escapeHtml(item.fix?.label || "Show me")}</button>
    </div>`;
  }).join("");
}
