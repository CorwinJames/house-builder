/**
 * Where the sun is. No DOM.
 *
 * With a real lot (site.parcel.origin has lat and lon from Jefferson County GIS),
 * or else a reference place (house.solar.place, chosen in the Sun panel or the
 * Solar tool), the sun comes from the date and time at that spot. Without
 * either, the person sets the sun's direction and height by hand.
 *
 * Plan directions: +x is east, +y is north (true north for an imported lot).
 * Azimuth is degrees clockwise from north (90 = east, 180 = south).
 * Elevation is degrees above the horizon.
 *
 * Solar position follows the NOAA Solar Calculator spreadsheet equations
 * (https://gml.noaa.gov/grad/solcalc/calcdetails.html). Good to about a
 * tenth of a degree, which is far finer than this drawing needs.
 */

const RAD = Math.PI / 180;
export const SITE_TIME_ZONE = "America/Los_Angeles";

/** Sun position for a moment (a JS Date) at a latitude and longitude (degrees, east positive). */
export function solarPosition(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * RAD) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (
    y * Math.sin(2 * l0 * RAD)
    - 2 * e * Math.sin(m * RAD)
    + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
    - 0.5 * y * y * Math.sin(4 * l0 * RAD)
    - 1.25 * e * e * Math.sin(2 * m * RAD)
  );
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = mod(utcMinutes + eqTime + 4 * lon, 1440);
  let hourAngle = trueSolar / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const cosZenith = Math.sin(lat * RAD) * Math.sin(decl * RAD)
    + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
  const elevation = 90 - zenith;
  const azDen = Math.cos(lat * RAD) * Math.sin(zenith * RAD);
  let azimuth;
  if (Math.abs(azDen) < 1e-9) {
    azimuth = lat > 0 ? 180 : 0;
  } else {
    const cosAz = (Math.sin(lat * RAD) * Math.cos(zenith * RAD) - Math.sin(decl * RAD)) / azDen;
    const a = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD;
    azimuth = hourAngle > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }
  return { azimuth, elevation };
}

/** Unit vector pointing toward the sun, in plan feet (x east, y north, z up). */
export function sunVector(azimuth, elevation) {
  const az = azimuth * RAD;
  const el = elevation * RAD;
  return { x: Math.sin(az) * Math.cos(el), y: Math.cos(az) * Math.cos(el), z: Math.sin(el) };
}

/** Minutes the zone is ahead of UTC at that moment (Pacific: -480 in winter, -420 in summer). */
export function zoneOffsetMinutes(date, timeZone = SITE_TIME_ZONE) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return -480;
  }
}

/** The UTC moment for a local wall-clock date and time at the site. */
export function siteMoment(month, day, minutes, year = 2026, timeZone = SITE_TIME_ZONE) {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0) + minutes * 60000);
  const offset = zoneOffsetMinutes(guess, timeZone);
  const moment = new Date(guess.getTime() - offset * 60000);
  const again = zoneOffsetMinutes(moment, timeZone);
  return again === offset ? moment : new Date(guess.getTime() - again * 60000);
}

/** The lot's location, if the plan has a real imported lot. */
export function lotLocation(house) {
  const site = house?.site;
  const origin = site?.parcel?.origin;
  if (site?.sample || !origin) return null;
  const lat = Number(origin.lat);
  const lon = Number(origin.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Where the sun is worked out from: the lot, else the reference place, else null. */
export function sunPlace(house) {
  const lot = lotLocation(house);
  if (lot) return { ...lot, name: "the lot", source: "lot" };
  const place = house?.solar?.place;
  const lat = Number(place?.lat);
  const lon = Number(place?.lon);
  if (place && Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, name: place.name || `${lat}, ${lon}`, source: "place" };
  return null;
}

/**
 * The four seasons as their solstice and equinox days, in Pacific time. The
 * exact day moves by one between years; a day's difference moves the sun by
 * well under half a degree. Dates: Griffith Observatory, "Seasons" table for
 * 2026–2027 (https://griffithobservatory.lacity.gov/?p=270), checked 2026-11-17.
 */
export const SEASONS = Object.freeze([
  { id: "winter", label: "Winter", month: 12, day: 21, note: "Dec 21, shortest day, sun lowest" },
  { id: "spring", label: "Spring", month: 3, day: 20, note: "Mar 20, equinox, sun halfway" },
  { id: "summer", label: "Summer", month: 6, day: 21, note: "Jun 21, longest day, sun highest" },
  { id: "fall", label: "Fall", month: 9, day: 22, note: "Sep 22, equinox, sun halfway" },
]);

export const SEASON_SOURCE = { name: "Griffith Observatory: Seasons", url: "https://griffithobservatory.lacity.gov/?p=270", checked: "2026-11-17" };

export const DEFAULT_SUN = Object.freeze({
  mode: "auto",
  month: 6,
  day: 21,
  minutes: 15 * 60,
  azimuth: 225,
  elevation: 40,
  keepWhileBuilding: false,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compassWord(azimuth) {
  return COMPASS[Math.round(mod(azimuth, 360) / 22.5) % 16];
}

export function clockText(minutes) {
  const total = Math.round(mod(minutes, 1440));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function dateText(month, day) {
  return `${MONTHS[(month - 1 + 12) % 12]} ${day}`;
}

/**
 * The sun right now for these settings. With a lot and mode "auto", it comes
 * from the date and time; otherwise from the hand-set direction and height.
 */
export function currentSun(house, settings = DEFAULT_SUN) {
  const s = { ...DEFAULT_SUN, ...(settings || {}) };
  const lot = lotLocation(house);
  const place = sunPlace(house);
  let azimuth = s.azimuth;
  let elevation = s.elevation;
  let source = "manual";
  if (place && s.mode !== "manual") {
    const sun = solarPosition(siteMoment(s.month, s.day, s.minutes), place.lat, place.lon);
    azimuth = sun.azimuth;
    elevation = sun.elevation;
    source = place.source;
  }
  const season = SEASONS.find((item) => item.month === s.month && item.day === s.day);
  const up = elevation > 0.3;
  const words = up
    ? `Sun ${Math.round(elevation)}° high, from the ${compassWord(azimuth)}`
    : "The sun is down";
  return {
    azimuth,
    elevation,
    up,
    source,
    lot,
    place,
    vector: sunVector(azimuth, Math.max(elevation, 0.3)),
    label: source !== "manual" ? `${season ? `${season.label} · ` : ""}${dateText(s.month, s.day)} · ${clockText(s.minutes)} · ${words}` : words,
  };
}

function mod(a, n) {
  return ((a % n) + n) % n;
}
