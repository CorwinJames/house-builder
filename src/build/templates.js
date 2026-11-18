/**
 * Templates: whole traditional buildings and compounds from China, Japan, and
 * Korea, laid out on each tradition's bay module, ready to drop on the plan
 * and edit like anything drawn by hand.
 *
 * A template is written as rooms (rectangles on wall centerlines), a few
 * extra walls, doors and windows on room sides, posts, and building settings
 * (roof form, ridge direction, eave curve, platform, roof pitch). Walls are
 * worked out from the rooms: a side one enclosed room owns is an outside
 * wall in the building's outside assembly; a side two rooms share is a
 * partition in the building's inside assembly. Covered rooms (verandas,
 * engawa) and site rooms (courtyards) make no walls of their own.
 *
 * Plan units are feet, +x east, +y north. Every template's front faces south.
 * No DOM, no Three.js.
 *
 * Bay modules (each a cited range, rounded to whole feet for drawing):
 *  - jian (China), the bay between two columns: 3.3 to 3.6 m in north China
 *    (Knapp, China's Old Dwellings). 11 ft here.
 *  - ken (Japan): 6 shaku, 1.82 m. 6 ft here.
 *  - kan (Korea): about 8 ja, about 2.4 m. 8 ft here.
 * Heights for platforms and raised floors are placeholders to edit, except
 * the minka floor, which sources give as about 50 cm (20 in) over the doma.
 */
import { assemblyById, headerForSpan } from "./catalog.js";
import { applyAssembly } from "./walls.js";
import { nextId } from "./ids.js";
import { clipTogether, endsAt, withJoins } from "./clips.js";
import { detectFaces, syncRooms } from "./rooms.js";

export const BAYS = [
  { id: "off", label: "Off", feet: 0 },
  { id: "jian", label: "Jian 11 ft", feet: 11, note: "Chinese bay (jian): 3.3 to 3.6 m between columns in north China." },
  { id: "kan", label: "Kan 8 ft", feet: 8, note: "Korean bay (kan): about 8 ja, about 2.4 m." },
  { id: "ken", label: "Ken 6 ft", feet: 6, note: "Japanese bay (ken): 6 shaku, 1.82 m." },
];

export const TEMPLATE_SOURCES = {
  uw: { name: "University of Washington, A Visual Sourcebook of Chinese Civilization: The Chinese House", url: "https://depts.washington.edu/chinaciv/home/3intrhme.htm" },
  liang: { name: "Liang Sicheng, A History of Chinese Architecture (中国建筑史)", url: "https://www.scribd.com/document/886837364/梁思成中国建筑史" },
  knapp: { name: "Ronald G. Knapp, China's Old Dwellings, ch. 2 Composing Space", url: "https://manifold.uhpress.hawaii.edu/read/china-s-old-dwellings/section/b04d6ab3-9dbd-4c3a-ba86-b8b25332a67b" },
  siheyuan: { name: "Wikipedia: Beijing siheyuan", url: "https://en.wikipedia.org/wiki/Beijing_siheyuan" },
  roofs: { name: "Wikipedia: Traditional Chinese roofing", url: "https://en.wikipedia.org/wiki/Traditional_Chinese_roofing" },
  qing: { name: "China Daily: Flush gable roof (Qing rules for commoners' halls)", url: "https://subsites.chinadaily.com.cn/mctpgm/2024-04/23/c_981660.htm" },
  hui: { name: "Wikipedia: Hui Style architecture", url: "https://en.wikipedia.org/wiki/Hui_Style_architecture" },
  ken: { name: "Wikipedia: Ken (unit)", url: "https://en.wikipedia.org/wiki/Ken_(unit)" },
  minka: { name: "Wikipedia: Minka", url: "https://en.wikipedia.org/wiki/Minka" },
  jaanus: { name: "JAANUS: minka", url: "https://projects.mcah.columbia.edu/jaanus/record/minka" },
  machiya: { name: "Wikipedia: Machiya", url: "https://en.wikipedia.org/wiki/Machiya" },
  kan: { name: "Park and Jeon, Kan composition of traditional Korean architecture (WCTE)", url: "https://proceedings.com/content/069/069179-0569open.pdf" },
  hanok: { name: "Wikipedia: Hanok", url: "https://en.wikipedia.org/wiki/Hanok" },
  hanokShapes: { name: "Secret Retreats: Hanok shapes", url: "https://www.secret-retreats.com/experience-hanok-culture" },
  hyangdan: { name: "Encyclopedia of Korean Culture (AKS): 경주 양동 향단", url: "https://encykorea.aks.ac.kr/Article/E0062889" },
  hyangdanKan: { name: "Tectonic Characteristics of 'Kan' in Hyangdan at Yang-Dong Village (KIRA, 2002)", url: "https://koreascience.kr/article/JAKO200229264789965.page" },
  katsuraKikuyo: { name: "Kikuyō Bunka Kyōkai (Imperial Household Agency materials): Katsura Imperial Villa", url: "https://kikuyou.or.jp/gosyo_rikyu/katsura-rikyu.html" },
  katsuraWiki: { name: "Wikipedia: Katsura Imperial Villa", url: "https://en.wikipedia.org/wiki/Katsura_Imperial_Villa" },
  katsuraBrit: { name: "Britannica: Katsura Imperial Villa", url: "https://www.britannica.com/print/article/313339" },
  kunaicho: { name: "Imperial Household Agency: Katsura Imperial Villa", url: "https://kyoto-gosho.kunaicho.go.jp/en/katsura-rikyu" },
  shugakuin: { name: "Kikuyō Bunka Kyōkai (Imperial Household Agency materials): Shugakuin Imperial Villa", url: "https://kikuyou.or.jp/gosyo_rikyu/shugakuin-rikyu.html" },
  shugakuinIha: { name: "Imperial Household Agency: Kyoto facilities", url: "https://www.kunaicho.go.jp/en/learn/institution/shisetsu/kyoto/kyoto.html" },
  gasshoPlan: { name: "Gifu Women's University digital archive: Wada house floor plan (Shirakawa-go)", url: "https://adeac.jp/gijodai-univ-da-res/texthtml/d100010/mp000010-100010/ht000040" },
  gasshoUnesco: { name: "Agency for Cultural Affairs: Shirakawa-go/Gokayama nomination, scale and form of plan", url: "https://bunka.nii.ac.jp/suisensyo/shirakawago/MAINTEXT/outline5.html" },
  gasshoRoof: { name: "Agency for Cultural Affairs: Shirakawa-go/Gokayama nomination, roof", url: "https://bunka.nii.ac.jp/suisensyo/shirakawago/MAINTEXT/outline4.html" },
  gasshoMlit: { name: "Japan Tourism Agency: Gasshō-zukuri, single-story houses with multiple levels", url: "https://www.mlit.go.jp/tagengo-db/common/001781892.pdf" },
  doma: { name: "JAANUS: doma", url: "https://projects.mcah.columbia.edu/jaanus/node/4790" },
  umaya: { name: "JAANUS: umaya", url: "https://projects.mcah.columbia.edu/jaanus/node/392" },
  folkoDoma: { name: "Folko: Japanese minka, three-room dwellings (doma uses)", url: "https://www.folko.com.au/blog/2024/7/4/japanese-minka-xxxix-planning-17-three-room-dwellings-6" },
};

const JIAN = 11;
const KEN = 6;
const KAN = 8;
const EXT = { timber: "timber-infill-exterior", brick: "brick-exterior", screen: "paper-screen", part: "interior-partition" };

/** A small writer for one template's layout. */
function layout() {
  const t = { rooms: [], extra: [], openings: [], columns: [], buildings: {} };
  const api = {
    t,
    building(key, spec) {
      t.buildings[key] = spec;
      return key;
    },
    /** A room on wall centerlines. kind: heated (walls), covered or site (no walls of its own). */
    room(name, x0, y0, x1, y1, opts = {}) {
      const kind = opts.kind || "heated";
      const room = {
        name,
        rect: { x0, y0, x1, y1 },
        kind,
        building: opts.building || null,
        level: opts.level || 0,
        finish: opts.finish || (kind === "site" ? "stone" : "wood"),
        walls: kind === "heated" && opts.walls !== false,
        open: opts.open || "",
        sides: opts.sides || {},
      };
      t.rooms.push(room);
      return room;
    },
    wall(x0, y0, x1, y1, assemblyId) {
      t.extra.push({ a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, assemblyId });
    },
    door(room, side, width, style = "swing", at = 0.5) {
      t.openings.push({ point: sidePoint(room.rect, side, at), side, type: "door", width, height: 6.667, sill: 0, style });
    },
    window(room, side, width, at = 0.5, height = 4, sill = 3) {
      t.openings.push({ point: sidePoint(room.rect, side, at), side, type: "window", width, height, sill });
    },
    /** Posts from (x0, y0) to (x1, y1), about `spacing` apart, both ends included. */
    posts(x0, y0, x1, y1, spacing, size = 0.75, building = null) {
      const length = Math.hypot(x1 - x0, y1 - y0);
      const gaps = Math.max(1, Math.round(length / spacing));
      for (let i = 0; i <= gaps; i += 1) {
        t.columns.push({ x: x0 + ((x1 - x0) * i) / gaps, y: y0 + ((y1 - y0) * i) / gaps, size, building });
      }
    },
  };
  return api;
}

