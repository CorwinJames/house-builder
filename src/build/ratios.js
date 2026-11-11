import libraryFile from "../../data/ratios.json" with { type: "json" };

export const ratioLibrary = libraryFile.ratios;

/** Plastic constant: the real root of x³ − x − 1 = 0. */
export function plasticConstant() {
  let x = 1.3;
  for (let i = 0; i < 30; i += 1) {
    const value = x * x * x - x - 1;
    const slope = 3 * x * x - 1;
    x -= value / slope;
  }
  return x;
}

/** Evaluate a restricted arithmetic expression: numbers, sqrt(), + - * / and parentheses. */
export function evaluateExact(expression) {
  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index];
  const take = (kind) => {
    const token = tokens[index];
    if (!token || (kind && token.kind !== kind)) {
      throw new Error(`Bad ratio expression: ${expression}`);
    }
    index += 1;
    return token;
  };
  function parseExpression() {
    let value = parseTerm();
    while (peek() && (peek().kind === "+" || peek().kind === "-")) {
      const op = take().kind;
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    while (peek() && (peek().kind === "*" || peek().kind === "/")) {
      const op = take().kind;
      const right = parseFactor();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }
  function parseFactor() {
    const token = peek();
    if (!token) throw new Error(`Bad ratio expression: ${expression}`);
    if (token.kind === "number") return take().value;
    if (token.kind === "-") {
      take();
      return -parseFactor();
    }
    if (token.kind === "(") {
      take("(");
      const value = parseExpression();
      take(")");
      return value;
    }
    if (token.kind === "sqrt") {
      take("sqrt");
      take("(");
      const value = parseExpression();
      take(")");
      return Math.sqrt(value);
    }
    throw new Error(`Bad ratio expression: ${expression}`);
  }
  const value = parseExpression();
  if (peek()) throw new Error(`Bad ratio expression: ${expression}`);
  return value;
}

function tokenize(expression) {
  const tokens = [];
  let i = 0;
  while (i < expression.length) {
    const char = expression[i];
    if (char === " " || char === "\t") {
      i += 1;
      continue;
    }
    if ("+-*/()".includes(char)) {
      tokens.push({ kind: char });
      i += 1;
      continue;
    }
    if (expression.startsWith("sqrt", i)) {
      tokens.push({ kind: "sqrt" });
      i += 4;
      continue;
    }
    const match = expression.slice(i).match(/^\d+(\.\d+)?/);
    if (match) {
      tokens.push({ kind: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    throw new Error(`Bad ratio expression: ${expression}`);
  }
  return tokens;
}

export function ratioValue(ratio) {
  if (!ratio) return null;
  if (ratio.exact) return evaluateExact(ratio.exact);
  if (ratio.compute === "plastic") return plasticConstant();
  return ratio.value;
}

export function allRatios(custom = []) {
  return [...ratioLibrary, ...custom];
}

export function findRatio(id, custom = []) {
  return allRatios(custom).find((ratio) => ratio.id === id) || null;
}

/**
 * Nearest named ratio for a long-side / short-side number (at least 1).
 * Deviation is (actual − target) / target.
 */
export function nearestRatio(aspect, custom = []) {
  const value = aspect >= 1 ? aspect : 1 / aspect;
  let best = null;
  for (const ratio of allRatios(custom)) {
    const raw = ratioValue(ratio);
    if (!raw || raw <= 0) continue;
    const target = raw >= 1 ? raw : 1 / raw;
    const deviation = (value - target) / target;
    if (!best || Math.abs(deviation) < Math.abs(best.deviation)) {
      best = { ratio, target, deviation, aspect: value };
    }
  }
  const exact = best && Math.abs(best.deviation) < 0.0005;
  return { ...best, exact };
}

export function proportionPhrase(match) {
  if (!match?.ratio) return "";
  const shown = match.aspect.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (match.exact) return `${shown} · ${match.ratio.name} · exact`;
  const percent = match.deviation * 100;
  const sign = percent > 0 ? "+" : "−";
  return `${shown} · ~${match.ratio.name} · ${sign}${Math.abs(percent).toFixed(1)}%`;
}

function symbolPower(symbol, power) {
  if (power === 0) return "1";
  if (power === 1) return symbol;
  if (power === -1) return `1/${symbol}`;
  const exp = power < 0 ? `⁻${"⁰¹²³⁴⁵⁶⁷⁸⁹"[-power] || -power}` : `${"⁰¹²³⁴⁵⁶⁷⁸⁹"[power] || power}`;
  return `${symbol}${exp}`;
}

/**
 * Lengths the ratio tool can snap to: module × ratioⁿ, sums of two of those,
 * and the same family taken from existing wall lengths.
 */
export function ratioSeries(module, ratio, otherLengths = [], symbol = "φ") {
  const value = ratioValue(ratio);
  const marks = [];
  const seen = [];
  const add = (length, label) => {
    if (!(length > 0.4) || length > 240) return;
    if (seen.some((item) => Math.abs(item - length) < 1 / 192)) return;
    seen.push(length);
    marks.push({ length, label });
  };
  const powers = [];
  for (let n = -2; n <= 4; n += 1) {
    const length = module * value ** n;
    powers.push(length);
    add(length, `${symbolPower(symbol, n)} · ${trimFeet(module)} ft`);
  }
  for (let i = 0; i < powers.length; i += 1) {
    for (let j = i; j < powers.length; j += 1) {
      if (powers[i] < 0.4 || powers[j] < 0.4) continue;
      add(powers[i] + powers[j], `sum · ${trimFeet(powers[i] + powers[j])} ft`);
    }
  }
  for (const length of otherLengths) {
    if (!(length > 0.4)) continue;
    add(length, `wall · ${trimFeet(length)} ft`);
    add(length * value, `${symbol} × wall`);
    add(length / value, `wall ÷ ${symbol}`);
  }
  return marks.sort((a, b) => a.length - b.length);
}

export function nearestMark(length, marks) {
  let best = marks[0];
  let bestDiff = Infinity;
  for (const mark of marks) {
    const diff = Math.abs(mark.length - length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = mark;
    }
  }
  return best;
}

/**
 * Lock the direction to 45 degrees, then the length to the ratio series.
 * Tick marks sit on that ray.
 */
export function snapToRatioLength(origin, point, ratio, module, otherLengths = []) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const raw = Math.hypot(dx, dy);
  let degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (degrees < 0) degrees += 360;
  const stops = [0, 45, 90, 135, 180, 225, 270, 315];
  let best = 0;
  let bestDiff = 999;
  for (const stop of stops) {
    let diff = Math.abs(degrees - stop);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = stop;
    }
  }
  const radians = (best * Math.PI) / 180;
  const marks = ratioSeries(module, ratio, otherLengths, ratio.symbol || ratio.name);
  const mark = nearestMark(raw || module, marks) || { length: module, label: `${module} ft` };
  const ticks = marks
    .filter((item) => item.length > 0.5 && item.length < Math.max(mark.length * 1.65, module * 2))
    .slice(-7)
    .map((item) => ({
      x: origin.x + Math.cos(radians) * item.length,
      y: origin.y + Math.sin(radians) * item.length,
      label: item.label,
    }));
  return {
    x: origin.x + Math.cos(radians) * mark.length,
    y: origin.y + Math.sin(radians) * mark.length,
    length: mark.length,
    label: mark.label,
    ticks,
    angle: best,
  };
}

function trimFeet(feet) {
  return String(Math.round(feet * 1000) / 1000);
}

export function roomBox(room) {
  const xs = room.polygon.map((point) => point.x);
  const ys = room.polygon.map((point) => point.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x0, y0, x1, y1, width: x1 - x0, depth: y1 - y0 };
}

export function roomProportion(room, custom = []) {
  const box = roomBox(room);
  const long = Math.max(box.width, box.depth);
  const short = Math.min(box.width, box.depth) || 1;
  const match = nearestRatio(long / short, custom);
  return { ...box, match, phrase: proportionPhrase(match) };
}
