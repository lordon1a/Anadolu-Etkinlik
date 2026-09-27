// Ground data for the 3D scene: the elevation grid over the campus, plus the
// tile window the satellite layer uses when a visitor asks for it.
//
//   node research/build-ground-data.mjs
//
// Imagery: Esri World Imagery. The service forbids bulk export
// (exportTilesAllowed=false) and its terms do not allow redistribution, so the
// tiles are NOT part of the repo or the build: the app requests them from
// server.arcgisonline.com at run time, only when the visitor turns the satellite
// layer on. This script still downloads a local copy for comparison, into
// research/ground/tiles (gitignored).
// Elevation: Open-Meteo elevation API (Copernicus DEM GLO-90).
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const Z = 17;
const ORIGIN = { lat: 39.7918961, lon: 30.5006767 };
const METRES_PER_DEG_LAT = 111132;
const METRES_PER_DEG_LON = 85540;
const GRID = 40;
const USER_AGENT = 'Kampuste/0.1 (independent student event map; contact: local project)';

const data = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const { minX, maxX, minZ, maxZ } = data.extent;
const PAD = 60; // a little ground beyond the outermost feature
const box = { minX: minX - PAD, maxX: maxX + PAD, minZ: minZ - PAD, maxZ: maxZ + PAD };

const lonLatToPixel = (lat, lon, zoom) => {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
};
const localToLonLat = ([x, z]) => [ORIGIN.lon + x / METRES_PER_DEG_LON, ORIGIN.lat - z / METRES_PER_DEG_LAT];
const localToPixel = (point) => {
  const [lon, lat] = localToLonLat(point);
  return lonLatToPixel(lat, lon, Z);
};

const corners = [[box.minX, box.minZ], [box.maxX, box.minZ], [box.minX, box.maxZ], [box.maxX, box.maxZ]].map(localToPixel);
const left = Math.min(...corners.map((p) => p[0]));
const right = Math.max(...corners.map((p) => p[0]));
const top = Math.min(...corners.map((p) => p[1]));
const bottom = Math.max(...corners.map((p) => p[1]));
const tileLeft = Math.floor(left / 256);
const tileRight = Math.floor(right / 256);
const tileTop = Math.floor(top / 256);
const tileBottom = Math.floor(bottom / 256);
const mosaicWidth = (tileRight - tileLeft + 1) * 256;
const mosaicHeight = (tileBottom - tileTop + 1) * 256;