function sidePoint(rect, side, at) {
  if (side === "s") return { x: rect.x0 + (rect.x1 - rect.x0) * at, y: rect.y0 };
  if (side === "n") return { x: rect.x0 + (rect.x1 - rect.x0) * at, y: rect.y1 };
  if (side === "w") return { x: rect.x0, y: rect.y0 + (rect.y1 - rect.y0) * at };
  return { x: rect.x1, y: rect.y0 + (rect.y1 - rect.y0) * at };
}

/** A row of rooms along x (bays from west to east), each [name, width]. Returns the rooms. */
function rowX(L, x0, y0, depth, parts, opts = {}) {
  let x = x0;
  return parts.map(([name, width, extra]) => {
    const room = L.room(name, x, y0, x + width, y0 + depth, { ...opts, ...(extra || {}) });
    x += width;
    return room;
  });
}

/** A row of rooms along y (bays from south to north), each [name, length]. */
function rowY(L, x0, y0, width, parts, opts = {}) {
  let y = y0;
  return parts.map(([name, length, extra]) => {
    const room = L.room(name, x0, y, x0 + width, y + length, { ...opts, ...(extra || {}) });
    y += length;
    return room;
  });
}

// ---------------------------------------------------------------- China

function threeBayHall() {
  const L = layout();
  const b = L.building("hall", { name: "Three-bay hall", style: "flush-gable", ridge: "east-west", curve: 0.15, platform: 1.5, ext: EXT.brick, int: EXT.part });
  const front = { s: EXT.timber };
  const [west, middle, east] = rowX(L, 0, 0, 16, [["West room", JIAN], ["Central hall (mingjian)", JIAN], ["East room", JIAN]], { building: b, level: 1.5, sides: front });
  L.room("Front gallery", 0, -5, JIAN * 3, 0, { kind: "covered", building: b, level: 1.5, finish: "stone" });
  L.posts(0, -5, JIAN * 3, -5, JIAN, 0.9, b);
  L.door(middle, "s", 5, "swing");
  L.window(west, "s", 7, 0.5, 5, 2.5);
  L.window(east, "s", 7, 0.5, 5, 2.5);
  L.door(west, "e", 3, "cased", 0.7);
  L.door(east, "w", 3, "cased", 0.7);
  return L.t;
}

function fiveBayHall() {
  const L = layout();
  const b = L.building("hall", { name: "Five-bay hall", style: "hip-and-gable", ridge: "east-west", curve: 0.4, platform: 2, ext: EXT.brick, int: EXT.part });
  const front = { s: EXT.timber };
  const rooms = rowX(L, 0, 0, 18, [
    ["West end room", 10], ["West room", JIAN], ["Central hall (mingjian)", 12], ["East room", JIAN], ["East end room", 10],
  ], { building: b, level: 2, sides: front });
  const width = 10 + JIAN + 12 + JIAN + 10;
  L.room("Front gallery", 0, -6, width, 0, { kind: "covered", building: b, level: 2, finish: "stone" });
  let x = 0;
  for (const room of rooms) {
    L.posts(x, -6, x, -6, 1, 1, b);
    x = room.rect.x1;
  }
  L.posts(width, -6, width, -6, 1, 1, b);
  L.door(rooms[2], "s", 6, "swing");
  for (const i of [0, 1, 3, 4]) L.window(rooms[i], "s", 6, 0.5, 5, 2.5);
  L.door(rooms[1], "e", 3, "cased", 0.7);
  L.door(rooms[3], "w", 3, "cased", 0.7);
  L.door(rooms[0], "e", 3, "swing", 0.7);
  L.door(rooms[4], "w", 3, "swing", 0.7);
  return L.t;
}

function siheyuan() {
  const L = layout();
  const roof = { style: "flush-gable", curve: 0.15, ext: EXT.brick, int: EXT.part };
  const main = L.building("main", { ...roof, name: "Main hall (zhengfang)", ridge: "east-west", platform: 1.5 });
  const earW = L.building("earW", { ...roof, name: "West ear room (erfang)", ridge: "east-west", platform: 1 });
  const earE = L.building("earE", { ...roof, name: "East ear room (erfang)", ridge: "east-west", platform: 1 });
  const wingW = L.building("wingW", { ...roof, name: "West wing (xiangfang)", ridge: "north-south", platform: 1 });
  const wingE = L.building("wingE", { ...roof, name: "East wing (xiangfang)", ridge: "north-south", platform: 1 });
  const south = L.building("south", { ...roof, name: "South house (daozuofang)", ridge: "east-west", platform: 0.5 });
  // Main hall: three jian, a front gallery, and an ear room each side.
  const mainRooms = rowX(L, 10, 48, 16, [["West room", JIAN], ["Central hall", JIAN], ["East room", JIAN]], { building: main, level: 1.5, sides: { s: EXT.timber } });
  L.room("Main hall gallery", 10, 44, 43, 48, { kind: "covered", building: main, level: 1.5, finish: "stone" });
  L.posts(10, 44, 43, 44, JIAN, 0.9, main);
  const earWest = L.room("West ear room", 0, 48, 10, 60, { building: earW, level: 1, sides: { s: EXT.timber } });
  const earEast = L.room("East ear room", 43, 48, 53, 60, { building: earE, level: 1, sides: { s: EXT.timber } });
  // Side wings: three bays each, facing the courtyard.
  const westRooms = rowY(L, 0, 17, 13, [["West wing room", 9], ["West wing hall", 9], ["West wing room", 9]], { building: wingW, level: 1, sides: { e: EXT.timber } });
  const eastRooms = rowY(L, 40, 17, 13, [["East wing room", 9], ["East wing hall", 9], ["East wing room", 9]], { building: wingE, level: 1, sides: { w: EXT.timber } });
  // South house faces north into the courtyard; the gate takes its east bay.
  const southRooms = rowX(L, 0, 0, 13, [["South room", 10.75], ["South room", 10.75], ["South room", 10.75], ["South room", 10.75]], { building: south, level: 0.5, sides: { n: EXT.timber } });
  const gate = L.room("Gate (damen)", 43, 0, 53, 13, { building: south, level: 0.5, finish: "stone" });
  // Outer wall where the buildings leave gaps; the east wing's south gable is the screen the gate faces.
  L.wall(0, 13, 0, 17, EXT.brick);
  L.wall(53, 13, 53, 17, EXT.brick);
  L.wall(0, 44, 0, 48, EXT.brick);
  L.wall(53, 44, 53, 48, EXT.brick);
  L.room("Courtyard", 13, 13, 40, 44, { kind: "site", finish: "stone" });
  L.door(mainRooms[1], "s", 5, "swing");
  L.window(mainRooms[0], "s", 6, 0.5, 5, 2.5);
  L.window(mainRooms[2], "s", 6, 0.5, 5, 2.5);
  L.door(mainRooms[0], "e", 3, "cased", 0.7);
  L.door(mainRooms[2], "w", 3, "cased", 0.7);
  L.door(earWest, "s", 3);
  L.door(earEast, "s", 3);
  L.door(westRooms[1], "e", 4);
  L.window(westRooms[0], "e", 5);
  L.window(westRooms[2], "e", 5);
  L.door(eastRooms[1], "w", 4);
  L.window(eastRooms[0], "w", 5);
  L.window(eastRooms[2], "w", 5);
  for (const room of [southRooms[0], southRooms[2], southRooms[3]]) L.window(room, "n", 5);
  L.door(southRooms[1], "n", 3, "swing", 0.5);
  L.door(gate, "s", 5, "swing");
  L.door(gate, "n", 6, "cased");
  return L.t;
}

function sanheyuan() {
  const L = layout();
  const roof = { style: "gable", curve: 0.2, ext: EXT.brick, int: EXT.part };
  const main = L.building("main", { ...roof, name: "Main hall", ridge: "east-west", platform: 1.5 });
  const wingW = L.building("wingW", { ...roof, name: "West wing", ridge: "north-south", platform: 1 });
  const wingE = L.building("wingE", { ...roof, name: "East wing", ridge: "north-south", platform: 1 });
  const mainRooms = rowX(L, 13, 40, 16, [["West room", JIAN], ["Central hall", JIAN], ["East room", JIAN]], { building: main, level: 1.5, sides: { s: EXT.timber } });
  L.room("Main hall gallery", 13, 36, 46, 40, { kind: "covered", building: main, level: 1.5, finish: "stone" });
  L.posts(13, 36, 46, 36, JIAN, 0.9, main);
  const westRooms = rowY(L, 0, 6, 13, [["West wing room", 9], ["West wing hall", 9], ["West wing room", 9]], { building: wingW, level: 1, sides: { e: EXT.timber } });
  const eastRooms = rowY(L, 46, 6, 13, [["East wing room", 9], ["East wing hall", 9], ["East wing room", 9]], { building: wingE, level: 1, sides: { w: EXT.timber } });
  // Front wall with the gate on the axis, and the corners closed.
  L.wall(0, 0, 25.5, 0, EXT.brick);
  L.wall(25.5, 0, 33.5, 0, EXT.brick);
  L.wall(33.5, 0, 59, 0, EXT.brick);
  L.wall(0, 0, 0, 6, EXT.brick);
  L.wall(59, 0, 59, 6, EXT.brick);
  L.wall(0, 33, 0, 40, EXT.brick);
  L.wall(0, 40, 13, 40, EXT.brick);
  L.wall(59, 33, 59, 40, EXT.brick);
  L.wall(46, 40, 59, 40, EXT.brick);
  const yard = L.room("Courtyard", 13, 0, 46, 36, { kind: "site", finish: "stone" });
  L.door(yard, "s", 6, "swing");
  L.door(mainRooms[1], "s", 5);
  L.window(mainRooms[0], "s", 6, 0.5, 5, 2.5);
  L.window(mainRooms[2], "s", 6, 0.5, 5, 2.5);
  L.door(mainRooms[0], "e", 3, "cased", 0.7);
  L.door(mainRooms[2], "w", 3, "cased", 0.7);
  L.door(westRooms[1], "e", 4);
  L.door(eastRooms[1], "w", 4);
  for (const room of [westRooms[0], westRooms[2]]) L.window(room, "e", 5);
  for (const room of [eastRooms[0], eastRooms[2]]) L.window(room, "w", 5);
  return L.t;
}

