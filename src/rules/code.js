import { assemblyById } from "../build/catalog.js";
import { openingFits } from "../build/openings.js";
import { withHeader } from "../build/walls.js";
import { polygonArea, pointAlong } from "../lib/geom.js";
import {
  BRANCH_DROP_PERCENT,
  buildElectrical,
  devicePoint,
  RULES as NEC_RULES,
} from "../electrical/design.js";
import {
  buildPlumbing,
  isMassWall,
  sideClearance,
  trapArmLimit,
  RULES as UPC_RULES,
} from "../plumbing/design.js";

/**
 * Code checks. Each rule carries the section that was read.
 * confirmSection means the section number itself was not confirmed in the text.
 * Checked 2026-11-11. Do not invent a price or a section number.
 */

const CHECKED = "2026-11-11";

const IRC = {
  code: "2021 IRC",
  adoption: "WAC 51-51 adopts the 2021 IRC",
  adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-51",
  confirmSection: false,
  checked: CHECKED,
};

const NEC = {
  code: "2023 NEC",
  adoption: "WAC 296-46B-010 adopts the 2023 NEC",
  url: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70",
  adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=296-46B-010",
  confirmSection: false,
  checked: CHECKED,
};

const UPC = {
  code: "2021 UPC",
  adoption: "WAC 51-56 adopts the 2021 UPC",
  url: "https://www.iapmo.org/uniform-codes/upc",
  adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-56",
  confirmSection: false,
  checked: CHECKED,
};

const WSEC = {
  code: "2021 WSEC-R",
  adoption: "WAC 51-11R",
  url: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-11R-40213",
  adoptionUrl: "https://apps.leg.wa.gov/wac/default.aspx?cite=51-11R-40213",
  confirmSection: false,
  checked: CHECKED,
};

const GRANT = "https://www.grantcountywa.gov/DocumentCenter/View/9481/2021-Residential-Excerpts?bidId=";
const HEMP_R_PER_INCH = 2;
const HEMP_URL = "https://hempandblock.com/product/hempcrete-blocks/";

function cite(base, section, url, extra = {}) {
  return { ...base, section, url: url || base.url, ...extra };
}

function centroid(room) {
  const poly = room?.polygon || [];
  if (!poly.length) return { x: 0, y: 0 };
  return {
    x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
    y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
  };
}

function spans(room) {
  const poly = room?.polygon || [];
  const xs = poly.map((point) => point.x);
  const ys = poly.map((point) => point.y);
  if (!xs.length) return { width: 0, depth: 0 };
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
  };
}

function nameOf(room) {
  return room?.name || "";
}

function isKitchen(room) {
  return /kitchen/i.test(nameOf(room));
}

function isBath(room) {
  return /bath|toilet/i.test(nameOf(room));
}

function isSleeping(room) {
  return /bed/i.test(nameOf(room)) && !isBath(room) && !room?.outdoor;
}

function isHall(room) {
  return /\bhallway\b/i.test(nameOf(room)) || /^hall$/i.test(nameOf(room));
}

function isStair(room) {
  return /\bstair/i.test(nameOf(room));
}

function habitable(room) {
  if (!room || room.outdoor) return false;
  if (isBath(room) || isHall(room) || isStair(room)) return false;
  if (/laundry|garage|closet|patio|utility|mechanical|storage/i.test(nameOf(room))) return false;
  return true;
}

function roomsOf(house) {
  return house.rooms || [];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    const x = ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (crosses && point.x < x) inside = !inside;
  }
  return inside;
}

