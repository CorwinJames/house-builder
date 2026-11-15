/**
 * The Solar tool's panel in Build mode: where the house is, its climate, the
 * noon sun through the year, a section through one window showing the eave,
 * the awning, and the Dec / Mar / Jun noon sun, then the roof, every window,
 * and the house-wide passive solar checks. HTML only; src/ui/editor.js binds it.
 */
import {
  CLIMATE_RULES,
  SOLAR_SOURCES,
  climateClass,
  eaveAt,
  compassName,
  designPlace,
  eaveRangeFor,
  houseSolar,
  noonSun,
  pitchFor,
  wallFacing,
} from "../sun/passive.js";
import { plainFeet } from "../build/angle.js";

const DAY_COLORS = { winter: "#3E8EC8", equinox: "#4E9A6A", summer: "#E0A21E" };
const SIDE_LABELS = { sun: "Sun side", east: "East side", west: "West side", away: "Away side" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function pitchText(angle) {
  return `${pitchFor(angle).toFixed(1).replace(/\.0$/, "")}:12`;
}

/** The sun-side eave: the side of the roof that faces the equator. */
export function sunSideKey(place) {
  return place && place.lat < 0 ? "north" : "south";
}

/** Each roof side's eave past the wall face now, measured at a wall on that side. */
export function currentEaves(house, full) {
  const out = {};
  for (const side of ["south", "north", "east", "west"]) {
    const set = house.roof?.eaves?.[side];
    if (Number.isFinite(set)) {
      out[side] = set;
      continue;
    }
    // Measure the roof edge past an outside wall on that side.
    const want = { south: 180, north: 0, east: 90, west: 270 }[side];
    let measured = null;
    for (const wall of house.walls || []) {
      if (!full && wall.phase === "future") continue;
      const facing = wallFacing(house, wall, full);
      if (!facing.exterior || Math.abs((((facing.azimuth - want) % 360) + 540) % 360 - 180) > 30) continue;
      const eave = eaveAt(house, wall, Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / 2, facing, full);
      if (eave) { measured = eave.depth; break; }
    }
    out[side] = measured ?? 0;
  }
  return out;
}

export function solarPanelHtml(house, ui) {
  const full = ui.full;
  const place = designPlace(house);
  const parts = [];
  parts.push(placeHtml(house, place, ui));
  if (!place) {
    parts.push(`<p class="fine">Pick a place (or import the real lot) to see the sun angles and get eave, awning, and roof suggestions.</p>`);
    return `<div class="solar-panel">${parts.join("")}</div>`;
  }
  const climate = climateClass(house);
  parts.push(climateHtml(house, climate, ui));
  const sun = noonSun(place);
  parts.push(`<div class="solar-noon">${sun.map((day) => `<span><i style="background:${DAY_COLORS[day.id]}"></i>${day.label} noon <strong>${day.altitude.toFixed(1)}°</strong></span>`).join("")}</div>`);
  const summary = houseSolar(house, place, { full, phaseVisible: ui.phaseVisible });
  const focus = summary.windows.find((info) => info.opening.id === ui.focusId)
    || summary.windows.find((info) => info.side === "sun")
    || summary.windows[0];
  if (focus) parts.push(sectionHtml(focus, house));
  parts.push(roofHtml(house, place, summary, climate, ui));
  parts.push(windowsHtml(summary, focus));
  parts.push(checksHtml(summary));
  parts.push(`<details class="tech"><summary>Where the rules come from</summary>
    <p class="fine">Plan north is taken as true north. Noon sun only; mornings and evenings are lower.</p>
    <ul class="solar-sources">${Object.values(SOLAR_SOURCES).map((item) => `<li><a href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(item.name)}</a></li>`).join("")}</ul>
  </details>`);
  return `<div class="solar-panel">${parts.join("")}</div>`;
}

function placeHtml(house, place, ui) {
  if (place?.source === "lot") {
    return `<section class="solar-sec"><p class="opt-label">Place</p><p class="solar-place">The lot · ${place.lat.toFixed(3)}°, ${place.lon.toFixed(3)}°</p></section>`;
  }
  const results = (ui.results || []).map((item, index) => `<button type="button" class="chip" data-place-pick="${index}">${esc(item.label)}</button>`).join("");
  return `<section class="solar-sec">
    <p class="opt-label">Reference place <span class="fine">(no real lot yet)</span></p>
    ${place ? `<p class="solar-place">${esc(place.name)} · ${place.lat.toFixed(3)}°, ${place.lon.toFixed(3)}° <button type="button" class="btn-quiet" id="place-clear">Change</button></p>` : ""}
    ${!place || ui.searching ? `<form class="solar-search" id="place-form">
      <input id="place-query" placeholder="Town, or lat, lon" autocomplete="off" value="${esc(ui.query || "")}" />
      <button type="submit" class="chip">Find</button>
    </form>
    ${ui.searchNote ? `<p class="fine">${esc(ui.searchNote)}</p>` : ""}
    ${results ? `<div class="swatch-row">${results}</div>` : ""}` : ""}
  </section>`;
}