function skywellHouse() {
  const L = layout();
  const roof = { style: "gable", curve: 0.1, ext: EXT.brick, int: EXT.part };
  const hall = L.building("hall", { ...roof, name: "Hall block", ridge: "east-west" });
  const sideW = L.building("sideW", { ...roof, name: "West side room", ridge: "north-south" });
  const sideE = L.building("sideE", { ...roof, name: "East side room", ridge: "north-south" });
  const rooms = rowX(L, 0, 12, 16, [["West bedroom", JIAN], ["Open hall (tingtang)", JIAN, { sides: { s: EXT.timber } }], ["East bedroom", JIAN]], { building: hall });
  const west = L.room("West side room (xiangfang)", 0, 0, JIAN, 12, { building: sideW });
  const east = L.room("East side room (xiangfang)", JIAN * 2, 0, JIAN * 3, 12, { building: sideE });
  L.wall(JIAN, 0, JIAN * 2, 0, EXT.brick);
  const well = L.room("Skywell (tianjing)", JIAN, 0, JIAN * 2, 12, { kind: "site", finish: "stone" });
  L.door(well, "s", 4, "swing");
  L.door(rooms[1], "s", 8, "cased");
  L.door(rooms[0], "e", 3, "swing", 0.75);
  L.door(rooms[2], "w", 3, "swing", 0.75);
  L.door(west, "e", 3);
  L.door(east, "w", 3);
  return L.t;
}

// ---------------------------------------------------------------- Japan

function minka() {
  const L = layout();
  const b = L.building("minka", { name: "Minka", style: "hip", ridge: "east-west", curve: 0, pitch: 1, ext: EXT.timber, int: EXT.screen });
  const up = 1.6;
  // Raised floor: four rooms in a 田 plan.
  const zashiki = L.room("Zashiki (guest room)", 0, 0, 2 * KEN, 2 * KEN, { building: b, level: up });
  const dei = L.room("Hiroma (living room, irori)", 2 * KEN, 0, 4 * KEN, 2 * KEN, { building: b, level: up });
  L.room("Nando (bedroom)", 0, 2 * KEN, 2 * KEN, 4 * KEN, { building: b, level: up });
  L.room("Daidokoro (dining, by the doma)", 2 * KEN, 2 * KEN, 4 * KEN, 4 * KEN, { building: b, level: up });
  // Earth floor: entry and work floor with the stove and sink, then food and tool storage, then the stable.
  const doma = L.room("Doma (entry, work floor, kamado, sink)", 4 * KEN, 0, 7 * KEN, 2.5 * KEN, { building: b, level: 0, finish: "concrete", sides: { w: EXT.part } });
  L.room("Storage (food, tools, fuel)", 4 * KEN, 2.5 * KEN, 5.5 * KEN, 4 * KEN, { building: b, level: 0, finish: "concrete", sides: { w: EXT.part } });
  const umaya = L.room("Umaya (stable)", 5.5 * KEN, 2.5 * KEN, 7 * KEN, 4 * KEN, { building: b, level: 0, finish: "concrete" });
  L.room("Engawa", 0, -KEN / 2, 4 * KEN, 0, { kind: "covered", building: b, level: up - 0.2 });
  L.posts(0, -KEN / 2, 4 * KEN, -KEN / 2, KEN, 0.42, b);
  L.door(zashiki, "s", 6, "sliding");
  L.door(dei, "s", 6, "sliding");
  L.door(doma, "s", 6, "sliding", 0.6);
  L.door(umaya, "e", 4, "cased");
  L.window(doma, "e", 4);
  return L.t;
}

function machiya() {
  const L = layout();
  const roof = { style: "gable", ridge: "east-west", curve: 0, ext: EXT.timber, int: EXT.screen };
  const front = L.building("front", { ...roof, name: "Machiya street block (omoya)" });
  const rear = L.building("rear", { ...roof, name: "Machiya rear block" });
  const link = L.building("link", { ...roof, name: "Machiya passage" });
  const up = 1.3;
  const w = 2 * KEN;
  const mise = L.room("Mise (shop)", 0, 0, w, 2 * KEN, { building: front, level: up });
  L.room("Naka-no-ma (middle room)", 0, 2 * KEN, w, 4 * KEN, { building: front, level: up });
  const niwaFront = L.room("Toriniwa (earth passage)", w, 0, w + KEN, 4 * KEN, { building: front, finish: "concrete", sides: { w: EXT.part } });
  L.room("Tsuboniwa (light court)", 0, 4 * KEN, w, 5.5 * KEN, { kind: "site", finish: "stone" });
  L.room("Toriniwa (passage)", w, 4 * KEN, w + KEN, 5.5 * KEN, { building: link, finish: "concrete", open: "w" });
  L.room("Daidokoro (kitchen)", 0, 5.5 * KEN, w, 7.5 * KEN, { building: rear, level: up });
  const zashiki = L.room("Zashiki (main room)", 0, 7.5 * KEN, w, 9.5 * KEN, { building: rear, level: up });
  L.room("Hashiriniwa (kitchen floor)", w, 5.5 * KEN, w + KEN, 9.5 * KEN, { building: rear, finish: "concrete", sides: { w: EXT.part } });
  L.room("Engawa", 0, 9.5 * KEN, w, 10 * KEN, { kind: "covered", building: rear, level: up - 0.2 });
  L.posts(0, 10 * KEN, w, 10 * KEN, KEN, 0.42, rear);
  L.room("Oku-niwa (rear garden)", 0, 10 * KEN, w + KEN, 11 * KEN, { kind: "site", finish: "stone" });
  L.door(niwaFront, "s", 4, "sliding");
  L.window(mise, "s", 9, 0.5, 4.5, 2.5);
  L.door(zashiki, "n", 6, "sliding");
  return L.t;
}

function shoin() {
  const L = layout();
  const b = L.building("house", { name: "Shoin-style house", style: "hip-and-gable", ridge: "east-west", curve: 0.1, ext: EXT.timber, int: EXT.screen });
  const up = 1.5;
  const zashiki = L.room("Zashiki (8 mats, tokonoma)", 0, 0, 2 * KEN, 2 * KEN, { building: b, level: up });
  const tsugi = L.room("Tsugi-no-ma (next room)", 2 * KEN, 0, 4 * KEN, 2 * KEN, { building: b, level: up });
  L.room("Chanoma (family room)", 0, 2 * KEN, 2 * KEN, 3.5 * KEN, { building: b, level: up });
  L.room("Daidokoro (kitchen)", 2 * KEN, 2 * KEN, 4 * KEN, 3.5 * KEN, { building: b, level: up - 0.5, sides: { e: EXT.timber } });
  const genkan = L.room("Genkan (entry)", 4 * KEN, 2 * KEN, 5 * KEN, 3.5 * KEN, { building: b, level: 0, finish: "stone" });
  L.room("Engawa (south)", 0, -KEN, 4 * KEN, 0, { kind: "covered", building: b, level: up - 0.2 });
  L.room("Engawa (east)", 4 * KEN, -KEN, 5 * KEN, 2 * KEN, { kind: "covered", building: b, level: up - 0.2 });
  L.posts(0, -KEN, 5 * KEN, -KEN, KEN, 0.42, b);
  L.posts(5 * KEN, 0, 5 * KEN, 2 * KEN, KEN, 0.42, b);
  L.door(zashiki, "s", 9, "sliding");
  L.door(tsugi, "s", 9, "sliding");
  L.door(tsugi, "e", 9, "sliding");
  L.door(genkan, "e", 4, "sliding");
  return L.t;
}

/**
 * Katsura shoin group: Old Shoin, Middle Shoin, the Music Room, and the New
 * Palace step back from east to west like flying geese, each its own
 * irimoya roof, floors raised high on posts, verandas on the garden side,
 * and a bamboo moon-viewing platform off the Old Shoin toward the pond.
 * Mat counts from the sources where given (Old Shoin 15, 10, 9; New Palace
 * 8, 6, and a 3-mat raised dais); other room sizes are assumed.
 */