const outDir = new URL('./ground/', import.meta.url);
// The run-time satellite layer and the local comparison copy share one template.
const IMAGERY_URL = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/{y}/{x}`;
// Tiles land in the gitignored research folder: they are a local comparison copy,
// never part of the web root or the build output.
const tileDir = new URL('./ground/tiles/', import.meta.url);
await mkdir(tileDir, { recursive: true });

console.log(`mosaic ${mosaicWidth}x${mosaicHeight} px, tiles x${tileLeft}..${tileRight} y${tileTop}..${tileBottom}`);
const tiles = [];
let bytes = 0;
for (let tx = tileLeft; tx <= tileRight; tx += 1) {
  for (let ty = tileTop; ty <= tileBottom; ty += 1) {
    const url = IMAGERY_URL.replace('{x}', tx).replace('{y}', ty);
    const local = new URL(`${Z}-${tx}-${ty}.jpg`, tileDir);
    try {
      const existing = await readFile(local).catch(() => null);
      if (existing?.length) {
        tiles.push({ tx, ty, bytes: existing.length, skipped: true });
        bytes += existing.length;
        continue;
      }
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(local, buffer);
      tiles.push({ tx, ty, bytes: buffer.length, skipped: false });
      bytes += buffer.length;
      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (error) {
      console.log(`  tile ${Z}/${tx}/${ty} failed: ${error.message}`);
    }
  }
}
console.log(`${tiles.length} tiles, ${(bytes / 1024 / 1024).toFixed(2)} MB total`);

// Elevation grid (row 0 = north edge, matching the imagery).
const lats = [];
const lons = [];
for (let row = 0; row < GRID; row += 1) {
  for (let column = 0; column < GRID; column += 1) {
    const x = box.minX + ((box.maxX - box.minX) * column) / (GRID - 1);
    const z = box.minZ + ((box.maxZ - box.minZ) * row) / (GRID - 1);
    const [lon, lat] = localToLonLat([x, z]);
    lats.push(lat.toFixed(6));
    lons.push(lon.toFixed(6));
  }
}
// One request per chunk: the API allows at most 100 coordinates per call and
// throttles bursts, so 429s are retried with a growing pause. Completed chunks
// are cached so a throttled run can be resumed.
const CHUNK = 100;
const cachePath = new URL('./ground/elevation-partial.json', import.meta.url);
const cached = JSON.parse(await readFile(cachePath, 'utf8').catch(() => '[]'));
// A cache from a different grid size would silently shift the terrain; drop it.
const values = Array.isArray(cached) && cached.length <= GRID * GRID && cached.length % GRID === 0 ? [...cached] : [];
if (values.length) console.log(`resuming elevation grid at ${values.length} values`);
for (let start = values.length; start < lats.length; start += CHUNK) {
  const chunkLats = lats.slice(start, start + CHUNK);
  const chunkLons = lons.slice(start, start + CHUNK);
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunkLats.join(',')}&longitude=${chunkLons.join(',')}`;
  let body = null;
  for (let attempt = 0; attempt < 6 && !body; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (response.ok) {
      body = await response.json();
      break;
    }
    if (response.status !== 429 && response.status < 500) throw new Error(`elevation HTTP ${response.status} at offset ${start}`);
    const pause = 8000 * (attempt + 1);
    console.log(`  elevation ${response.status} at ${start}, retrying in ${pause} ms`);
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
  if (!body) throw new Error(`elevation kept failing at offset ${start}`);
  if (!Array.isArray(body.elevation) || body.elevation.length !== chunkLats.length) {
    throw new Error(`elevation chunk at ${start} returned ${body.elevation?.length} values, expected ${chunkLats.length}`);
  }
  values.push(...body.elevation);
  process.stdout.write(`\r  elevation ${values.length}/${lats.length}`);
  // The API throttles hard; this grid needs 16 calls and each one is also cached.
  await writeFile(new URL('./ground/elevation-partial.json', import.meta.url), JSON.stringify(values), 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 2500));
}
process.stdout.write('\n');
if (values.length !== GRID * GRID) {
  throw new Error(`elevation grid came back with ${values.length} values, expected ${GRID * GRID}`);
}

const stats = {
  min: Math.min(...values),
  max: Math.max(...values),
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
};
console.log(`elevation ${stats.min}..${stats.max} m (ortanca ~${stats.mean.toFixed(1)}), ${values.length} nokta`);

const ground = {
  // Only the elevation is a redistributable dataset; the imagery stays on Esri's
  // servers and is credited in the scene when the visitor turns it on.
  attribution: [
    { text: 'Copernicus DEM GLO-90 (Open-Meteo)', url: 'https://open-meteo.com/en/docs/elevation-api' },
  ],
  zoom: Z,
  image: {
    // Run-time satellite layer: the app substitutes {x}/{y} and loads the tiles
    // straight from Esri. No tile file ships with the build.
    urlTemplate: IMAGERY_URL,
    credit: 'Kaynak: Esri, Vantor, Earthstar Geographics ve GIS kullanıcı topluluğu',
    tileRange: { left: tileLeft, right: tileRight, top: tileTop, bottom: tileBottom },
    tileSize: 256,
    mosaicWidth,
    mosaicHeight,
    // Crop of the mosaic that matches the local box below, in mosaic pixels.
    crop: {
      x: left - tileLeft * 256,
      y: top - tileTop * 256,
      width: right - left,
      height: bottom - top,
    },
  },
  box,
  grid: { size: GRID, values },
  stats,
};
await writeFile(new URL('./ground/ground.json', import.meta.url), `${JSON.stringify(ground)}\n`, 'utf8');
console.log('wrote research/ground/ground.json');
console.log(`comparison tiles under research/ground/tiles (gitignored), crop: ${Math.round(right - left)}x${Math.round(bottom - top)} px for box ${JSON.stringify(box)}`);