function climateHtml(house, climate, ui) {
  const data = house.solar?.climate;
  const choice = house.solar?.climateChoice || "auto";
  const rule = CLIMATE_RULES[climate.kind];
  const dataLine = data && Number.isFinite(data.hdd65)
    ? `${data.hdd65.toLocaleString()} heating degree days (65 °F) and ${data.cdd75.toLocaleString()} cooling (75 °F) a year, ${esc(data.years)}.`
    : ui.climateNote || "No temperature data yet.";
  return `<section class="solar-sec">
    <p class="opt-label">Climate · ${esc(rule.label)}</p>
    <p class="fine">${dataLine} ${ui.climateBusy ? "Looking it up…" : `<button type="button" class="btn-quiet" id="climate-fetch">${data ? "Look up again" : "Look it up"}</button>`}</p>
    <div class="seg solar-climate">${["auto", "cold", "moderate", "hot"].map((id) => `<button type="button" data-climate="${id}" aria-pressed="${choice === id}">${id === "auto" ? "From data" : CLIMATE_RULES[id].label}</button>`).join("")}</div>
    <p class="fine">Overhangs: ${esc(rule.text)}, and the whole window in sun at Dec 21 noon.</p>
  </section>`;
}

/** A section through one window, like a passive-solar diagram: wall, glass, shades, and the noon sun. */
function sectionHtml(info, house) {
  const plate = Number(house.roof?.plateHeight) || 10;
  const wallTop = Number(info.wall.height) || plate;
  const thick = Number(info.wall.thickness) || 1;
  const maxShade = Math.max(2, ...info.shades.map((shade) => shade.depth));
  const room = 14;
  const x0 = -maxShade - 2;
  const x1 = thick + room;
  const yTop = Math.max(wallTop, ...info.shades.map((shade) => shade.height)) + 3;
  const W = 330;
  const H = 210;
  const sx = (x) => ((x - x0) / (x1 - x0)) * W;
  const sy = (y) => H - 14 - (y / yTop) * (H - 24);
  const lines = [];
  const labels = [];
  // Ground and floor.
  lines.push(`<line x1="0" y1="${sy(0)}" x2="${W}" y2="${sy(0)}" class="sec-ground" />`);
  // Wall with the window opening.
  const glassBottom = info.glass.sill;
  const glassTop = info.head;
  lines.push(`<rect x="${sx(0)}" y="${sy(wallTop)}" width="${sx(thick) - sx(0)}" height="${sy(glassTop) - sy(wallTop)}" class="sec-wall" />`);
  lines.push(`<rect x="${sx(0)}" y="${sy(glassBottom)}" width="${sx(thick) - sx(0)}" height="${sy(0) - sy(glassBottom)}" class="sec-wall" />`);
  lines.push(`<rect x="${sx(0)}" y="${sy(glassTop)}" width="${Math.max(2, (sx(thick) - sx(0)) * 0.25)}" height="${sy(glassBottom) - sy(glassTop)}" class="sec-glass" />`);
  // Ceiling line.
  lines.push(`<line x1="${sx(thick)}" y1="${sy(plate)}" x2="${W}" y2="${sy(plate)}" class="sec-ceiling" />`);
  // Shades.
  for (const shade of info.shades) {
    lines.push(`<rect x="${sx(-shade.depth)}" y="${sy(shade.height) - 3}" width="${sx(0) - sx(-shade.depth)}" height="4" class="sec-${shade.kind}" />`);
  }
  // Noon sun rays, through the tip of the lowest-reaching shade (or the head with none).
  for (const day of info.days) {
    if (!day.direct || !day.tan) continue;
    const tip = info.shades.length
      ? info.shades.reduce((a, b) => ((b.height - b.depth * day.tan) < (a.height - a.depth * day.tan) ? b : a))
      : { height: glassTop, depth: 0 };
    const tx = -tip.depth;
    const ty = tip.height;
    // Up and out to the left edge, then down into the room until the floor.
    const leftY = ty + (tx - x0) * day.tan;
    const floorX = tx + ty / day.tan;
    const color = DAY_COLORS[day.id];
    lines.push(`<line x1="${sx(x0)}" y1="${sy(leftY)}" x2="${sx(Math.min(floorX, x1))}" y2="${sy(Math.max(0, ty - (Math.min(floorX, x1) - tx) * day.tan))}" stroke="${color}" class="sec-ray" />`);
    const line = Math.min(glassTop, day.line ?? Infinity);
    if (line > glassBottom) {
      lines.push(`<rect x="${sx(0) - 3}" y="${sy(line)}" width="3" height="${sy(Math.max(glassBottom, 0)) - sy(line)}" fill="${color}" opacity="0.8" />`);
    }
    labels.push(`<text x="${W - 6}" y="${12 + labels.length * 12}" fill="${color}" class="sec-label" text-anchor="end">${day.label} noon ${day.altitude.toFixed(0)}°</text>`);
  }
  lines.push(...labels);
  lines.push(`<text x="${sx(thick) + 6}" y="${sy(plate) + 12}" class="sec-label sec-muted">inside</text>`);
  lines.push(`<text x="4" y="${sy(0) + 11}" class="sec-label sec-muted">outside</text>`);
  const name = `${info.opening.width.toFixed(1).replace(/\.0$/, "")} ft ${info.opening.type} · ${compassName(info.facing.azimuth)} wall`;
  return `<section class="solar-sec">
    <p class="opt-label">Section · ${esc(name)}</p>
    <svg class="solar-section" viewBox="0 0 ${W} ${H}" role="img" aria-label="Section through the window with the noon sun on Dec 21, Mar 20, and Jun 21">${lines.join("")}</svg>
    <p class="fine">Click a window on the plan (or below) to see it here. The colored bar on the glass is the part in sun at noon.</p>
  </section>`;
}