function katsura() {
  const L = layout();
  const roof = { style: "hip-and-gable", ridge: "east-west", curve: 0.08, pitch: 0.9, ext: EXT.timber, int: EXT.screen };
  const old = L.building("old", { ...roof, name: "Katsura Old Shoin (Koshoin)" });
  const middle = L.building("middle", { ...roof, name: "Katsura Middle Shoin (Chushoin)" });
  const music = L.building("music", { ...roof, name: "Katsura Music Room (Gakki-no-ma)" });
  const palace = L.building("palace", { ...roof, name: "Katsura New Palace (Shingoten)" });
  const K = KEN;
  const up = 4; // Assumed: the sources say the floors stand high on posts, not how high.
  // Old Shoin (east).
  const fifteen = L.room("Koshoin 15 mats", 12.5 * K, 0, 15.5 * K, 2.5 * K, { building: old, level: up });
  L.room("Koshoin 9 mats", 12.5 * K, 2.5 * K, 15.5 * K, 4 * K, { building: old, level: up });
  const ten = L.room("Koshoin 10 mats", 10 * K, 0, 12.5 * K, 2 * K, { building: old, level: up });
  L.room("Okoshiyose (entry)", 10 * K, 2 * K, 12.5 * K, 4 * K, { building: old, level: up });
  L.room("Hiro-en (south)", 10 * K, -K, 15.5 * K, 0, { kind: "covered", building: old, level: up - 0.2 });
  L.room("Hiro-en (east)", 15.5 * K, -K, 16.5 * K, 4 * K, { kind: "covered", building: old, level: up - 0.2 });
  L.room("Tsukimidai (moon platform)", 16.5 * K, 0.5 * K, 18.5 * K, 2.5 * K, { kind: "site", finish: "wood", level: up - 0.4 });
  // Middle Shoin, stepped back to the northwest.
  const mid = rowX(L, 4 * K, 2 * K, 2 * K, [["Chushoin san-no-ma", 2 * K], ["Chushoin ni-no-ma", 2 * K], ["Chushoin ichi-no-ma", 2 * K]], { building: middle, level: up });
  L.room("Chushoin bath and back rooms", 4 * K, 4 * K, 10 * K, 6 * K, { building: middle, level: up });
  L.room("Chushoin veranda", 4 * K, K, 10 * K, 2 * K, { kind: "covered", building: middle, level: up - 0.2 });
  // Music Room, the hinge to the New Palace.
  const gakki = L.room("Gakki-no-ma", 1.5 * K, 4 * K, 4 * K, 6.5 * K, { building: music, level: up });
  L.room("Gakki veranda", 1.5 * K, 3 * K, 4 * K, 4 * K, { kind: "covered", building: music, level: up - 0.2 });
  // New Palace (west), stepped back again.
  const ichi = L.room("Shingoten 8 mats", -0.5 * K, 5 * K, 1.5 * K, 7 * K, { building: palace, level: up });
  L.room("Jodan 3 mats", -0.5 * K, 7 * K, 1.5 * K, 7.75 * K, { building: palace, level: up + 0.4 });
  const ni = L.room("Shingoten 6 mats", -2.5 * K, 5 * K, -0.5 * K, 6.5 * K, { building: palace, level: up });
  L.room("Wardrobe, pantry", -2.5 * K, 6.5 * K, -0.5 * K, 7.75 * K, { building: palace, level: up });
  const bed = L.room("Bedchamber", -4.5 * K, 5 * K, -2.5 * K, 7.75 * K, { building: palace, level: up });
  L.room("Bath, toilet, washroom", -4.5 * K, 7.75 * K, 1.5 * K, 9 * K, { building: palace, level: up });
  L.room("Shingoten veranda", -4.5 * K, 4 * K, 1.5 * K, 5 * K, { kind: "covered", building: palace, level: up - 0.2 });
  L.door(fifteen, "s", 3 * K - 2, "sliding");
  L.door(fifteen, "e", 2 * K, "sliding", 0.4);
  L.door(ten, "s", 2 * K, "sliding");
  for (const room of mid) L.door(room, "s", 1.5 * K, "sliding");
  L.door(gakki, "s", 1.5 * K, "sliding");
  L.door(ichi, "s", 1.5 * K, "sliding");
  L.door(ni, "s", 1.5 * K, "sliding");
  L.door(bed, "s", 1.5 * K, "sliding");
  return L.t;
}

/**
 * Shugakuin, lower villa: Jugetsukan, a sukiya-style hall with shingled
 * irimoya roof. Ichi-no-ma of 15 mats with a 3-mat raised dais, ni-no-ma with
 * the mizuya behind its cedar doors, san-no-ma for attendants, and the 5-mat
 * room behind it whose window frames the view.
 */
function shugakuinLower() {
  const L = layout();
  const b = L.building("jugetsukan", { name: "Shugakuin Jugetsukan", style: "hip-and-gable", ridge: "east-west", curve: 0.05, pitch: 0.9, ext: EXT.timber, int: EXT.screen });
  const K = KEN;
  const up = 2.2; // Assumed.
  const ichi = L.room("Ichi-no-ma (12 mats)", 0, 0, 3 * K, 2 * K, { building: b, level: up });
  L.room("Jodan (3-mat dais)", 0, 2 * K, 3 * K, 2.5 * K, { building: b, level: up + 0.4 });
  const ni = L.room("Ni-no-ma", 3 * K, 0, 5.5 * K, 2 * K, { building: b, level: up });
  L.room("Mizuya", 3 * K, 2 * K, 5.5 * K, 2.5 * K, { building: b, level: up });
  const san = L.room("San-no-ma (attendants)", 5.5 * K, 0, 7.5 * K, 2 * K, { building: b, level: up });
  const five = L.room("5-mat room (view window)", 5.5 * K, 2 * K, 7.5 * K, 3.25 * K, { building: b, level: up });
  L.room("Veranda (south)", 0, -K, 7.5 * K, 0, { kind: "covered", building: b, level: up - 0.2 });
  L.room("Garden", 0, -4 * K, 7.5 * K, -K, { kind: "site", finish: "stone" });
  L.door(ichi, "s", 2.5 * K, "sliding");
  L.door(ni, "s", 2 * K, "sliding");
  L.door(san, "s", 1.5 * K, "sliding");
  L.window(five, "e", 3, 0.5, 3, 2);
  L.window(five, "n", 4, 0.5, 3, 2);
  return L.t;
}

/**
 * Shugakuin, upper villa: Rin'un-tei on the high ground (a 6-mat and a 2-mat
 * room open on three sides, and the board-floored Senshidai on the north),
 * and Kyusui-tei on the island (one 18-mat room under a pyramidal roof, with
 * a one-ken mizuya). The pond (Yokuryu-chi) lies between; the real distance
 * and the hill are much larger.
 */
function shugakuinUpper() {
  const L = layout();
  const K = KEN;
  const rin = L.building("rinun", { name: "Shugakuin Rin'un-tei", style: "hip-and-gable", ridge: "east-west", curve: 0.05, platform: 3, ext: EXT.screen, int: EXT.screen });
  const kyu = L.building("kyusui", { name: "Shugakuin Kyusui-tei", style: "hip", ridge: "east-west", curve: 0.05, ext: EXT.screen, int: EXT.screen });
  const mizu = L.building("mizuya", { name: "Kyusui-tei mizuya", style: "flush-gable", ridge: "north-south", curve: 0, ext: EXT.timber, int: EXT.part });
  const six = L.room("Rin'un-tei ichi-no-ma (6 mats)", 0, 6 * K, 2 * K, 7.5 * K, { building: rin, level: 4.5 });
  const two = L.room("Rin'un-tei ni-no-ma (2 mats)", 2 * K, 6 * K, 3 * K, 7 * K, { building: rin, level: 4.5 });
  const senshi = L.room("Senshidai (board floor, north)", 0, 7.5 * K, 3 * K, 8.5 * K, { building: rin, level: 4.5, finish: "wood" });
  L.room("Rin'un-tei back", 2 * K, 7 * K, 3 * K, 7.5 * K, { building: rin, level: 4.5 });
  L.room("Yokuryu-chi pond (shown flat)", -2 * K, 1.5 * K, 9 * K, 5 * K, { kind: "site", finish: "stone" });
  const hall = L.room("Kyusui-tei (18 mats, raised corner dais)", 4 * K, -2 * K, 7 * K, K, { building: kyu, level: 1.5 });
  L.room("Mizuya (1 ken)", 7 * K, -2 * K, 7.5 * K, 0, { building: mizu, level: 1.5 });
  L.door(six, "s", 1.5 * K, "sliding");
  L.door(six, "w", 1.25 * K, "sliding");
  L.door(two, "s", 4, "sliding");
  L.door(two, "e", 4, "sliding");
  L.door(senshi, "n", 2.5 * K, "cased");
  L.door(hall, "n", 2.5 * K, "sliding");
  L.door(hall, "w", 2.5 * K, "sliding");
  L.door(hall, "s", 2.5 * K, "sliding");
  return L.t;
}

