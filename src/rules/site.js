import {
  SETBACKS,
  buildSite,
  buildingRect,
  distPointRect,
  distRectToRect,
  outsideBuildable,
  rectBoundaryClearance,
  wallMid,
} from "../site/design.js";

const JCC = {
  code: "Jefferson County Code",
  section: SETBACKS.zone.section,
  adoption: "Title 18, Table 6-1",
  url: SETBACKS.zone.url,
  adoptionUrl: SETBACKS.zone.url,
  confirmSection: false,
  checked: "2026-11-11",
};

const WELL = {
  code: "WAC 173-160",
  section: "173-160-171",
  adoption: "Washington well construction standards",
  url: SETBACKS.well.guide,
  adoptionUrl: SETBACKS.well.url,
  confirmSection: false,
  checked: "2026-11-12",
};

const OSS = {
  code: "WAC 246-272A",
  section: "246-272A-0210 Table IV",
  adoption: "On-site sewage systems",
  url: SETBACKS.septic.url,
  adoptionUrl: SETBACKS.septic.url,
  confirmSection: false,
  checked: "2026-11-12",
};

function finding(partial) {
  return {
    severity: "warning",
    why: partial.why,
    citation: partial.citation,
    ...partial,
    message: partial.title,
  };
}

export function siteWarnings(house) {
  const site = house.site;
  const view = buildSite(house);
  if (!site?.parcel?.ring || !view) return [];
  const hits = [];

  const outside = outsideBuildable(house);
  if (outside.length) {
    const wall = outside[0];
    hits.push(finding({
      id: "site-setback",
      ruleId: "jcc.setback",
      code: "jcc.setback",
      title: "House crosses the setback",
      why: `Table 6-1 puts a house ${site.zone?.frontFt || 20} ft from a local-access road and ${site.zone?.sideFt || 5} ft from the side and rear lines. ${outside.length} exterior wall${outside.length === 1 ? "" : "s"} sit outside that area. Wells and septic systems are not in this building setback.`,
      severity: "blocker",
      citation: JCC,
      target: { type: "wall", id: wall.id },
      point: wallMid(wall),
      phase: wall.phase || "phase1",
    }));
  }

  if (site.zone?.assumed) {
    hits.push(finding({
      id: "site-zone",
      ruleId: "jcc.zone-assumed",
      code: "jcc.zone-assumed",
      title: "Zone is a sample RR 1:5",
      why: "The 20 ft and 5 ft setbacks are the Rural Residential rows in Table 6-1 for a local-access road. This lot is not a real parcel, so the district and the road class are assumed.",
      severity: "tip",
      citation: JCC,
      target: { type: "house", id: "zone" },
      point: view.ring[0],
      phase: "phase1",
    }));
  }

  const well = site.well;
  const tank = site.septic?.tank;
  const field = site.septic?.drainfield;
  const reserve = site.septic?.reserve;
  const fields = [field, reserve].filter(Boolean);
  const building = buildingRect(house);
  const tankLimit = well?.kind === "public" ? SETBACKS.well.publicTankFt : SETBACKS.well.tankFt;

  if (well && fields.length) {
    const nearest = Math.min(...fields.map((rect) => distPointRect(well, rect)));
    if (nearest < SETBACKS.well.drainfieldFt - 1e-6) {
      hits.push(finding({
        id: "site-well-field",
        ruleId: "wac.well-drainfield",
        code: "wac.well-drainfield",
        title: "Well is close to the drain field",
        why: `The well is ${nearest.toFixed(0)} ft from the drain field or its reserve area. WAC 246-272A-0210 Table IV requires 100 ft from a nonpublic well to the edge of the soil dispersal component and the reserve (checked 2026-11-12).`,
        severity: "blocker",
        citation: { ...WELL, section: "173-160-171 and Table IV" },
        target: { type: "well", id: well.id || "well" },
        point: { x: well.x, y: well.y },
        phase: "phase1",
      }));
    }
  }

  if (well && tank) {
    const distance = Math.hypot(well.x - tank.x, well.y - tank.y);
    if (distance < tankLimit - 1e-6) {
      hits.push(finding({
        id: "site-well-tank",
        ruleId: "wac.well-tank",
        code: "wac.well-tank",
        title: "Well is close to the tank",
        why: `The well is ${distance.toFixed(0)} ft from the tank. Table IV wants ${tankLimit} ft for this well.`,
        severity: "blocker",
        citation: OSS,
        target: { type: "septic", id: "tank" },
        point: { x: tank.x, y: tank.y },
        phase: "phase1",
      }));
    }
  }

  if (well) {
    const distance = distPointRect(well, { x: building.x, y: building.y, width: building.width, depth: building.height });
    if (distance < SETBACKS.well.buildingFt - 1e-6) {
      hits.push(finding({
        id: "site-well-building",
        ruleId: "wac.well-building",
        code: "wac.well-building",
        title: "Well is close to the house",
        why: `The well is ${distance.toFixed(0)} ft from the footprint. The well standard wants 5 ft from a building.`,
        severity: "warning",
        citation: WELL,
        target: { type: "well", id: well.id || "well" },
        point: { x: well.x, y: well.y },
        phase: "phase1",
      }));
    }
  }

  for (const rect of fields) {
    const line = rectBoundaryClearance(rect, view.ring);
    if (line < SETBACKS.septic.drainfieldLineFt - 1e-6) {
      hits.push(finding({
        id: `site-field-line-${rect.x}`,
        ruleId: "wac.drainfield-line",
        code: "wac.drainfield-line",
        title: "Drainfield is close to the line",
        why: `A corner is ${line.toFixed(0)} ft from the property line. Table IV wants 5 ft from the edge of the dispersal area and the reserve.`,
        severity: "warning",
        citation: OSS,
        target: { type: "drainfield", id: "drainfield" },
        point: { x: rect.x, y: rect.y },
        phase: "phase1",
      }));
    }
    const houseGap = distRectToRect(rect, { x: building.x, y: building.y, width: building.width, depth: building.height });
    if (houseGap < SETBACKS.septic.drainfieldBuildingFt - 1e-6) {
      hits.push(finding({
        id: `site-field-house-${rect.x}`,
        ruleId: "wac.drainfield-building",
        code: "wac.drainfield-building",
        title: "Drainfield is close to the house",
        why: `The field is ${houseGap.toFixed(0)} ft from the footprint. Table IV wants 10 ft from a building foundation.`,
        severity: "warning",
        citation: OSS,
        target: { type: "drainfield", id: "drainfield" },
        point: { x: rect.x + rect.width / 2, y: rect.y + rect.depth / 2 },
        phase: "phase1",
      }));
    }
  }

  if (tank) {
    const boundary = rectBoundaryClearance({ x: tank.x, y: tank.y, width: 0.1, depth: 0.1 }, view.ring);
    if (boundary < SETBACKS.septic.tankLineFt - 1e-6) {
      hits.push(finding({
        id: "site-tank-line",
        ruleId: "wac.tank-line",
        code: "wac.tank-line",
        title: "Tank is close to the line",
        why: `The tank is ${boundary.toFixed(0)} ft from the property line. Table IV wants 5 ft.`,
        severity: "warning",
        citation: OSS,
        target: { type: "septic", id: "tank" },
        point: { x: tank.x, y: tank.y },
        phase: "phase1",
      }));
    }
    const houseGap = distPointRect(tank, { x: building.x, y: building.y, width: building.width, depth: building.height });
    if (houseGap < SETBACKS.septic.tankBuildingFt - 1e-6) {
      hits.push(finding({
        id: "site-tank-house",
        ruleId: "wac.tank-building",
        code: "wac.tank-building",
        title: "Tank is close to the house",
        why: `The tank is ${houseGap.toFixed(0)} ft from the footprint. Table IV wants 5 ft from a building foundation.`,
        severity: "warning",
        citation: OSS,
        target: { type: "septic", id: "tank" },
        point: { x: tank.x, y: tank.y },
        phase: "phase1",
      }));
    }
  }

  if (site.septic && site.septic.kind !== "pressure" && site.septic.kind !== "mound" && view.gravity && !view.gravity.ok && view.gravity.reason !== "missing") {
    hits.push(finding({
      id: "site-gravity",
      ruleId: "upc.gravity-fall",
      code: "upc.gravity-fall",
      title: "Gravity falls short of the tank",
      why: `The stub invert is ${view.gravity.stubInches.toFixed(2)} in below the floor. Over ${view.gravity.runFt.toFixed(0)} ft the pipe wants another ${view.gravity.needInches.toFixed(1)} in at 1/4 in per ft. The ground falls ${view.gravity.groundInches.toFixed(1)} in, short by ${view.gravity.shortInches.toFixed(1)} in. A pressure or mound system pumps instead. The 1/4 in section number is still confirm section.`,
      severity: "warning",
      citation: {
        code: "2021 UPC",
        section: "708.1",
        adoption: "WAC 51-56",
        url: SETBACKS.sewerSlope.url,
        adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
        confirmSection: true,
        checked: "2026-11-11",
      },
      target: { type: "septic", id: "tank" },
      point: tank ? { x: tank.x, y: tank.y } : view.ring[0],
      phase: "phase1",
    }));
  }

  if (reserve && view.reserveSqFt + 1e-6 < view.fieldSqFt) {
    hits.push(finding({
      id: "site-reserve",
      ruleId: "wac.reserve-area",
      code: "wac.reserve-area",
      title: "Reserve area is short",
      why: `The reserve is ${Math.round(view.reserveSqFt)} sq ft. The primary area needs ${Math.round(view.fieldSqFt)} sq ft, and the reserve has to cover 100 percent of that flow.`,
      severity: "warning",
      citation: {
        ...OSS,
        section: SETBACKS.septic.reserveSection,
        url: SETBACKS.septic.reserveUrl,
      },
      target: { type: "reserve", id: "reserve" },
      point: { x: reserve.x + reserve.width / 2, y: reserve.y + reserve.depth / 2 },
      phase: "phase1",
    }));
  }

  if (site.septic?.loadingConfirm) {
    hits.push(finding({
      id: "site-loading",
      ruleId: "wac.loading-rate",
      code: "wac.loading-rate",
      title: "Drainfield rate needs a soil type",
      why: `Design flow is ${view.flow} gallons a day from ${view.bedrooms} bedrooms, at 120 gallons per bedroom and a 240 gallon floor. The drawn field uses ${site.septic.loadingRate} gal per sq ft per day, the low end of the gravity rates in Table VIII. Which row that is for this soil is not confirmed.`,
      severity: "tip",
      citation: {
        ...OSS,
        section: "246-272A-0234 Table VIII",
        confirmSection: true,
      },
      target: { type: "drainfield", id: "drainfield" },
      point: field ? { x: field.x + field.width / 2, y: field.y + field.depth / 2 } : view.ring[0],
      phase: "phase1",
    }));
  }

  return hits;
}

export const SITE_RULES = [
  "jcc.setback",
  "jcc.zone-assumed",
  "wac.well-drainfield",
  "wac.well-tank",
  "wac.well-building",
  "wac.drainfield-line",
  "wac.drainfield-building",
  "wac.tank-line",
  "wac.tank-building",
  "upc.gravity-fall",
  "wac.reserve-area",
  "wac.loading-rate",
];
