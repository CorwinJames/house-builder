/** Drawn marks that are not walls: furniture, plan labels, and site features. */

export function furnitureFootprint(item) {
  const width = item.width || 2;
  const depth = item.depth || 2;
  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const cosine = Math.cos(rad);
  const sine = Math.sin(rad);
  const corners = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ];
  return corners.map(([x, y]) => ({
    x: item.x + x * cosine - y * sine,
    y: item.y + x * sine + y * cosine,
  }));
}

/** The room's ground note, and its raised floor height when it has one. */
export function roomGroundLine(room) {
  const text = String(room?.groundLevel || "").trim();
  const level = Number(room?.floorLevel) || 0;
  if (!(level > 0)) return text;
  const inches = Math.round(level * 12);
  const raised = `Floor up ${inches >= 12 ? `${Math.floor(inches / 12)}′ ${inches % 12}″` : `${inches}″`}`;
  return text ? `${text} · ${raised}` : raised;
}