/**
 * Shirakawa-go gassho house, after the room list of the Wada house (26.9 m by
 * 15.7 m, the largest in the village): the earth floor holds the entry and
 * the stable; the raised floor has the oe living room with its irori, the
 * kitchen, guest rooms, Buddhist altar room, and the chouda bedroom. The
 * roof is a gable of about 60 degrees; the attic above (up to three more
 * levels for silkworms) can't be drawn here. Room positions are approximate.
 */
function gassho() {
  const L = layout();
  const K = KEN;
  const b = L.building("gassho", { name: "Gassho-zukuri house", style: "gable", ridge: "east-west", curve: 0, pitch: Math.tan((60 * Math.PI) / 180), ext: EXT.timber, int: EXT.screen });
  const up = 1.5; // Assumed.
  const doji = L.room("Doji (earth-floor entry)", 0, 0, 3 * K, 3 * K, { building: b, level: 0, finish: "concrete", sides: { e: EXT.part } });
  const umaya = L.room("Umaya (stable, earth floor)", 0, 3 * K, 3 * K, 8.5 * K, { building: b, level: 0, finish: "concrete", sides: { e: EXT.part } });
  const oe = L.room("Oe (living room, irori)", 3 * K, 0, 7.5 * K, 4.5 * K, { building: b, level: up });
  L.room("Kitchen (raised floor)", 3 * K, 4.5 * K, 7.5 * K, 8.5 * K, { building: b, level: up });
  const genkan = L.room("Genkan (formal entrance)", 7.5 * K, 0, 9 * K, 4 * K, { building: b, level: up - 0.5 });
  L.room("Ennoma (anteroom)", 9 * K, 0, 11.5 * K, 4 * K, { building: b, level: up });
  const dei = L.room("Dei (guest room)", 11.5 * K, 0, 14.5 * K, 4 * K, { building: b, level: up });
  L.room("Chouda (bedroom)", 7.5 * K, 4 * K, 10 * K, 8.5 * K, { building: b, level: up });
  L.room("Butsuma (altar room)", 10 * K, 4 * K, 12.5 * K, 8.5 * K, { building: b, level: up });
  const oku = L.room("Okunodei (inner guest room)", 12.5 * K, 4 * K, 14.5 * K, 8.5 * K, { building: b, level: up });
  L.door(doji, "s", 5, "sliding");
  L.door(umaya, "w", 5, "cased");
  L.door(genkan, "s", 5, "sliding");
  L.window(oe, "s", 6);
  L.window(dei, "s", 6);
  L.window(oku, "e", 6);
  return L.t;
}

// ---------------------------------------------------------------- Korea

function hanokStraight() {
  const L = layout();
  const b = L.building("anchae", { name: "Hanok (ㅡ)", style: "hip-and-gable", ridge: "east-west", curve: 0.6, platform: 1.5, ext: EXT.timber, int: EXT.screen });
  const rooms = rowX(L, 0, 0, 1.5 * KAN, [
    ["Bueok (kitchen)", KAN, { level: 0.8, finish: "concrete", sides: { e: EXT.part } }],
    ["Anbang (ondol)", 2 * KAN],
    ["Daecheong maru", 2 * KAN],
    ["Geonneonbang (ondol)", KAN],
  ], { building: b, level: 2.5 });
  L.room("Toenmaru", KAN, -3, 6 * KAN, 0, { kind: "covered", building: b, level: 2.2 });
  L.posts(0, -3, 6 * KAN, -3, KAN, 0.8, b);
  L.door(rooms[0], "s", 3);
  L.door(rooms[1], "s", 3);
  L.window(rooms[1], "s", 3, 0.75);
  L.door(rooms[2], "s", 12, "cased");
  L.door(rooms[3], "s", 3);
  return L.t;
}

function hanokL() {
  const L = layout();
  const roof = { style: "hip-and-gable", curve: 0.6, platform: 1.5, ext: EXT.timber, int: EXT.screen };
  const main = L.building("anchae", { ...roof, name: "Hanok ㄱ main wing", ridge: "east-west" });
  const wing = L.building("wing", { ...roof, name: "Hanok ㄱ wing", ridge: "north-south" });
  const rooms = rowX(L, 0, 20, 12, [
    ["Bueok (kitchen)", KAN, { level: 0.8, finish: "concrete", sides: { e: EXT.part } }],
    ["Anbang (ondol)", 2 * KAN],
    ["Daecheong maru", 1.5 * KAN],
  ], { building: main, level: 2.5 });
  const wingRooms = rowY(L, 28, 0, 12, [["Sarangbang (ondol)", 1.5 * KAN], ["Geonneonbang (ondol)", KAN]], { building: wing, level: 2.5 });
  L.room("Toenmaru", KAN, 17, 28, 20, { kind: "covered", building: main, level: 2.2 });
  L.room("Toenmaru (wing)", 25, 0, 28, 17, { kind: "covered", building: wing, level: 2.2 });
  L.posts(KAN, 17, 25, 17, KAN, 0.8, main);
  L.posts(25, 0, 25, 17, KAN, 0.8, wing);
  L.room("Madang (yard)", 0, 0, 25, 17, { kind: "site", finish: "stone" });
  L.door(rooms[0], "s", 3);
  L.door(rooms[1], "s", 3);
  L.door(rooms[2], "s", 10, "cased");
  L.door(wingRooms[0], "w", 3);
  L.door(wingRooms[1], "w", 3);
  return L.t;
}

function hanokU() {
  const L = layout();
  const roof = { style: "hip-and-gable", curve: 0.6, platform: 1.5, ext: EXT.timber, int: EXT.screen };
  const north = L.building("north", { ...roof, name: "Hanok ㄷ north wing", ridge: "east-west" });
  const west = L.building("west", { ...roof, name: "Hanok ㄷ west wing", ridge: "north-south" });
  const east = L.building("east", { ...roof, name: "Hanok ㄷ east wing", ridge: "north-south" });
  const northRooms = rowX(L, 0, 28, 12, [["Anbang (ondol)", 2 * KAN], ["Daecheong maru", 2 * KAN], ["Geonneonbang (ondol)", 2 * KAN]], { building: north, level: 2.5 });
  const westRooms = rowY(L, 0, 4, 12, [["Gwang (storage)", 1.5 * KAN, { level: 1, finish: "concrete" }], ["Bueok (kitchen)", 1.5 * KAN, { level: 0.8, finish: "concrete" }]], { building: west, level: 2.5 });
  const eastRooms = rowY(L, 36, 4, 12, [["Room (ondol)", 1.5 * KAN], ["Sarangbang (ondol)", 1.5 * KAN]], { building: east, level: 2.5 });
  L.room("Toenmaru", 12, 25, 36, 28, { kind: "covered", building: north, level: 2.2 });
  L.posts(12, 25, 36, 25, KAN, 0.8, north);
  L.room("Madang (yard)", 12, 4, 36, 25, { kind: "site", finish: "stone" });
  L.door(northRooms[0], "s", 3, "swing", 0.8);
  L.door(northRooms[1], "s", 12, "cased");
  L.door(northRooms[2], "s", 3, "swing", 0.2);
  L.door(westRooms[0], "e", 3);
  L.door(westRooms[1], "e", 4);
  L.door(eastRooms[0], "w", 3);
  L.door(eastRooms[1], "w", 3);
  return L.t;
}

/**
 * Hyangdan, Yangdong village (Gyeongju), built about 1540. A 9-kan
 * haengnangchae (servants' wing) and a 日-shaped main body around two small
 * inner yards: the anbang and andaecheong sit between the yards; the kitchen,
 * storerooms, and shed wrap the west yard, which worked like an open-air
 * kitchen; the sarangchae (big sarang, sarang daecheong, small sarang, north
 * to south) faces east past the east yard. Single-eave gable roofs. Wing
 * depths and the rooms of the north side are approximated; the sources give
 * the arrangement, not a measured plan.
 */
