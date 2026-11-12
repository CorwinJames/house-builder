import { applyFix, citationLine, evaluateRules } from "../rules/index.js";

const ORDER = ["blocker", "warning", "tip"];
const LABEL = { blocker: "Blockers", warning: "Warnings", tip: "Tips" };

const PLAIN_GROUPS = [
  {
    id: "windows",
    match: (finding) => /window/i.test(finding.title || ""),
    title: "Windows not drawn yet",
    why: "No windows are drawn, so every room that needs one is the same gap. Draw the windows, then these checks can tell them apart.",
    min(house) {
      return planOmitsWindows(house) ? 1 : 2;
    },
  },
  {
    id: "smoke",
    match: (finding) => /smoke alarm/i.test(finding.title || ""),
    title: "Smoke alarms aren't placed yet",
    why: "Smoke alarms aren't on this drawing yet.",
  },
  {
    id: "co",
    match: (finding) => /CO alarm|carbon monoxide/i.test(finding.title || ""),
    title: "Carbon monoxide alarms aren't placed yet",
    why: "Carbon monoxide alarms aren't on this drawing yet.",
  },
  {
    id: "exhaust",
    match: (finding) => /exhaust fan/i.test(finding.title || ""),
    title: "Exhaust fans aren't placed yet",
    why: "Bath and kitchen fans aren't on this drawing yet.",
  },
  {
    id: "outlets",
    match: (finding) => /receptacle|outlet|GFCI|AFCI/i.test(finding.title || ""),
    title: "Outlet spacing isn't worked out yet",
    why: "The outlets on this drawing are still too far apart in several rooms.",
  },
  {
    id: "size",
    match: (finding) => /under 70 sq ft|under 7 ft|under 3 ft|under 36 in|ceiling is under/i.test(finding.title || ""),
    title: "Some rooms are smaller than a usual minimum",
    why: "Closets, bays, and rooms the drawing left small show up together. Confirm a real measurement before treating this as a failure.",
  },
  {
    id: "overlap",
    match: (finding) => /walls overlap/i.test(finding.title || ""),
    title: "Walls cross on the tracing",
    why: "Some traced walls cross each other. That is a drawing overlap, not an extra room.",
  },
  {
    id: "door",
    match: (finding) => /egress door|exit door/i.test(finding.title || ""),
    title: "The exit door isn't sized yet",
    why: "The door symbols aren't sized as code exits yet.",
  },
  {
    id: "heat",
    match: (finding) => /heat alarm/i.test(finding.title || ""),
    title: "A heat alarm isn't placed yet",
    why: "A garage heat alarm isn't on this drawing yet.",
  },
];

/**
 * An imported plan repeats the same gap once per room. Collapse those into a few plain items.
 * A hand-built plan (sample, or only a handful of checks) keeps one item per room.
 */
export function groupImportedFindings(house, findings) {
  if (house?.sample !== false || findings.length < 6) return findings;
  const used = new Set();
  const grouped = [];
  for (const group of PLAIN_GROUPS) {
    const hits = findings.filter((finding) => !used.has(finding) && group.match(finding));
    const min = typeof group.min === "function" ? group.min(house) : 2;
    if (hits.length < min) continue;
    for (const hit of hits) used.add(hit);
    const worst = hits.some((hit) => hit.severity === "blocker")
      ? "blocker"
      : hits.some((hit) => hit.severity === "warning")
        ? "warning"
        : "tip";
    grouped.push({
      id: `group-${group.id}`,
      ruleId: group.id,
      code: group.id,
      severity: worst,
      title: group.title,
      message: group.title,
      why: `${group.why} ${hits.length} places.`,
      point: hits.find((hit) => hit.point)?.point || null,
      phase: null,
      target: null,
    });
  }
  if (planOmitsWindows(house) && !grouped.some((item) => item.id === "group-windows")) {
    grouped.unshift({
      id: "group-windows",
      ruleId: "windows",
      code: "windows",
      severity: "warning",
      title: "Windows not drawn yet",
      message: "Windows not drawn yet",
      why: "No windows are drawn. Draw them, then each room can be checked on its own.",
      point: null,
      phase: null,
      target: null,
    });
  }
  const rest = findings.filter((finding) => !used.has(finding));
  if (rest.length > 8) {
    const worst = rest.some((hit) => hit.severity === "blocker")
      ? "blocker"
      : rest.some((hit) => hit.severity === "warning")
        ? "warning"
        : "tip";
    grouped.push({
      id: "group-other",
      ruleId: "other",
      code: "other",
      severity: worst,
      title: "Other checks on this imported plan",
      message: "Other checks on this imported plan",
      why: `${rest.length} more checks are the same kind of gap. Zoom in after the windows and alarms are drawn.`,
      point: rest.find((hit) => hit.point)?.point || null,
      phase: null,
      target: null,
    });
    return grouped;
  }
  return [...grouped, ...rest];
}

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
    if (show) {
      openId = finding.id;
      document.dispatchEvent(new CustomEvent("show-finding", { detail: finding }));
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
    const findings = evaluateRules(getHouse()).filter((finding) => phase === "full" || finding.phase !== "future");
    return groupImportedFindings(getHouse(), findings);
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
    const explain = finding.fix?.explain || "";
    const action = finding.fix
      ? `${explain ? `<p>${escapeHtml(explain)}</p>` : ""}<button type="button" data-fix title="${escapeHtml(explain)}">${escapeHtml(finding.fix.label)}</button>`
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

function planOmitsWindows(house) {
  const text = `${house?.disclaimer || ""} ${(house?.notes || []).join(" ")}`.toLowerCase();
  return text.includes("windows not");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
