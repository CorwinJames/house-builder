/** Architectural feet-and-inches. Input is decimal feet. */
export function formatFeet(feet) {
  const sign = feet < 0 ? "-" : "";
  let inches = Math.round(Math.abs(feet) * 12);
  let whole = Math.floor(inches / 12);
  inches %= 12;
  if (inches === 12) {
    whole += 1;
    inches = 0;
  }
  if (inches === 0) return `${sign}${whole}'`;
  return `${sign}${whole}'-${inches}"`;
}

export function formatArea(sqft) {
  return Math.round(sqft).toLocaleString("en-US");
}