function hyangdan() {
  const L = layout();
  const roof = { style: "gable", curve: 0.35, ext: EXT.timber, int: EXT.screen };
  const K = KAN;
  const haeng = L.building("haengnang", { ...roof, name: "Hyangdan haengnangchae", ridge: "east-west", platform: 1 });
  const north = L.building("north", { ...roof, name: "Hyangdan north wing", ridge: "east-west", platform: 2 });
  const west = L.building("west", { ...roof, name: "Hyangdan west wing (kitchen side)", ridge: "north-south", platform: 2 });
  const anchae = L.building("anchae", { ...roof, name: "Hyangdan anchae (between the yards)", ridge: "north-south", platform: 2 });
  const sarang = L.building("sarang", { ...roof, name: "Hyangdan sarangchae", ridge: "north-south", platform: 2.5 });
  // Haengnangchae, 9 kan, east to west: ondol room, middle gate, maru, ondol room, storeroom, stable.
  const row = rowX(L, 0, 0, K, [
    ["Magugan (stable)", 2 * K, { level: 1, finish: "concrete" }],
    ["Gotgan (storeroom)", 2 * K, { level: 1, finish: "concrete" }],
    ["Haengnang ondol room", K],
    ["Haengnang maru", 2 * K],
    ["Jungmun (middle gate)", K, { level: 1, finish: "stone" }],
    ["Haengnang ondol room (east)", K],
  ], { building: haeng, level: 1.5 });
  // West wing around the west yard (haengnang madang).
  const westRooms = rowY(L, 0, K, K, [
    ["Bueok (kitchen)", K, { level: 2, finish: "concrete" }],
    ["Gobang (storeroom)", K],
    ["Gwang (storage)", K, { level: 2, finish: "concrete" }],
  ], { building: west, level: 2.5 });
  L.room("West yard (haengnang madang)", K, K, 3 * K, 4 * K, { kind: "site", finish: "stone" });
  // Between the yards: anbang, andaecheong, geonneonbang.
  const anbang = L.room("Anbang (ondol)", 3 * K, K, 5 * K, 2 * K, { building: anchae, level: 2.5 });
  const daecheong = L.room("Andaecheong (wood floor)", 3 * K, 2 * K, 5 * K, 4 * K, { building: anchae, level: 2.5 });
  L.room("East yard (an madang)", 5 * K, K, 7 * K, 4 * K, { kind: "site", finish: "stone" });
  // North side, closing the 日.
  rowX(L, 0, 4 * K, K, [
    ["Heotgan (shed)", 3 * K, { level: 2, finish: "concrete" }],
    ["Geonneonbang (ondol)", 2 * K],
    ["North room", 2 * K],
  ], { building: north, level: 2.5 });
  // Sarangchae on the east, facing east: small sarang (south), sarang daecheong, big sarang (north).
  const sarangRooms = rowY(L, 7 * K, K, 2 * K, [
    ["Jageun sarang (small sarang)", K],
    ["Sarang daecheong", 2 * K],
    ["Keun sarang (big sarang)", 2 * K],
  ], { building: sarang, level: 3 });
  L.room("Sarang madang (east yard)", 9 * K, 0, 12 * K, 5 * K, { kind: "site", finish: "stone" });
  L.door(row[4], "s", 5);
  L.door(row[4], "n", 5, "cased");
  L.door(row[0], "s", 5, "cased");
  L.door(westRooms[0], "e", 3);
  L.door(westRooms[1], "e", 3);
  L.door(anbang, "w", 3);
  L.door(daecheong, "e", 12, "cased");
  for (const room of sarangRooms) L.door(room, "e", room === sarangRooms[1] ? 10 : 3, room === sarangRooms[1] ? "cased" : "swing");
  return L.t;
}

function hanokSquare() {
  const L = layout();
  const roof = { style: "hip-and-gable", curve: 0.6, platform: 1.5, ext: EXT.timber, int: EXT.screen };
  const north = L.building("north", { ...roof, name: "Hanok ㅁ north wing (anchae)", ridge: "east-west" });
  const west = L.building("west", { ...roof, name: "Hanok ㅁ west wing", ridge: "north-south" });
  const east = L.building("east", { ...roof, name: "Hanok ㅁ east wing", ridge: "north-south" });
  const south = L.building("south", { ...roof, name: "Hanok ㅁ gate wing (haengnangchae)", ridge: "east-west", platform: 1 });
  const northRooms = rowX(L, 0, 36, 12, [["Anbang (ondol)", 2 * KAN], ["Daecheong maru", 2 * KAN], ["Geonneonbang (ondol)", 2 * KAN]], { building: north, level: 2.5 });
  const westRooms = rowY(L, 0, 12, 12, [["Gwang (storage)", 1.5 * KAN, { level: 1, finish: "concrete" }], ["Bueok (kitchen)", 1.5 * KAN, { level: 0.8, finish: "concrete" }]], { building: west, level: 2.5 });
  const eastRooms = rowY(L, 36, 12, 12, [["Room (ondol)", 1.5 * KAN], ["Sarangbang (ondol)", 1.5 * KAN]], { building: east, level: 2.5 });
  const southRooms = rowX(L, 0, 0, 12, [["Haengnang room", 2 * KAN], ["Daemun (gate)", KAN, { level: 1, finish: "stone" }], ["Haengnang room", 3 * KAN]], { building: south, level: 2 });
  L.room("Madang (courtyard)", 12, 12, 36, 36, { kind: "site", finish: "stone" });
  L.door(northRooms[0], "s", 3);
  L.door(northRooms[1], "s", 12, "cased");
  L.door(northRooms[2], "s", 3);
  L.door(westRooms[0], "e", 3);
  L.door(westRooms[1], "e", 4);
  L.door(eastRooms[0], "w", 3);
  L.door(eastRooms[1], "w", 3);
  L.door(southRooms[1], "s", 5);
  L.door(southRooms[1], "n", 5, "cased");
  L.door(southRooms[0], "n", 3);
  L.door(southRooms[2], "n", 3, "swing", 0.25);
  return L.t;
}

export const TEMPLATES = [
  {
    id: "cn-three-bay", group: "China", name: "Three-bay hall", make: threeBayHall,
    about: "The basic Chinese house: three jian, the middle one the family hall, on a raised platform with a column-lined front gallery. Brick side and back walls, a timber lattice front, a flush gable roof.",
    sources: ["uw", "knapp", "qing"],
  },
  {
    id: "cn-five-bay", group: "China", name: "Five-bay hall", make: fiveBayHall,
    about: "A larger hall of five bays (odd numbers keep the middle on the axis), the central bay widest, on a higher platform with a hip-and-gable roof and a deeper gallery.",
    sources: ["uw", "liang", "roofs"],
  },
  {
    id: "cn-siheyuan", group: "China", name: "Siheyuan (four-sided courtyard)", make: siheyuan,
    about: "North-facing-south compound on the north-south axis: main hall with ear rooms at the back, east and west wings, a south house, a gate in the southeast corner facing a gable wall so visitors turn into the courtyard. No outside windows.",
    sources: ["uw", "siheyuan", "qing"],
  },
  {
    id: "cn-sanheyuan", group: "China", name: "Sanheyuan (three-sided courtyard)", make: sanheyuan,
    about: "Main hall and two wings around a courtyard, closed on the south by a wall with a gate on the axis.",
    sources: ["uw", "liang"],
  },
  {
    id: "cn-skywell", group: "China", name: "Southern skywell house", make: skywellHouse,
    about: "Compact southern house (Huizhou type): a three-bay hall opening onto a small skywell (tianjing), side rooms each side, high blank outer walls.",
    sources: ["hui", "uw"],
  },
  {
    id: "jp-minka", group: "Japan", name: "Minka farmhouse (four rooms, stable, work doma)", make: minka,
    about: "Farmhouse on the ken grid where living and farm work share one roof: an earth-floored doma for the entry, cooking at the kamado and sink, and indoor farm work; food, tool, and fuel storage; and an inside stable (umaya). Four raised rooms in a 田 plan, the dining room open to the doma, divided by paper screens, with an engawa under the eaves. Steep hipped roof for thatch. Room sizes are typical, not one measured house.",
    sources: ["minka", "jaanus", "doma", "umaya", "folkoDoma", "ken"],
  },
  {
    id: "jp-machiya", group: "Japan", name: "Machiya townhouse", make: machiya,
    about: "Kyoto 'eel bed': 3 ken wide and about 11 deep, shop at the street, an earth-floored passage (toriniwa) down one side, a small light court (tsuboniwa), the main room on a rear garden.",
    sources: ["machiya", "ken"],
  },
  {
    id: "jp-katsura", group: "Japan", name: "Katsura shoin group (stepped like flying geese)", make: katsura,
    about: "Katsura Imperial Villa, Kyoto, 17th century: the Old Shoin, Middle Shoin, Music Room, and New Palace run east to west in a stepped 'flying geese' line, each under its own shingled irimoya roof, floors raised high on posts above the flood-prone ground, verandas facing the garden, and the bamboo moon-viewing platform off the Old Shoin toward the pond. Mat counts follow the sources where they give them (Old Shoin 15, 10, 9; New Palace 8, 6, and a 3-mat dais); the 4 ft floor height, the Middle Shoin rooms, the entry, and the New Palace's private rooms are sized by assumption.",
    sources: ["katsuraKikuyo", "katsuraWiki", "katsuraBrit", "kunaicho", "ken"],
  },
  {
    id: "jp-shugakuin-lower", group: "Japan", name: "Shugakuin Jugetsukan (lower villa)", make: shugakuinLower,
    about: "Shugakuin Imperial Villa, Kyoto, 17th century, rebuilt to the old plan in the 1820s: a sukiya hall with a shingled irimoya roof. Ichi-no-ma of 15 mats including a 3-mat dais, ni-no-ma with the mizuya behind cedar doors, san-no-ma for attendants, and a 5-mat room whose window frames the view across the fields to Mt Hiei and the hills (borrowed scenery). Room sizes not given in the source are assumed.",
    sources: ["shugakuin", "shugakuinIha", "ken"],
  },
  {
    id: "jp-shugakuin-upper", group: "Japan", name: "Shugakuin upper villa teahouses", make: shugakuinUpper,
    about: "The upper villa's two teahouses across the Yokuryu-chi pond: Rin'un-tei high on the hill (a 6-mat and a 2-mat room that open on three sides to the pond, the north hills, and the city, plus the board-floored Senshidai), and Kyusui-tei on the island (one 18-mat room with a raised corner, under a pyramidal roof, with a one-ken mizuya). Drawn close together; really they sit far apart on a hillside.",
    sources: ["shugakuin", "shugakuinIha", "ken"],
  },
  {
    id: "jp-gassho", group: "Japan", name: "Shirakawa-go gassho house", make: gassho,
    about: "Shirakawa-go farmhouse after the Wada house's rooms: an earth floor holding the entry and stable, and a raised floor with the oe living room around the irori, the kitchen, guest rooms, Buddhist altar room, and bedroom. A thatched gable roof of about 60 degrees, steep for snow, built by the villagers; inside it, up to three attic levels were used for raising silkworms, warmed by the hearth smoke (not drawn: the app has one floor). Positions approximate.",
    sources: ["gasshoPlan", "gasshoUnesco", "gasshoRoof", "gasshoMlit", "ken"],
  },
  {
    id: "jp-shoin", group: "Japan", name: "Shoin house with engawa", make: shoin,
    about: "Formal tatami rooms opening to the garden through sliding doors, an engawa wrapping two sides, a genkan entry, hip-and-gable (irimoya) roof.",
    sources: ["minka", "ken"],
  },
  {
    id: "kr-straight", group: "Korea", name: "Hanok ㅡ (straight)", make: hanokStraight,
    about: "One row of kan: kitchen (bueok) at grade, then the ondol main room, the open wooden daecheong maru, and a second ondol room, on a stone platform with a toenmaru along the front. Curved hip-and-gable (paljak) roof.",
    sources: ["hanok", "kan"],
  },
  {
    id: "kr-l", group: "Korea", name: "Hanok ㄱ (L-shaped)", make: hanokL,
    about: "Southern open plan: the maru at the turn of the L beside the kitchen, rooms facing the yard (madang).",
    sources: ["hanokShapes", "hanok", "kan"],
  },
  {
    id: "kr-u", group: "Korea", name: "Hanok ㄷ (U-shaped)", make: hanokU,
    about: "Three wings around the yard: ondol rooms and the daecheong to the north, kitchen and storage on one wing, the men's sarangbang on the other.",
    sources: ["hanokShapes", "hanok", "kan"],
  },
  {
    id: "kr-hyangdan", group: "Korea", name: "Hyangdan (Yangdong village)", make: hyangdan,
    about: "Hyangdan, Yangdong village, Gyeongju, about 1540: a 9-kan servants' wing and a 日-shaped main body packed around two small inner yards instead of the usual separate halls. The anbang and andaecheong sit between the yards; kitchen, storerooms, and shed wrap the west yard, used like an open-air kitchen; the sarangchae faces east. Single-eave gable roofs. The arrangement follows the encyclopedia entry; wing depths and some room uses are approximated.",
    sources: ["hyangdan", "hyangdanKan", "kan"],
  },
  {
    id: "kr-square", group: "Korea", name: "Hanok ㅁ (enclosed)", make: hanokSquare,
    about: "Northern closed plan: four wings around a square courtyard, the gate through the south wing.",
    sources: ["hanokShapes", "hanok", "kan"],
  },
];