function roofHtml(house, place, summary, climate, ui) {
  const full = ui.full;
  const sideKey = sunSideKey(place);
  const eaves = currentEaves(house, full);
  const sunWalls = (house.walls || []).filter((wall) => ui.phaseVisible(wall.phase) && wallFacing(house, wall, full).exterior
    && summary.windows.some((info) => info.wall.id === wall.id && info.side === "sun"));
  const range = sunWalls.length ? eaveRangeFor(house, place, sunWalls, { full, climate }) : null;
  const pitchDeg = (Math.atan(Number(house.roof?.pitchRiseOverRun) || 0.5) * 180) / Math.PI;
  const hot = summary.collectors.hotWater;
  const heat = summary.collectors.spaceHeating;
  let eaveAdvice = `<p class="fine">No sun-side windows under the roof yet.</p>`;
  if (range) {
    const suggest = Math.ceil(range.min * 12) / 12;
    eaveAdvice = range.ok
      ? `<p class="fine">For the sun-side windows, the ${sideKey} eave works from <strong>${esc(plainFeet(range.min))}</strong> to <strong>${esc(plainFeet(range.max))}</strong> past the wall. Shortest that meets summer keeps the most winter sun.</p>
         <button type="button" class="chip" data-eave="${suggest}">Set ${sideKey} eave to ${esc(plainFeet(suggest))}</button>`
      : `<p class="fine">No single eave fits every sun-side window: summer needs at least ${esc(plainFeet(range.min))}, but ${esc(plainFeet(range.max))} or more starts shading winter sun. Use the eave for the most, and awnings on the rest (below), or raise the window tops.</p>
         <button type="button" class="chip" data-eave="${Math.ceil(range.max * 12) / 12}">Set ${sideKey} eave to ${esc(plainFeet(range.max))}</button>`;
  }
  return `<section class="solar-sec">
    <p class="opt-label">Roof</p>
    <p class="fine">Eaves past the walls now: ${["south", "east", "west", "north"].map((side) => `${side} ${esc(plainFeet(eaves[side]))}`).join(" · ")}.</p>
    ${eaveAdvice}
    <p class="fine">Pitch now ${esc(house.roof?.pitch || pitchText(pitchDeg))} (${pitchDeg.toFixed(1)}°). For solar collectors on the ${sideKey}-facing roof: hot water likes about the latitude, <strong>${hot.toFixed(0)}°</strong> (${pitchText(hot)}); space heating about latitude + 15°, <strong>${heat.toFixed(0)}°</strong> (${pitchText(heat)}).</p>
    <div class="card-row">
      <button type="button" class="chip" data-pitch="${hot.toFixed(2)}">Pitch ${pitchText(hot)}</button>
      <button type="button" class="chip" data-pitch="${heat.toFixed(2)}">Pitch ${pitchText(heat)}</button>
      <button type="button" class="chip" data-pitch="${(Math.atan(0.5) * 180 / Math.PI).toFixed(2)}">Back to 6:12</button>
    </div>
    <p class="fine">The roof is still placeholder massing; a steeper pitch also makes skylight shafts deeper.</p>
  </section>`;
}

