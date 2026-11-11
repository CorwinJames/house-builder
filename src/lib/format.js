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

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/**
 * Construction length to the nearest 1/16 inch, plus the exact decimal.
 * `fudged` is true when the sixteenth rounding is not the stored length.
 */
export function formatFeetFine(feet) {
  const sign = feet < 0 ? "-" : "";
  const abs = Math.abs(feet);
  const sixteenths = Math.round(abs * 12 * 16);
  const inchesTotal = Math.floor(sixteenths / 16);
  const remainder = sixteenths % 16;
  const whole = Math.floor(inchesTotal / 12);
  const inches = inchesTotal % 12;
  const divisor = gcd(remainder, 16) || 1;
  const fraction = remainder === 0 ? "" : `${remainder / divisor}/${16 / divisor}`;
  let inchText = "";
  if (inches === 0 && fraction) inchText = `${fraction}"`;
  else if (inches && fraction) inchText = `${inches} ${fraction}"`;
  else if (inches) inchText = `${inches}"`;
  const construction = inchText ? `${sign}${whole}'-${inchText}` : `${sign}${whole}'`;
  const roundedFeet = (sign === "-" ? -1 : 1) * (sixteenths / (12 * 16));
  const exactNumber = Math.round(abs * 10000) / 10000;
  return {
    construction,
    exact: `${sign}${exactNumber} ft`,
    roundedFeet,
    fudged: Math.abs(Math.abs(roundedFeet) - abs) > 1e-5,
  };
}