export function templateById(id) {
  return TEMPLATES.find((item) => item.id === id) || null;
}

// ---------------------------------------------------------------- geometry

const EPS = 0.01;
const near = (a, b) => Math.abs(a - b) < EPS;

/** Walls from the rooms: split where anything meets, owners counted, assemblies chosen. */
function wallSegments(t) {
  const lines = new Map();
  const add = (orient, c, a, b, owner) => {
    const key = `${orient}:${Math.round(c * 1000) / 1000}`;
    if (!lines.has(key)) lines.set(key, { orient, c, spans: [] });
    lines.get(key).spans.push({ a: Math.min(a, b), b: Math.max(a, b), owner });
  };
  t.rooms.forEach((room, index) => {
    if (!room.walls) return;
    const { x0, y0, x1, y1 } = room.rect;
    const side = (s) => ({ room: index, side: s });
    if (!room.open.includes("s")) add("h", y0, x0, x1, side("s"));
    if (!room.open.includes("n")) add("h", y1, x0, x1, side("n"));
    if (!room.open.includes("w")) add("v", x0, y0, y1, side("w"));
    if (!room.open.includes("e")) add("v", x1, y0, y1, side("e"));
  });
  for (const wall of t.extra) {
    if (near(wall.a.y, wall.b.y)) add("h", wall.a.y, wall.a.x, wall.b.x, { extra: wall.assemblyId });
    else add("v", wall.a.x, wall.a.y, wall.b.y, { extra: wall.assemblyId });
  }
  // Every end point, so a wall is cut where another one meets it.
  const ends = [];
  for (const line of lines.values()) {
    for (const span of line.spans) {
      ends.push(line.orient === "h" ? { x: span.a, y: line.c } : { x: line.c, y: span.a });
      ends.push(line.orient === "h" ? { x: span.b, y: line.c } : { x: line.c, y: span.b });
    }
  }
  const segments = [];
  for (const line of lines.values()) {
    const cuts = new Set();
    for (const span of line.spans) {
      cuts.add(span.a);
      cuts.add(span.b);
    }
    for (const point of ends) {
      const along = line.orient === "h" ? point.x : point.y;
      const across = line.orient === "h" ? point.y : point.x;
      if (near(across, line.c)) cuts.add(along);
    }
    const stops = [...cuts].sort((a, b) => a - b);
    const pieces = [];
    for (let i = 0; i + 1 < stops.length; i += 1) {
      const a = stops[i];
      const b = stops[i + 1];
      if (b - a < EPS) continue;
      const mid = (a + b) / 2;
      const owners = line.spans.filter((span) => span.a - EPS <= mid && span.b + EPS >= mid).map((span) => span.owner);
      if (!owners.length) continue;
      pieces.push({ a, b, assemblyId: pickAssembly(t, owners) });
    }
    // Join neighbours with the same wall type where no other wall meets them.
    const merged = [];
    for (const piece of pieces) {
      const last = merged.at(-1);
      if (last && near(last.b, piece.a) && last.assemblyId === piece.assemblyId && !crossAt(lines, line, piece.a)) last.b = piece.b;
      else merged.push({ ...piece });
    }
    for (const piece of merged) {
      segments.push(line.orient === "h"
        ? { start: { x: piece.a, y: line.c }, end: { x: piece.b, y: line.c }, assemblyId: piece.assemblyId }
        : { start: { x: line.c, y: piece.a }, end: { x: line.c, y: piece.b }, assemblyId: piece.assemblyId });
    }
  }
  return segments;
}

/** True when a wall on the other axis ends or passes at this point of the line. */
function crossAt(lines, line, along) {
  for (const other of lines.values()) {
    if (other.orient === line.orient) continue;
    if (!near(other.c, along)) continue;
    if (other.spans.some((span) => span.a - EPS <= line.c && span.b + EPS >= line.c)) return true;
  }
  return false;
}

function pickAssembly(t, owners) {
  const extra = owners.find((owner) => owner.extra);
  if (extra) return extra.extra;
  const rooms = owners.filter((owner) => Number.isInteger(owner.room));
  for (const owner of rooms) {
    const room = t.rooms[owner.room];
    if (room.sides[owner.side]) return room.sides[owner.side];
  }
  const first = t.rooms[rooms[0].room];
  const spec = t.buildings[first.building] || {};
  if (rooms.length >= 2) {
    const same = rooms.every((owner) => t.rooms[owner.room].building === first.building);
    return same ? (spec.int || EXT.part) : (spec.ext || EXT.timber);
  }
  return spec.ext || EXT.timber;
}

function thicknessOf(assemblyId) {
  return assemblyById[assemblyId]?.thickness || 0.5;
}

/** Inset a centerline rectangle to the inner faces of the walls along it. */
function innerPolygon(rect, segments) {
  const along = (orient, c, a, b) => {
    let half = 0;
    for (const seg of segments) {
      const horizontal = near(seg.start.y, seg.end.y);
      if ((orient === "h") !== horizontal) continue;
      const line = horizontal ? seg.start.y : seg.start.x;
      if (!near(line, c)) continue;
      const s0 = Math.min(horizontal ? seg.start.x : seg.start.y, horizontal ? seg.end.x : seg.end.y);
      const s1 = Math.max(horizontal ? seg.start.x : seg.start.y, horizontal ? seg.end.x : seg.end.y);
      if (s1 - EPS <= a || s0 + EPS >= b) continue;
      half = Math.max(half, thicknessOf(seg.assemblyId) / 2);
    }
    return half;
  };
  const s = along("h", rect.y0, rect.x0, rect.x1);
  const n = along("h", rect.y1, rect.x0, rect.x1);
  const w = along("v", rect.x0, rect.y0, rect.y1);
  const e = along("v", rect.x1, rect.y0, rect.y1);
  return [
    { x: rect.x0 + w, y: rect.y0 + s },
    { x: rect.x1 - e, y: rect.y0 + s },
    { x: rect.x1 - e, y: rect.y1 - n },
    { x: rect.x0 + w, y: rect.y1 - n },
  ];
}

const geometryCache = new Map();

/**
 * A template in its own frame, centred on the middle of everything it draws:
 * { walls: [{start, end, assemblyId, thickness}], rooms, openings: [{wall index,
 * offset, ...}], columns, buildings, box, warnings }.
 */
