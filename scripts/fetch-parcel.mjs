/**
 * Fetch a Jefferson County parcel and a coarse elevation grid.
 *
 *   node scripts/fetch-parcel.mjs --parcel 001231001
 *   node scripts/fetch-parcel.mjs --address "123 Main St, Port Hadlock, WA"
 *
 * Writes a house-builder site JSON. The lot in the app stays the sample
 * until you import this file. No price is added here.
 */
import { writeFileSync } from "node:fs";

const PARCELS = "https://gis.dnr.wa.gov/site2/rest/services/Public_Forest_Practices/WADNR_PUBLIC_OCIO_Parcels/MapServer/0/query";
const GEOCODE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const ELEVATION = "https://epqs.nationalmap.gov/v1/json";
const SOIL = "https://sdmdataaccess.sc.egov.usda.gov/Spatial/SDMWGS84Geographic.wfs";

export function localFeet(ringLonLat) {
  const lon0 = ringLonLat.reduce((sum, point) => sum + point[0], 0) / ringLonLat.length;
  const lat0 = ringLonLat.reduce((sum, point) => sum + point[1], 0) / ringLonLat.length;
  const feetPerDegLat = 364000;
  const feetPerDegLon = 364000 * Math.cos((lat0 * Math.PI) / 180);
  const local = ringLonLat.map(([lon, lat]) => ({
    x: (lon - lon0) * feetPerDegLon,
    y: (lat - lat0) * feetPerDegLat,
  }));
  const ys = local.map((point) => point.y);
  const xs = local.map((point) => point.x);
  const dx = 38 - (Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = -80 - Math.min(...ys);
  return {
    origin: { lon: lon0, lat: lat0 },
    ring: local.map((point) => ({ x: round(point.x + dx), y: round(point.y + dy) })),
  };
}

export function ringsFromGeoJson(geojson) {
  const features = geojson.features || [];
  const rings = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const polygon of polygons) {
      if (polygon[0]?.length) rings.push(polygon[0].map(([lon, lat]) => [lon, lat]));
    }
  }
  return rings;
}

export async function geocodeAddress(address, fetchImpl = fetch) {
  const url = `${GEOCODE}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
  const body = await response.json();
  const match = body.result?.addressMatches?.[0];
  if (!match) return null;
  return { lon: match.coordinates.x, lat: match.coordinates.y, matched: match.matchedAddress };
}

export async function queryParcel({ parcel, point }, fetchImpl = fetch) {
  const params = new URLSearchParams({
    where: parcel
      ? `COUNTY_NM='Jefferson' AND (ORIG_PARCEL_ID='${parcel.replace(/'/g, "")}' OR PARCEL_ID_NR='${parcel.replace(/'/g, "")}')`
      : "COUNTY_NM='Jefferson'",
    outFields: "ORIG_PARCEL_ID,PARCEL_ID_NR,SITUS_ADDRESS,COUNTY_NM",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  if (point) {
    params.set("geometry", `${point.lon},${point.lat}`);
    params.set("geometryType", "esriGeometryPoint");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }
  const response = await fetchImpl(`${PARCELS}?${params}`);
  if (!response.ok) throw new Error(`Parcel service returned ${response.status}`);
  return response.json();
}

export async function elevationFeet(lon, lat, fetchImpl = fetch) {
  const url = `${ELEVATION}?x=${lon}&y=${lat}&units=Feet&wkid=4326`;
  const response = await fetchImpl(url);
  if (!response.ok) return null;
  const body = await response.json();
  const value = body.value ?? body.elevation ?? null;
  return typeof value === "number" ? value : null;
}

export async function soilName(lon, lat, fetchImpl = fetch) {
  const pad = 0.0002;
  const url = `${SOIL}?service=WFS&version=1.0.0&request=GetFeature&typeName=mapunitpoly&BBOX=${lon - pad},${lat - pad},${lon + pad},${lat + pad}&outputFormat=json`;
  const response = await fetchImpl(url);
  if (!response.ok) return null;
  const body = await response.json();
  const name = body.features?.[0]?.properties?.muname || body.features?.[0]?.properties?.musym || null;
  return name;
}

export function siteFromRing(ringLonLat, meta = {}) {
  const placed = localFeet(ringLonLat);
  return {
    kind: "house-builder.site",
    site: {
      sample: false,
      label: meta.label || meta.parcelId || "Imported parcel",
      parcel: {
        ring: placed.ring,
        source: "Jefferson County via WA parcels",
        parcelId: meta.parcelId || null,
        note: meta.note || "Boundary from the public parcel service. Confirm it against the county map.",
        origin: placed.origin,
      },
      zone: {
        district: "RR 1:5",
        roadClass: "local-access",
        frontFt: 20,
        sideFt: 5,
        rearFt: 5,
        assumed: true,
      },
      terrain: meta.terrain || {
        source: "missing",
        note: "Elevation was not filled. The helper can query USGS 3DEP.",
        contourFt: 2,
        plane: { base: 0, east: 0, north: 0 },
      },
      soil: {
        mapUnitName: meta.soil || null,
        note: meta.soil ? "NRCS Web Soil Survey map unit for the parcel centroid." : "Soil query did not return a map unit.",
      },
      well: null,
      septic: null,
    },
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function main() {
  const args = process.argv.slice(2);
  const parcelFlag = args.indexOf("--parcel");
  const addressFlag = args.indexOf("--address");
  const outFlag = args.indexOf("--out");
  const parcel = parcelFlag >= 0 ? args[parcelFlag + 1] : "";
  const address = addressFlag >= 0 ? args[addressFlag + 1] : "";
  const out = outFlag >= 0 ? args[outFlag + 1] : "parcel.site.json";
  if (!parcel && !address) {
    console.error("Pass --parcel PIN or --address \"street, city, WA\"");
    process.exit(1);
  }
  let point = null;
  if (address) point = await geocodeAddress(address);
  const geojson = await queryParcel({ parcel, point });
  const rings = ringsFromGeoJson(geojson);
  if (!rings.length) {
    console.error("No Jefferson County parcel came back.");
    process.exit(1);
  }
  const ring = rings[0];
  const centroid = ring.reduce((sum, pair) => [sum[0] + pair[0], sum[1] + pair[1]], [0, 0]).map((value) => value / ring.length);
  let terrain = null;
  const sample = await elevationFeet(centroid[0], centroid[1]);
  if (typeof sample === "number") {
    terrain = {
      source: "USGS 3DEP EPQS",
      note: "One elevation at the parcel centroid. A full lidar surface is not in this file. WA DNR lidar was not queried.",
      contourFt: 2,
      plane: { base: sample, east: 0, north: 0 },
      url: "https://epqs.nationalmap.gov/v1/json",
    };
  }
  const soil = await soilName(centroid[0], centroid[1]).catch(() => null);
  const document = siteFromRing(ring, {
    parcelId: parcel || geojson.features?.[0]?.properties?.ORIG_PARCEL_ID,
    soil,
    terrain,
    note: point?.matched ? `Matched ${point.matched}. Confirm the lot.` : "Confirm the lot against the county map.",
  });
  writeFileSync(out, JSON.stringify(document, null, 2));
  console.log(`Wrote ${out}`);
}

if (process.argv[1] && process.argv[1].endsWith("fetch-parcel.mjs")) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