function distPointSeg(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function distToRing(point, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    best = Math.min(best, distPointSeg(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

function project(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length);
  const clamped = Math.min(1, Math.max(0, t));
  return {
    t,
    along: clamped * length,
    dist: Math.hypot(point.x - (a.x + dx * clamped), point.y - (a.y + dy * clamped)),
    length,
  };
}

function roomEdges(room) {
  const poly = room.polygon || [];
  const edges = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0.15) edges.push({ a, b, length });
  }
  return edges;
}

function wallMid(wall) {
  return { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
}

function wallsNear(house, room) {
  return (house.walls || []).filter((wall) => {
    const poly = room.polygon || [];
    if (!poly.length) return false;
    return distToRing(wallMid(wall), poly) < (wall.thickness || 0.5) + 1.2;
  });
}

function ceilingHeight(house, room) {
  const near = wallsNear(house, room);
  if (near.length) return Math.min(...near.map((wall) => wall.height || 10));
  const level = (house.levels || []).find((item) => item.id === room.levelId) || house.levels?.[0];
  return level?.plateHeight || 10;
}

function openingCenter(house, opening) {
  const wall = (house.walls || []).find((item) => item.id === opening.wallId);
  if (!wall) return null;
  return pointAlong(wall, (opening.offset || 0) + (opening.width || 0) / 2);
}

function servesRoom(house, room, opening) {
  const center = openingCenter(house, opening);
  if (!center || !room.polygon?.length) return false;
  return distToRing(center, room.polygon) <= 1.6;
}

function devices(house) {
  return (house.electrical?.devices || []).filter((device) => !device.ghost);
}

function deviceAt(house, device) {
  if (Number.isFinite(device.x) && Number.isFinite(device.y)) return { x: device.x, y: device.y };
  return devicePoint(house, device);
}

function inRoom(house, room, point) {
  if (!room?.polygon?.length || !point) return false;
  return pointInRing(point, room.polygon) || distToRing(point, room.polygon) <= 1.5;
}

function smokes(house) {
  return devices(house).filter((device) => device.kind === "smoke");
}

function isReceptacle(device) {
  return ["receptacle", "gfci", "wr-receptacle"].includes(device.kind);
}

function plainReceptacle(device) {
  return device.kind === "receptacle";
}

function gfciPlace(house, device) {
  const room = roomsOf(house).find((item) => item.id === device.roomId);
  const name = nameOf(room);
  if (device.roomRole === "bath" || device.roomRole === "kitchen" || device.roomRole === "outdoor" || device.roomRole === "laundry") return true;
  if (room?.outdoor || /garage|laundry|kitchen|bath/i.test(name)) return true;
  const at = deviceAt(house, device);
  return (house.plumbing?.fixtures || []).some((fixture) => {
    if (fixture.ghost) return false;
    if (device.roomId && fixture.roomId && fixture.roomId !== device.roomId) return false;
    if (!/sink|lavatory/i.test(fixture.kind || "")) return false;
    return Math.hypot((fixture.x || 0) - at.x, (fixture.y || 0) - at.y) <= 6;
  });
}

function needsAfci(room) {
  if (!room || room.outdoor) return false;
  if (isBath(room) || /garage|patio/i.test(nameOf(room))) return false;
  return /kitchen|bed|living|dining|family|hall|laundry|office|den|closet|rec|parlor|library|sunroom/i.test(nameOf(room)) || habitable(room);
}

function targetRoom(room, point) {
  return {
    target: { type: "room", id: room.id },
    point: point || centroid(room),
    phase: room.phase || "phase1",
  };
}

function hempInches(wall) {
  const layer = assemblyById[wall.assemblyId]?.layers?.find((item) => item.name === "hempcrete");
  if (!layer) return null;
  return layer.thickness * 12;
}

function spacingSpans(edge, doors) {
  const cuts = doors
    .map((door) => [Math.max(0, door[0]), Math.min(edge.length, door[1])])
    .filter((door) => door[1] > door[0])
    .sort((a, b) => a[0] - b[0]);
  const spansOnEdge = [];
  let cursor = 0;
  for (const [start, end] of cuts) {
    if (start - cursor >= 2 - 1e-6) spansOnEdge.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (edge.length - cursor >= 2 - 1e-6) spansOnEdge.push([cursor, edge.length]);
  return spansOnEdge;
}

function edgeFails(span, stations, reach) {
  const marks = stations.filter((station) => station >= span[0] - 0.2 && station <= span[1] + 0.2).sort((a, b) => a - b);
  if (!marks.length) return true;
  if (marks[0] - span[0] > reach + 1e-6) return true;
  if (span[1] - marks[marks.length - 1] > reach + 1e-6) return true;
  for (let i = 1; i < marks.length; i += 1) {
    if (marks[i] - marks[i - 1] > reach * 2 + 1e-6) return true;
  }
  return false;
}

const FIXES = {
  "make-gfci"(house, finding) {
    const next = structuredClone(house);
    const device = next.electrical?.devices?.find((item) => item.id === finding.target?.id);
    if (!device) return null;
    device.kind = "gfci";
    device.name = "GFCI receptacle";
    return next;
  },
  "add-smoke"(house, finding) {
    const next = structuredClone(house);
    const room = next.rooms?.find((item) => item.id === finding.target?.id);
    if (!room) return null;
    next.electrical = next.electrical || {};
    next.electrical.devices = next.electrical.devices || [];
    const at = centroid(room);
    next.electrical.devices.push({
      id: `smoke-${room.id}`,
      kind: "smoke",
      name: "Smoke / CO alarm",
      volts: 120,
      amps: 0,
      supply: "240",
      mount: "ceiling",
      height: 10,
      x: at.x,
      y: at.y,
      wallId: null,
      offset: null,
      roomId: room.id,
      roomRole: "general",
      phase: room.phase || "phase1",
      ghost: false,
    });
    return next;
  },
  "add-fan"(house, finding) {
    const next = structuredClone(house);
    const room = next.rooms?.find((item) => item.id === finding.target?.id);
    if (!room) return null;
    next.electrical = next.electrical || {};
    next.electrical.devices = next.electrical.devices || [];
    const at = centroid(room);
    next.electrical.devices.push({
      id: `fan-${room.id}`,
      kind: "fan",
      name: "Exhaust fan",
      volts: 120,
      amps: 0,
      supply: "240",
      mount: "ceiling",
      height: 10,
      x: at.x,
      y: at.y,
      wallId: null,
      offset: null,
      roomId: room.id,
      roomRole: "bath",
      phase: room.phase || "phase1",
      ghost: false,
    });
    return next;
  },
  "widen-door"(house, finding) {
    const next = structuredClone(house);
    const opening = next.openings?.find((item) => item.id === finding.target?.id);
    const wall = opening && next.walls?.find((item) => item.id === opening.wallId);
    if (!opening || !wall) return null;
    const width = Math.max(opening.width || 0, 3);
    const height = Math.max(opening.height || 0, 6.667);
    if (!openingFits(wall, next.openings, opening.offset, width, opening.id).ok) return null;
    Object.assign(opening, withHeader({ ...opening, width, height }));
    return next;
  },
  "add-chase"(house, finding) {
    const next = structuredClone(house);
    const fixture = next.plumbing?.fixtures?.find((item) => item.id === finding.target?.id);
    if (!fixture) return null;
    fixture.chase = true;
    return next;
  },
  "record-insulation"(house) {
    const next = structuredClone(house);
    next.energy = {
      ...(next.energy || {}),
      ceilingR: 60,
      floorR: 30,
      note: "Recorded as the Table R402.1.3 minimum. The plan does not draw the insulation.",
    };
    return next;
  },
};

export function applyFix(house, finding) {
  const fix = FIXES[finding?.fix?.id];
  if (!fix) return null;
  return fix(house, finding);
}

function roomArea(house) {
  return roomsOf(house).filter((room) => habitable(room) && !isKitchen(room)).flatMap((room) => {
    const area = polygonArea(room.polygon || []);
    if (area + 1e-6 >= 70) return [];
    return [{
      id: `room-area-${room.id}`,
      title: `${room.name} is under 70 sq ft`,
      ...targetRoom(room),
    }];
  });
}

function roomDimension(house) {
  return roomsOf(house).filter((room) => habitable(room) && !isKitchen(room)).flatMap((room) => {
    const box = spans(room);
    const narrow = Math.min(box.width, box.depth);
    if (narrow + 1e-6 >= 7) return [];
    return [{
      id: `room-dim-${room.id}`,
      title: `${room.name} is under 7 ft across`,
      ...targetRoom(room),
    }];
  });
}

function ceilingRule(house) {
  return roomsOf(house).flatMap((room) => {
    if (room.outdoor || isStair(room) || /patio|garage|closet/i.test(nameOf(room))) return [];
    const need = isBath(room) || /laundry/i.test(nameOf(room)) ? 6 + 8 / 12 : (habitable(room) || isHall(room) ? 7 : 0);
    if (!need) return [];
    const height = ceilingHeight(house, room);
    if (height + 1e-6 >= need) return [];
    const label = need >= 7 ? "7 ft" : "6 ft 8 in";
    return [{
      id: `ceiling-${room.id}`,
      title: `${room.name} ceiling is under ${label}`,
      ...targetRoom(room),
    }];
  });
}

function egressWindow(house) {
  return roomsOf(house).filter(isSleeping).flatMap((room) => {
    const openings = (house.openings || []).filter((opening) => (
      (opening.type === "window" || opening.type === "door") && servesRoom(house, room, opening)
    ));
    const judged = openings.map((opening) => {
      const area = (opening.width || 0) * (opening.height || 0);
      const widthIn = (opening.width || 0) * 12;
      const heightIn = (opening.height || 0) * 12;
      const sillIn = opening.type === "door" ? 0 : (opening.sill || 0) * 12;
      const shape = widthIn + 1e-6 >= 20 && heightIn + 1e-6 >= 24 && sillIn <= 44 + 1e-6;
      return { opening, area, shape, full: shape && area + 1e-6 >= 5.7, grade: shape && area + 1e-6 >= 5 };
    });
    if (judged.some((item) => item.full)) return [];
    const grade = judged.find((item) => item.grade);
    const center = centroid(room);
    if (grade) {
      return [{
        id: `egress-grade-${room.id}`,
        title: `${room.name} window may be short of 5.7 sq ft`,
        severity: "warning",
        why: "R310.2.1 wants 5.7 sq ft net clear. A grade-floor opening may be 5.0 sq ft. This one-story plan treats the room as grade floor only as a warning, because the model stores the rough opening, not the net clear opening.",
        ...targetRoom(room, openingCenter(house, grade.opening) || center),
        target: { type: "opening", id: grade.opening.id },
        phase: room.phase || "phase1",
      }];
    }
    return [{
      id: `egress-${room.id}`,
      title: openings.length ? `${room.name} egress window is too small` : `${room.name} needs an egress window`,
      why: "A sleeping room needs an operable opening with at least 5.7 sq ft net clear (5.0 at a grade floor), 24 in. high, 20 in. wide, and a sill no higher than 44 in. The model stores the rough opening, which is larger than the net clear opening.",
      ...targetRoom(room, openings[0] ? openingCenter(house, openings[0]) : center),
      target: openings[0] ? { type: "opening", id: openings[0].id } : { type: "room", id: room.id },
      phase: room.phase || "phase1",
    }];
  });
}

function egressDoor(house) {
  const doors = (house.openings || []).filter((opening) => opening.type === "door").map((opening) => {
    const wall = (house.walls || []).find((item) => item.id === opening.wallId);
    return { opening, wall };
  }).filter((item) => item.wall?.role === "exterior");
  if (!doors.length) {
    const room = roomsOf(house)[0];
    return [{
      id: "egress-door-missing",
      title: "No egress door",
      fix: { id: "guide-door", label: "Add a door" },
      ...(room ? targetRoom(room) : { point: { x: 0, y: 0 }, phase: "phase1", target: { type: "house", id: "house" } }),
    }];
  }
  const best = doors.slice().sort((a, b) => (b.opening.width || 0) - (a.opening.width || 0))[0];
  const width = best.opening.width || 0;
  const height = best.opening.height || 0;
  if (width + 1e-6 >= 3 && height + 1e-6 >= 6.667) return [];
  const canWiden = openingFits(best.wall, house.openings, best.opening.offset, Math.max(width, 3), best.opening.id).ok;
  return [{
    id: `egress-door-${best.opening.id}`,
    title: "Egress door is too small",
    target: { type: "opening", id: best.opening.id },
    point: openingCenter(house, best.opening),
    phase: best.wall.phase || "phase1",
    fix: canWiden ? { id: "widen-door", label: "Make it 3 ft by 6 ft 8 in" } : null,
  }];
}

function hallwayWidth(house) {
  return roomsOf(house).filter(isHall).flatMap((room) => {
    const narrow = Math.min(spans(room).width, spans(room).depth);
    if (narrow + 1e-6 >= 3) return [];
    return [{
      id: `hall-${room.id}`,
      title: `${room.name} is under 3 ft wide`,
      ...targetRoom(room),
    }];
  });
}

function stairWidth(house) {
  return roomsOf(house).filter(isStair).flatMap((room) => {
    const narrow = Math.min(spans(room).width, spans(room).depth);
    if (narrow + 1e-6 >= 3) return [];
    return [{
      id: `stair-${room.id}`,
      title: `${room.name} is under 36 in wide`,
      ...targetRoom(room),
    }];
  });
}

function smokeNear(house, room, alarm) {
  const at = deviceAt(house, alarm);
  if (inRoom(house, room, at) && pointInRing(at, room.polygon || [])) return false;
  return distToRing(at, room.polygon || []) <= 15;
}

function smokeRule(house) {
  const alarms = smokes(house);
  const hits = [];
  for (const room of roomsOf(house).filter(isSleeping)) {
    const inside = alarms.some((alarm) => pointInRing(deviceAt(house, alarm), room.polygon || []));
    if (!inside) {
      hits.push({
        id: `smoke-in-${room.id}`,
        title: `${room.name} needs a smoke alarm`,
        ...targetRoom(room),
        fix: { id: "add-smoke", label: "Add a smoke alarm" },
      });
    }
    const outside = alarms.some((alarm) => smokeNear(house, room, alarm));
    if (!outside) {
      const neighbor = roomsOf(house).find((item) => item.id !== room.id && !isSleeping(item) && !item.outdoor);
      hits.push({
        id: `smoke-out-${room.id}`,
        title: `Smoke alarm outside ${room.name}`,
        ...(neighbor ? targetRoom(neighbor) : targetRoom(room)),
        target: neighbor ? { type: "room", id: neighbor.id } : { type: "room", id: room.id },
        phase: room.phase || "phase1",
        fix: neighbor ? { id: "add-smoke", label: "Add a smoke alarm" } : null,
      });
    }
  }
  for (const alarm of alarms) {
    const at = deviceAt(house, alarm);
    const close = (house.openings || []).some((opening) => {
      if (opening.type !== "door") return false;
      const center = openingCenter(house, opening);
      if (!center || Math.hypot(center.x - at.x, center.y - at.y) > 3) return false;
      return roomsOf(house).some((room) => isBath(room) && servesRoom(house, room, opening));
    });
    if (!close) continue;
    hits.push({
      id: `smoke-bath-${alarm.id}`,
      title: "Smoke alarm is close to a bathroom",
      severity: "warning",
      target: { type: "device", id: alarm.id },
      point: at,
      phase: alarm.phase || "phase1",
    });
  }
  return hits;
}

function coRule(house) {
  const alarms = smokes(house);
  return roomsOf(house).filter(isSleeping).flatMap((room) => {
    const outside = alarms.some((alarm) => smokeNear(house, room, alarm));
    if (outside) return [];
    const neighbor = roomsOf(house).find((item) => item.id !== room.id && !isSleeping(item) && !item.outdoor);
    return [{
      id: `co-${room.id}`,
      title: `CO alarm outside ${room.name}`,
      ...(neighbor ? targetRoom(neighbor) : targetRoom(room)),
      target: { type: "room", id: neighbor?.id || room.id },
      phase: room.phase || "phase1",
      fix: neighbor ? { id: "add-smoke", label: "Add a smoke / CO alarm" } : null,
    }];
  });
}

function garageHeat(house) {
  return roomsOf(house).filter((room) => /garage/i.test(nameOf(room))).flatMap((room) => {
    const hasHeat = devices(house).some((device) => device.roomId === room.id && /heat/i.test(`${device.kind} ${device.name}`));
    if (hasHeat) return [];
    return [{
      id: `garage-heat-${room.id}`,
      title: "Garage needs a heat alarm",
      ...targetRoom(room),
    }];
  });
}

function bathExhaust(house) {
  return roomsOf(house).filter((room) => isBath(room)).flatMap((room) => {
    const fan = devices(house).some((device) => device.kind === "fan" && (device.roomId === room.id || inRoom(house, room, deviceAt(house, device))));
    if (fan) return [];
    return [{
      id: `bath-fan-${room.id}`,
      title: `${room.name} needs an exhaust fan`,
      ...targetRoom(room),
      fix: { id: "add-fan", label: "Add an exhaust fan" },
    }];
  });
}

function gfciRule(house, ctx) {
  const hits = [];
  const seen = new Set();
  for (const device of ctx.electrical?.devices || []) {
    if (device.ghost || !plainReceptacle(device)) continue;
    if (!gfciPlace(house, device)) continue;
    seen.add(device.id);
    const at = deviceAt(house, device);
    hits.push({
      id: `gfci-${device.id}`,
      title: "This outlet needs GFCI",
      target: { type: "device", id: device.id },
      point: at,
      phase: device.phase || "phase1",
      fix: { id: "make-gfci", label: "Make it GFCI" },
    });
  }
  for (const gap of ctx.electrical?.gaps || []) {
    if (!String(gap.section || "").includes("210.8") && !String(gap.section || "").includes("210.52(D)")) continue;
    const room = roomsOf(house).find(isBath);
    hits.push({
      id: "gfci-bath-missing",
      title: "Bathroom needs a GFCI",
      ...(room ? targetRoom(room) : { point: { x: 0, y: 0 }, phase: "phase1", target: { type: "house", id: "house" } }),
    });
  }
  return hits;
}

function afciRule(house, ctx) {
  const list = ctx.electrical?.devices || [];
  const hits = [];
  for (const circuit of ctx.electrical?.circuits || []) {
    if (circuit.volts !== 120 || ![15, 20].includes(circuit.amps) || circuit.afci) continue;
    const onCircuit = list.filter((device) => circuit.deviceIds?.includes(device.id));
    const room = onCircuit.map((device) => roomsOf(house).find((item) => item.id === device.roomId)).find(needsAfci);
    if (!room) continue;
    const device = onCircuit[0];
    hits.push({
      id: `afci-${circuit.id}`,
      title: `${circuit.name} needs AFCI`,
      target: device ? { type: "device", id: device.id } : { type: "room", id: room.id },
      point: device ? deviceAt(house, device) : centroid(room),
      phase: room.phase || "phase1",
    });
  }
  return hits;
}

function spacingRule(house) {
  const receptacles = devices(house).filter(isReceptacle).map((device) => ({ device, at: deviceAt(house, device) }));
  return roomsOf(house).flatMap((room) => {
    if (room.outdoor || isBath(room) || isHall(room) || isStair(room)) return [];
    if (/garage|patio|closet/i.test(nameOf(room))) return [];
    const kitchen = isKitchen(room);
    const edges = roomEdges(room).filter((edge) => edge.length >= 2 - 1e-6);
    if (!edges.length) return [];
    const counter = kitchen ? edges.reduce((best, edge) => (edge.length > best.length ? edge : best), edges[0]) : null;
    const failed = edges.some((edge) => {
      const doors = (house.openings || []).filter((opening) => opening.type === "door").flatMap((opening) => {
        const center = openingCenter(house, opening);
        if (!center) return [];
        const hit = project(center, edge.a, edge.b);
        if (!hit || hit.dist > 1.6) return [];
        return [[hit.along - opening.width / 2, hit.along + opening.width / 2]];
      });
      const reach = edge === counter ? 2 : 6;
      const stations = receptacles.flatMap(({ at }) => {
        const hit = project(at, edge.a, edge.b);
        if (!hit || hit.dist > 2) return [];
        return [hit.along];
      });
      return spacingSpans(edge, doors).some((span) => edgeFails(span, stations, reach));
    });
    if (!failed) return [];
    return [{
      id: `spacing-${room.id}`,
      title: `${room.name} outlets are too far apart`,
      why: kitchen
        ? `${NEC_RULES.kitchen.text} ${NEC_RULES.kitchen.note}`
        : NEC_RULES.spacing.text,
      fix: { id: "guide-outlets", label: "Suggest outlets" },
      ...targetRoom(room),
    }];
  });
}

function kitchenCircuits(house, ctx) {
  return (ctx.electrical?.gaps || []).filter((gap) => String(gap.section || "").includes("210.11(C)(1)")).map((gap) => {
    const room = roomsOf(house).find(isKitchen);
    return {
      id: "kitchen-circuits",
      title: "Kitchen needs two small-appliance circuits",
      message: gap.message,
      ...(room ? targetRoom(room) : { point: { x: 0, y: 0 }, phase: "phase1", target: { type: "house", id: "house" } }),
    };
  });
}

function laundryCircuit(house, ctx) {
  return (ctx.electrical?.gaps || []).filter((gap) => String(gap.section || "").includes("210.11(C)(2)")).map(() => {
    const room = roomsOf(house).find((item) => /laundry/i.test(nameOf(item)));
    return {
      id: "laundry-circuit",
      title: "Laundry needs a 20A circuit",
      ...(room ? targetRoom(room) : { point: { x: 0, y: 0 }, phase: "phase1", target: { type: "house", id: "house" } }),
    };
  });
}

function voltageDrop(house, ctx) {
  return (ctx.electrical?.circuits || []).filter((circuit) => circuit.voltageDrop?.percent > BRANCH_DROP_PERCENT).map((circuit) => {
    const device = (ctx.electrical.devices || []).find((item) => item.id === circuit.deviceIds?.[circuit.deviceIds.length - 1])
      || (ctx.electrical.devices || []).find((item) => circuit.deviceIds?.includes(item.id));
    return {
      id: `drop-${circuit.id}`,
      title: `${circuit.name} drops ${circuit.voltageDrop.percent}%`,
      target: device ? { type: "device", id: device.id } : { type: "house", id: circuit.id },
      point: device ? deviceAt(house, device) : { x: 0, y: 0 },
      phase: device?.phase || "phase1",
    };
  });
}

function toiletClearance(house) {
  return (house.plumbing?.fixtures || []).filter((fixture) => !fixture.ghost && fixture.kind === "toilet").flatMap((fixture) => {
    const side = sideClearance(house, fixture);
    if (side == null || side + 1e-6 >= 1.25) return [];
    return [{
      id: `toilet-${fixture.id}`,
      title: "Toilet is close to a side wall",
      target: { type: "fixture", id: fixture.id },
      point: { x: fixture.x, y: fixture.y },
      phase: fixture.phase || "phase1",
      why: `The center is ${Math.round(side * 12)} in. from a side wall. UPC 402.5 wants 15 in. The front clear space is 24 in. in the illustrated training manual and 21 in. on a Washington rough-in checklist, so the front dimension is not checked.`,
    }];
  });
}

function trapArm(house, ctx) {
  return (ctx.plumbing?.dwv || []).flatMap((arm) => {
    if (!arm.trap || !(arm.trapArm > trapArmLimit(arm.trap) + 1e-6)) return [];
    const fixture = (house.plumbing?.fixtures || []).find((item) => item.id === arm.fixtureId);
    return [{
      id: `trap-${arm.fixtureId}`,
      title: `Trap arm is ${arm.trapArm} ft`,
      target: { type: "fixture", id: arm.fixtureId },
      point: fixture ? { x: fixture.x, y: fixture.y } : null,
      phase: fixture?.phase || "phase1",
      why: `${UPC_RULES.trapArm.text} This one allows ${trapArmLimit(arm.trap)} ft for a ${arm.trap} in. trap. The cell values are the ones already used for sizing and still need a check against the adopted table.`,
    }];
  });
}

function slopeRule(house, ctx) {
  const building = ctx.plumbing?.building;
  if (!building?.size || building.size >= 4 || !(building.length > 0)) return [];
  if (!(building.slope?.inchesPerFoot < 0.25 - 1e-6)) return [];
  const fixture = (house.plumbing?.fixtures || []).find((item) => !item.ghost);
  return [{
    id: "drain-slope",
    title: "Building drain slope is flat",
    target: fixture ? { type: "fixture", id: fixture.id } : { type: "house", id: "drain" },
    point: fixture ? { x: fixture.x, y: fixture.y } : { x: 0, y: 0 },
    phase: fixture?.phase || "phase1",
  }];
}

function ventRule(house, ctx) {
  const design = ctx.plumbing;
  if (!design || design.vent?.size || !(design.dfu > 0)) return [];
  const fixture = (house.plumbing?.fixtures || []).find((item) => !item.ghost);
  return [{
    id: "drain-vent",
    title: "A drain has no vent",
    target: fixture ? { type: "fixture", id: fixture.id } : { type: "house", id: "vent" },
    point: fixture ? { x: fixture.x, y: fixture.y } : { x: 0, y: 0 },
    phase: fixture?.phase || "phase1",
  }];
}

function massWall(house) {
  return (house.plumbing?.fixtures || []).filter((fixture) => !fixture.ghost).flatMap((fixture) => {
    const wall = (house.walls || []).find((item) => item.id === fixture.wallId);
    if (fixture.kind === "hose-bibb") {
      return [{
        id: `hose-${fixture.id}`,
        title: "Hose bibb needs a sleeve",
        severity: "tip",
        target: { type: "fixture", id: fixture.id },
        point: { x: fixture.x, y: fixture.y },
        phase: fixture.phase || "phase1",
      }];
    }
    if (!wall || !isMassWall(wall) || fixture.chase) return [];
    return [{
      id: `chase-${fixture.id}`,
      title: "Pipe in a mass wall",
      target: { type: "fixture", id: fixture.id },
      point: { x: fixture.x, y: fixture.y },
      phase: fixture.phase || "phase1",
      fix: { id: "add-chase", label: "Add a furred chase" },
    }];
  });
}

function wallInsulation(house) {
  const hemp = (house.walls || []).filter((wall) => hempInches(wall));
  const hits = [];
  if (hemp.length) {
    const inches = hempInches(hemp[0]);
    const r = Math.round(inches * HEMP_R_PER_INCH);
    hits.push({
      id: "hemp-r",
      title: `Hempcrete models about R-${r}`,
      target: { type: "wall", id: hemp[0].id },
      point: wallMid(hemp[0]),
      phase: hemp[0].phase || "phase1",
      fix: { id: "show-wall", label: "Show this wall" },
      why: `The hemp layer in the assembly is ${inches} in. Hemp and Block publishes R-2 per inch for a conventional binder and hurd mix, so this model uses R-${r}. Table R402.1.3 asks for wood-frame walls of R-20+5 or R-13+10. That comparison is an assumption, not a U-factor calculation. Source: ${HEMP_URL}`,
    });
  }
  const rammed = (house.walls || []).filter((wall) => (wall.assemblyId || "").includes("rammed") || wall.assembly === "rammed-earth");
  if (rammed.length) {
    hits.push({
      id: "rammed-r",
      title: "Rammed earth R-value is unknown",
      severity: "tip",
      target: { type: "wall", id: rammed[0].id },
      point: wallMid(rammed[0]),
      phase: rammed[0].phase || "phase1",
      fix: { id: "show-wall", label: "Show this wall" },
      why: "Table R402.1.3 sets the wood-frame wall target. This model has no published R-value for the rammed earth, so that wall is not compared to the table.",
    });
  }
  return hits;
}

function ceilingFloor(house) {
  if (!roomsOf(house).some((room) => !room.outdoor)) return [];
  const ceiling = house.energy?.ceilingR;
  const floor = house.energy?.floorR;
  if (ceiling >= 60 && floor >= 30) return [];
  const room = roomsOf(house).find((item) => !item.outdoor);
  return [{
    id: "ceiling-floor-r",
    title: "Ceiling and floor R are not set",
    ...targetRoom(room),
    target: { type: "house", id: "insulation" },
    fix: { id: "record-insulation", label: "Record R-60 and R-30" },
    why: "Table R402.1.3 asks for ceiling R-60 and floor R-30. The plan does not draw that insulation. Recording the two numbers clears this check. It does not prove the insulation is installed. A vaulted ceiling may use R-38 where the full depth crosses the top plate.",
  }];
}

export const CODE_RULES = [
  {
    id: "irc.room-area",
    title: "Room under 70 sq ft",
    why: "A habitable room needs at least 70 sq ft. Kitchens are excepted. Bathrooms, halls, and closets are not habitable rooms.",
    severity: "blocker",
    citation: cite(IRC, "R304.1", GRANT),
    appliesTo: ["room"],
    check: roomArea,
  },
  {
    id: "irc.room-dimension",
    title: "Room under 7 ft",
    why: "A habitable room needs at least 7 ft in any horizontal dimension. Kitchens are excepted. This measures the east-west and north-south spans of the room.",
    severity: "blocker",
    citation: cite(IRC, "R304.2", GRANT),
    appliesTo: ["room"],
    check: roomDimension,
  },
  {
    id: "irc.ceiling-height",
    title: "Ceiling is low",
    why: "Habitable rooms and hallways need 7 ft. Bathrooms, toilet rooms, and laundry rooms need 6 ft 8 in. The check uses the wall height beside the room.",
    severity: "blocker",
    citation: cite(IRC, "R305.1", GRANT),
    appliesTo: ["room"],
    check: ceilingRule,
  },
  {
    id: "irc.egress-window",
    title: "Sleeping room egress",
    why: "Every sleeping room needs an emergency escape opening. Washington rewrote R310.1. The opening size here is the base R310.2 text, which that amendment does not replace.",
    severity: "blocker",
    citation: cite(IRC, "R310.2.1 and R310.2.2", "https://apps.leg.wa.gov/wac/default.aspx?cite=51-51-03100"),
    appliesTo: ["opening", "room"],
    check: egressWindow,
  },
  {
    id: "irc.egress-door",
    title: "Egress door",
    why: "The required egress door is side-hinged, with a net clear opening of 32 in. wide and 78 in. high. A drawn door of 3 ft by 6 ft 8 in. stands in for that clear opening. Other doors do not have to match it.",
    severity: "warning",
    citation: cite(IRC, "R311.2", "https://bsd.dli.mt.gov/_docs/Training/IRC-Means-of-Egress-2021-IRC.pdf"),
    appliesTo: ["opening"],
    check: egressDoor,
  },
  {
    id: "irc.hallway",
    title: "Hallway is narrow",
    why: "A hallway needs to be at least 3 ft wide. The check uses the room's shorter plan span. A room named Hall bath is a bathroom, not a hallway.",
    severity: "warning",
    citation: cite(IRC, "R311.6", "https://up.codes/s/hallways"),
    appliesTo: ["room"],
    check: hallwayWidth,
  },
  {
    id: "irc.stair",
    title: "Stair is narrow",
    why: "A stairway needs 36 in. clear width above the handrail. The check uses the room's shorter plan span when a room is named as a stair. The sample has no stair, so this stays quiet until one is drawn.",
    severity: "warning",
    citation: cite(IRC, "R311.7.1", "https://stairways.org/blog/r311-7-1-width-2021/"),
    appliesTo: ["room"],
    check: stairWidth,
  },
  {
    id: "irc.smoke",
    title: "Smoke alarm",
    why: "Washington requires a smoke alarm in each sleeping room and outside each separate sleeping area. One within 15 ft of the bedroom, and not inside it, counts here as outside the sleeping area. An alarm also wants 3 ft of clearance from a bathroom door.",
    severity: "blocker",
    citation: cite(IRC, "R314.3", "https://apps.leg.wa.gov/wac/default.aspx?cite=51-51-0314"),
    appliesTo: ["room", "device"],
    check: smokeRule,
  },
  {
    id: "irc.co",
    title: "CO alarm",
    why: "Washington requires a carbon monoxide alarm outside each separate sleeping area and on each level of a new dwelling, not only where there is fuel equipment. The smoke / CO alarm in the electrical tool counts as that combination.",
    severity: "blocker",
    citation: cite(IRC, "R315.2.1 and R315.3", "https://apps.leg.wa.gov/wac/default.aspx?cite=51-51-0315"),
    appliesTo: ["room"],
    check: coRule,
  },
  {
    id: "irc.garage-heat",
    title: "Garage heat alarm",
    why: "A new attached garage needs a heat detector or heat alarm in a central location. The electrical tool has no heat-detector kind yet, so this stays until one is placed in the garage.",
    severity: "warning",
    citation: cite(IRC, "R314.2.3", "https://apps.leg.wa.gov/wac/default.aspx?cite=51-51-0314"),
    appliesTo: ["room"],
    check: garageHeat,
  },
  {
    id: "irc.bath-exhaust",
    title: "Bathroom exhaust",
    why: "Washington did not adopt the window option in R303.3. A bathroom or toilet room needs local exhaust. The table lists 50 cfm intermittent or 20 cfm continuous. The model can see the fan, not the airflow.",
    severity: "warning",
    citation: cite(IRC, "M1505.4.4.1", "https://apps.leg.wa.gov/wac/default.aspx?cite=51-51-1505"),
    appliesTo: ["room"],
    check: bathExhaust,
  },
  {
    id: "nec.gfci",
    title: "GFCI",
    why: "A receptacle in a bathroom, kitchen, laundry, garage, or outdoors needs GFCI protection, as does one within 6 ft of a sink in the same room. The 6 ft check does not reach through a wall.",
    severity: "blocker",
    citation: cite(NEC, "210.8(A)", NEC.url),
    appliesTo: ["device"],
    check: gfciRule,
  },
  {
    id: "nec.afci",
    title: "AFCI",
    why: "A 15A or 20A, 120V circuit serving a kitchen, living room, bedroom, hallway, laundry, or similar room needs AFCI. Bathrooms, garages, and outdoors are not in that list.",
    severity: "warning",
    citation: cite(NEC, "210.12(B)", "https://www.mikeholt.com/newsletters.php?action=display&letterID=2750"),
    appliesTo: ["device"],
    check: afciRule,
  },
  {
    id: "nec.receptacle-spacing",
    title: "Outlets too far apart",
    why: NEC_RULES.spacing.text,
    severity: "warning",
    citation: cite(NEC, "210.52(A)", NEC.url),
    appliesTo: ["room"],
    check: spacingRule,
  },
  {
    id: "nec.kitchen-circuits",
    title: "Kitchen small-appliance circuits",
    why: "A kitchen needs at least two 20A small-appliance branch circuits.",
    severity: "warning",
    citation: cite(NEC, "210.11(C)(1)", NEC.url),
    appliesTo: ["room"],
    check: kitchenCircuits,
  },
  {
    id: "nec.laundry-circuit",
    title: "Laundry circuit",
    why: "A laundry area needs at least one 20A branch circuit.",
    severity: "warning",
    citation: cite(NEC, "210.11(C)(2)", NEC.url),
    appliesTo: ["room"],
    check: laundryCircuit,
  },
  {
    id: "nec.voltage-drop",
    title: "Voltage drop",
    why: NEC_RULES.voltageDrop.text,
    severity: "tip",
    citation: cite(NEC, "210.19(A) Informational Note", NEC.url),
    appliesTo: ["device"],
    check: voltageDrop,
  },
  {
    id: "upc.toilet-clearance",
    title: "Toilet clearance",
    why: "No water closet is set closer than 15 in. from its center to a side wall.",
    severity: "warning",
    citation: cite(UPC, "402.5", "https://eofficial.org/uniform-codes-spotlight-may-25-2023/"),
    appliesTo: ["fixture"],
    check: toiletClearance,
  },
  {
    id: "upc.trap-arm",
    title: "Trap arm is long",
    why: UPC_RULES.trapArm.text,
    severity: "warning",
    citation: cite(UPC, "Table 1002.2", UPC_RULES.trapArm.url, { confirmSection: true }),
    appliesTo: ["fixture"],
    check: trapArm,
  },
  {
    id: "upc.slope",
    title: "Drain slope",
    why: "Horizontal drainage smaller than 4 in. is checked here at 1/4 in. per ft. The section number 708.1 comes from a slope chart, not from the adopted book, so confirm it.",
    severity: "warning",
    citation: cite(UPC, "708.1", "https://www.tradesmancalculator.com/charts/pipe-slope-chart/", { confirmSection: true }),
    appliesTo: ["fixture"],
    check: slopeRule,
  },
  {
    id: "upc.vent",
    title: "Drain vent",
    why: "A fixture drain needs a vent. The model sizes one from Table 703.2 when a drain exists. This fires only when that vent size is missing.",
    severity: "warning",
    citation: cite(UPC, "Chapter 9", UPC.url, { confirmSection: true }),
    appliesTo: ["fixture"],
    check: ventRule,
  },
  {
    id: "upc.mass-wall",
    title: "Pipe in a mass wall",
    why: "Supply and drain should not run inside hempcrete or rammed earth. Add a furred chase or move the fixture to an interior wall. This is an assumption for the plumber and the inspector, not a quoted code section.",
    severity: "warning",
    citation: cite(UPC, "confirm section", UPC_ADOPT_PLACEHOLDER(), { confirmSection: true }),
    appliesTo: ["fixture"],
    check: (house) => massWall(house).filter((item) => item.id.startsWith("chase-")),
  },
  {
    id: "upc.hose-sleeve",
    title: "Hose bibb sleeve",
    why: "A hose bibb penetrates the exterior wall. Use a sleeve and confirm the frost-free detail. This is an assumption, not a quoted code section.",
    severity: "tip",
    citation: cite(UPC, "confirm section", UPC.url, { confirmSection: true }),
    appliesTo: ["fixture"],
    check: (house) => massWall(house).filter((item) => item.id.startsWith("hose-")),
  },
  {
    id: "wsec.wall-insulation",
    title: "Wall insulation",
    why: "Climate Zone 5 and Marine 4 wood-frame walls are R-20+5 or R-13+10. Jefferson County is Marine 4.",
    severity: "warning",
    citation: cite(WSEC, "Table R402.1.3", "https://sbcc.wa.gov/sites/default/files/2024-01/2021_WSEC_R_2ndEd_012524.pdf"),
    appliesTo: ["wall"],
    check: wallInsulation,
  },
  {
    id: "wsec.ceiling-floor",
    title: "Ceiling and floor insulation",
    why: "Table R402.1.3 lists ceiling R-60 and floor R-30.",
    severity: "warning",
    citation: cite(WSEC, "Table R402.1.3", "https://apps.leg.wa.gov/wac/default.aspx?cite=51-11R-40213"),
    appliesTo: ["house"],
    check: ceilingFloor,
  },
];

function UPC_ADOPT_PLACEHOLDER() {
  return UPC.adoptionUrl;
}

function finish(rule, hit) {
  return {
    ...hit,
    id: hit.id || `${rule.id}:${hit.target?.id || "house"}`,
    ruleId: rule.id,
    code: rule.id,
    title: hit.title || rule.title,
    message: hit.message || hit.title || rule.title,
    why: hit.why || rule.why,
    severity: hit.severity || rule.severity,
    citation: hit.citation || rule.citation,
    appliesTo: rule.appliesTo,
  };
}

export function codeWarnings(house, injected = null) {
  const electrical = injected && Object.prototype.hasOwnProperty.call(injected, "electrical")
    ? injected.electrical
    : buildElectrical(house);
  const plumbing = injected && Object.prototype.hasOwnProperty.call(injected, "plumbing")
    ? injected.plumbing
    : buildPlumbing(house);
  const ctx = { electrical, plumbing };
  return CODE_RULES.flatMap((rule) => (rule.check(house, ctx) || []).map((hit) => finish(rule, hit)));
}

export function ruleById(id) {
  return CODE_RULES.find((rule) => rule.id === id) || null;
}