export function templateGeometry(template) {
  if (geometryCache.has(template.id)) return geometryCache.get(template.id);
  const t = template.make();
  const segments = wallSegments(t);
  const rooms = t.rooms.map((room) => ({
    name: room.name,
    kind: room.kind,
    building: room.building,
    level: room.level,
    finish: room.finish,
    polygon: innerPolygon(room.rect, segments),
  }));
  const warnings = [];
  const openings = [];
  for (const item of t.openings) {
    const index = segments.findIndex((seg) => {
      const horizontal = near(seg.start.y, seg.end.y);
      if (horizontal ? !near(item.point.y, seg.start.y) : !near(item.point.x, seg.start.x)) return false;
      const s0 = Math.min(horizontal ? seg.start.x : seg.start.y, horizontal ? seg.end.x : seg.end.y);
      const s1 = Math.max(horizontal ? seg.start.x : seg.start.y, horizontal ? seg.end.x : seg.end.y);
      const at = horizontal ? item.point.x : item.point.y;
      return at > s0 + EPS && at < s1 - EPS;
    });
    if (index < 0) {
      warnings.push(`No wall for a ${item.type} at ${item.point.x}, ${item.point.y}.`);
      continue;
    }
    const seg = segments[index];
    const length = Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y);
    const along = Math.hypot(item.point.x - seg.start.x, item.point.y - seg.start.y);
    const width = Math.min(item.width, Math.max(1, length - 1));
    const offset = Math.max(0.5, Math.min(length - width - 0.5, along - width / 2));
    openings.push({ wall: index, offset, width, height: item.height, sill: item.sill, type: item.type, style: item.style });
  }
  const points = [];
  for (const seg of segments) points.push(seg.start, seg.end);
  for (const room of rooms) points.push(...room.polygon);
  for (const column of t.columns) points.push(column);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const shift = (p) => ({ x: p.x - cx, y: p.y - cy });
  const geometry = {
    walls: segments.map((seg) => ({ start: shift(seg.start), end: shift(seg.end), assemblyId: seg.assemblyId, thickness: thicknessOf(seg.assemblyId) })),
    rooms: rooms.map((room) => ({ ...room, polygon: room.polygon.map(shift) })),
    openings,
    columns: t.columns.map((column) => ({ ...column, ...shift(column) })),
    buildings: t.buildings,
    box: { x0: Math.min(...xs) - cx, y0: Math.min(...ys) - cy, x1: Math.max(...xs) - cx, y1: Math.max(...ys) - cy },
    warnings,
  };
  geometryCache.set(template.id, geometry);
  return geometry;
}

/** Turn a point a number of quarter turns counter-clockwise about the origin, then move it to `at`. */
function placePoint(p, at, turns) {
  let x = p.x;
  let y = p.y;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) [x, y] = [-y, x];
  return { x: Math.round((x + at.x) * 1000) / 1000, y: Math.round((y + at.y) * 1000) / 1000 };
}

/** What the ghost draws: the template turned and moved to `at`. */
export function templateGhost(template, at, turns = 0) {
  const g = templateGeometry(template);
  const corners = [
    placePoint({ x: g.box.x0, y: g.box.y0 }, at, turns),
    placePoint({ x: g.box.x1, y: g.box.y1 }, at, turns),
  ];
  return {
    walls: g.walls.map((wall) => ({ start: placePoint(wall.start, at, turns), end: placePoint(wall.end, at, turns), thickness: wall.thickness })),
    rooms: g.rooms.map((room) => ({ kind: room.kind, polygon: room.polygon.map((p) => placePoint(p, at, turns)) })),
    columns: g.columns.map((column) => ({ ...placePoint(column, at, turns), size: column.size })),
    box: {
      x0: Math.min(corners[0].x, corners[1].x),
      y0: Math.min(corners[0].y, corners[1].y),
      x1: Math.max(corners[0].x, corners[1].x),
      y1: Math.max(corners[0].y, corners[1].y),
    },
  };
}

/** Walls or roofed rooms already in the house that the template would land on. */
export function templateClashes(house, ghost) {
  const box = ghost.box;
  const inBox = (p) => p.x > box.x0 + 0.5 && p.x < box.x1 - 0.5 && p.y > box.y0 + 0.5 && p.y < box.y1 - 0.5;
  const clashes = [];
  for (const wall of house.walls || []) {
    const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
    if (inBox(wall.start) || inBox(wall.end) || inBox(mid)) clashes.push({ type: "wall", id: wall.id });
  }
  return clashes;
}

/**
 * Put a template into the house at `at`, turned `turns` quarter turns
 * counter-clockwise. Returns { house, picks, warnings }. The new buildings get
 * fresh names, so each copy has its own roofs.
 */
export function placeTemplate(house, template, at, turns = 0, makeId = nextId) {
  const g = templateGeometry(template);
  const next = JSON.parse(JSON.stringify(house));
  withJoins(next);
  const level = next.levels?.[0]?.id || "main";
  const height = next.levels?.[0]?.plateHeight || next.roof?.plateHeight || 10;
  const odd = ((turns % 2) + 2) % 2 === 1;
  const buildingIds = {};
  next.buildings = { ...(next.buildings || {}) };
  for (const [key, spec] of Object.entries(g.buildings)) {
    const id = makeId("building");
    buildingIds[key] = id;
    const ridge = spec.ridge && spec.ridge !== "auto" && odd
      ? (spec.ridge === "north-south" ? "east-west" : "north-south")
      : spec.ridge;
    const entry = { name: spec.name, template: template.id };
    if (spec.style) entry.style = spec.style;
    if (ridge) entry.ridge = ridge;
    if (Number.isFinite(spec.curve)) entry.curve = spec.curve;
    if (spec.platform) entry.platform = spec.platform;
    if (spec.pitch) entry.pitch = spec.pitch;
    next.buildings[id] = entry;
  }
  const picks = [];
  const wallIds = g.walls.map((wall) => {
    const made = applyAssembly({
      id: makeId("wall"),
      levelId: level,
      start: placePoint(wall.start, at, turns),
      end: placePoint(wall.end, at, turns),
      height,
      phase: "phase1",
      assembly: "framed",
      thickness: 0.5,
      role: "interior",
    }, wall.assemblyId);
    next.walls.push(made);
    picks.push({ type: "wall", id: made.id });
    return made.id;
  });
  // Walls that meet end to end move as one, like a drawn room's corners.
  for (const id of wallIds) {
    const wall = next.walls.find((item) => item.id === id);
    for (const end of ["start", "end"]) {
      const touching = endsAt(next, wall[end]).filter((ref) => wallIds.includes(ref.wall));
      if (touching.length > 1) clipTogether(next, touching);
    }
  }
  for (const item of g.openings) {
    const opening = {
      id: makeId(item.type),
      wallId: wallIds[item.wall],
      type: item.type,
      offset: Math.round(item.offset * 1000) / 1000,
      width: item.width,
      height: item.height,
      sill: item.sill,
      header: headerForSpan(item.width),
    };
    if (item.type === "door") {
      opening.style = item.style || "swing";
      opening.hinge = "start";
      opening.swingSide = "left";
    }
    next.openings.push(opening);
  }
  const mine = new Set();
  for (const room of g.rooms) {
    const id = makeId("room");
    mine.add(id);
    const made = {
      id,
      levelId: level,
      name: room.name,
      phase: "phase1",
      polygon: room.polygon.map((p) => placePoint(p, at, turns)),
      finish: room.finish,
      conditioned: room.kind === "heated",
    };
    if (room.kind !== "heated") made.areaKind = room.kind;
    if (room.building) made.building = buildingIds[room.building];
    if (room.level > 0) made.floorLevel = room.level;
    next.rooms.push(made);
    picks.push({ type: "room", id });
  }
  next.columns = [...(next.columns || [])];
  for (const column of g.columns) {
    const made = { id: makeId("column"), ...placePoint(column, at, turns), size: column.size || 0.75, shape: "round", phase: "phase1" };
    if (column.building) made.building = buildingIds[column.building];
    next.columns.push(made);
    picks.push({ type: "column", id: made.id });
  }
  // Let the plan's own room finder see the new walls; a closed space the
  // template did not name (a corner between buildings) becomes a yard.
  const before = new Set(next.rooms.map((room) => room.id));
  let synced = syncRooms(next, detectFaces(next.walls));
  const box = templateGhost(template, at, turns).box;
  synced = {
    ...synced,
    rooms: synced.rooms.map((room) => {
      if (before.has(room.id)) return room;
      const centre = room.polygon.reduce((acc, p) => ({ x: acc.x + p.x / room.polygon.length, y: acc.y + p.y / room.polygon.length }), { x: 0, y: 0 });
      if (centre.x < box.x0 || centre.x > box.x1 || centre.y < box.y0 || centre.y > box.y1) return room;
      return { ...room, name: "Yard", areaKind: "site", conditioned: false, finish: "stone" };
    }),
  };
  for (const room of synced.rooms) {
    if (!before.has(room.id) && room.areaKind === "site") picks.push({ type: "room", id: room.id });
  }
  return { house: synced, picks, warnings: g.warnings };
}