function windowsHtml(summary, focus) {
  const groups = ["sun", "east", "west", "away"].map((side) => {
    const rows = summary.windows.filter((info) => info.side === side);
    if (!rows.length) return "";
    const advice = side === "sun"
      ? ""
      : side === "away"
        ? `<p class="fine">No direct winter sun here. Keep this glass small, or high on the wall: daylight reaches about 1.5–2 × the window top into a room.</p>`
        : `<p class="fine">Low morning or evening sun gets under overhangs here. Keep this glass modest; fins, trees, or shades do more than an awning.</p>`;
    return `<div class="solar-group"><p class="opt-label">${SIDE_LABELS[side]}</p>${advice}${rows.map((info) => windowRow(info, focus)).join("")}</div>`;
  }).join("");
  return `<section class="solar-sec">${groups}</section>`;
}

function windowRow(info, focus) {
  const winter = info.days.find((day) => day.id === "winter");
  const summer = info.days.find((day) => day.id === info.rule.summerDay);
  const head = info.head;
  const daylight = `${(head * 1.5).toFixed(0)}–${(head * 2).toFixed(0)} ft`;
  const status = info.side === "sun"
    ? `<span class="${info.meetsWinter ? "ok" : "bad"}">Dec ${winter.direct ? `${Math.round(winter.litShare * 100)}%` : "–"} sun</span>
       <span class="${info.meetsSummer ? "ok" : "bad"}">${summer.label} ${info.meetsSummer ? "shaded" : `${Math.round((1 - info.summerShadedShare) * 100)}% sun`}</span>`
    : `<span>daylight ~${daylight} in</span>`;
  const fix = info.side === "sun" && info.suggestion && (!info.meetsSummer || !info.meetsWinter)
    ? `<button type="button" class="chip" data-awning="${esc(info.opening.id)}">Awning ${esc(plainFeet(Math.ceil(info.suggestion.depth * 12) / 12))}</button>`
    : "";
  return `<div class="solar-row${focus?.opening.id === info.opening.id ? " is-focus" : ""}">
    <button type="button" class="solar-name" data-focus="${esc(info.opening.id)}">${esc(plainFeet(info.opening.width))} × ${esc(plainFeet(info.glass.height))} ${info.opening.type}, top ${esc(plainFeet(head))}</button>
    <span class="solar-status">${status}</span>${fix}
  </div>`;
}

function checksHtml(summary) {
  const sun = summary.sunShare;
  const sunNote = sun < 0.07
    ? "under 7%: sun-tempered. More sun-side glass would heat more."
    : sun <= 0.12
      ? "7–12%: the passive solar range. The glass over 7% needs thermal mass in the sun (the rammed-earth wall and a mass floor count)."
      : "over 12%: likely to overheat unless there is a lot of thermal mass.";
  const other = (label, value) => `<li class="${value < 0.04 ? "ok" : "bad"}">${label} glass ${pct(value)} of the floor ${value < 0.04 ? "(under 4%)" : "(aim under 4%)"}</li>`;
  const orient = summary.offSouth == null ? "" : `<li class="${summary.offSouth <= 15 ? "ok" : summary.offSouth <= 30 ? "" : "bad"}">The long sun-side wall faces ${summary.offSouth.toFixed(0)}° off true south ${summary.offSouth <= 15 ? "(ideal: within 15°)" : summary.offSouth <= 30 ? "(fine: within 30°)" : "(more than 30°: turn the house)"}</li>`;
  return `<section class="solar-sec">
    <p class="opt-label">The house · ${esc(Math.round(summary.floor).toLocaleString())} sq ft heated</p>
    <div class="solar-meter"><span style="width:${Math.min(100, (sun / 0.15) * 100)}%"></span><i style="left:${(0.07 / 0.15) * 100}%"></i><i style="left:${(0.12 / 0.15) * 100}%"></i></div>
    <p class="fine">Sun-side glass <strong>${pct(sun)}</strong> of the heated floor: ${esc(sunNote)}</p>
    <ul class="solar-checks">${orient}${other("East", summary.eastShare)}${other("West", summary.westShare)}${other("Away-side", summary.awayShare)}</ul>
  </section>`;
}
