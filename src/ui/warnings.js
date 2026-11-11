import { applyFix, citationLine, evaluateRules } from "../rules/index.js";

const ORDER = ["blocker", "warning", "tip"];
const LABEL = { blocker: "Blockers", warning: "Warnings", tip: "Tips" };

/**
 * Header count, grouped list, and plan markers.
 * A click zooms to the object. A fix changes the house. Details stay collapsed.
 */
export function attachWarnings({ getHouse, getPhase, plan, replaceHouse }) {
  const chip = document.querySelector("#warn-chip");
  const count = document.querySelector("#warn-count");
  const dialog = document.querySelector("#warn-dialog");
  const list = document.querySelector("#warn-list");
  let openId = null;

  chip.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
    paint();
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

  list.addEventListener("toggle", (event) => {
    const item = event.target.closest("details");
    if (!item || event.target !== item) return;
    openId = item.open ? item.dataset.id : (openId === item.dataset.id ? null : openId);
    const finding = current().find((entry) => entry.id === item.dataset.id);
    if (item.open && finding?.point) plan.focus(finding.point.x, finding.point.y);
    plan.setMarkers(current().map((entry) => ({
      id: entry.id,
      point: entry.point,
      severity: entry.severity,
      title: entry.title,
      active: entry.id === openId,
    })));
  }, true);

  list.addEventListener("click", (event) => {
    const show = event.target.closest("[data-show]");
    const fix = event.target.closest("[data-fix]");
    if (!show && !fix) return;
    event.preventDefault();
    event.stopPropagation();
    const item = event.target.closest("details");
    const finding = current().find((entry) => entry.id === item?.dataset.id);
    if (!finding) return;
    if (show && finding.point) {
      openId = finding.id;
      plan.focus(finding.point.x, finding.point.y);
      paint();
      return;
    }
    if (!fix) return;
    const next = applyFix(getHouse(), finding);
    if (!next) return;
    replaceHouse(next);
  });

  function current() {
    const phase = getPhase();
    return evaluateRules(getHouse()).filter((finding) => phase === "full" || finding.phase !== "future");
  }

  function paint() {
    const findings = current();
    const blockers = findings.filter((finding) => finding.severity === "blocker").length;
    count.textContent = String(findings.length);
    chip.classList.toggle("is-clear", findings.length === 0);
    chip.classList.toggle("has-blocker", blockers > 0);
    chip.classList.toggle("has-warning", blockers === 0 && findings.some((finding) => finding.severity === "warning"));
    chip.title = findings.length
      ? `${findings.length} code checks still open`
      : "The modeled code checks are clear";
    plan.setMarkers(findings.map((finding) => ({
      id: finding.id,
      point: finding.point,
      severity: finding.severity,
      title: finding.title,
      active: finding.id === openId,
    })));
    if (!dialog.open) return;
    if (!findings.length) {
      list.innerHTML = `<p class="warn-empty">These checks are clear. Clearing this list means the design matches the rules the model knows.</p>`;
      return;
    }
    list.innerHTML = ORDER.filter((severity) => findings.some((finding) => finding.severity === severity)).map((severity) => {
      const group = findings.filter((finding) => finding.severity === severity);
      return `<section class="warn-group">
        <h3>${LABEL[severity]} <span>${group.length}</span></h3>
        ${group.map((finding) => itemHtml(finding)).join("")}
      </section>`;
    }).join("");
  }

  function itemHtml(finding) {
    const open = finding.id === openId ? " open" : "";
    const citation = finding.citation;
    const link = citation?.url || citation?.adoptionUrl;
    const line = citationLine(citation);
    const action = finding.fix
      ? `<button type="button" data-fix>${escapeHtml(finding.fix.label)}</button>`
      : `<button type="button" data-show>Show me</button>`;
    return `<details data-id="${escapeHtml(finding.id)}"${open}>
      <summary>${escapeHtml(finding.title)}</summary>
      <p>${escapeHtml(finding.why || "")}</p>
      ${line ? `<p class="fine">${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(line)}</a>` : escapeHtml(line)}</p>` : ""}
      ${action}
    </details>`;
  }

  return { paint };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
