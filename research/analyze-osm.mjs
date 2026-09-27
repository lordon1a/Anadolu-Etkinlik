// Reads the raw OSM extract and prints the building / POI inventory so venue
// matches can be made from evidence instead of guesses.
import * as cheerio from 'cheerio';
import { readFile } from 'node:fs/promises';

const input = new URL('./osm-yunus-emre-2026-09-26.osm', import.meta.url);
const $ = cheerio.load(await readFile(input, 'utf8'), { xmlMode: true });

const tagsOf = (element) => Object.fromEntries($(element).children('tag').toArray()
  .map((tag) => [$(tag).attr('k'), $(tag).attr('v')]));

const nodes = new Map($('node').toArray().map((node) => [$(node).attr('id'), {
  lat: Number($(node).attr('lat')), lon: Number($(node).attr('lon')), tags: tagsOf(node),
}]));

const campus = $('way').toArray().find((way) => $(way).attr('id') === '269147024');
const boundary = $(campus).children('nd').toArray()
  .map((nd) => { const node = nodes.get($(nd).attr('ref')); return [node.lon, node.lat]; });

function inside([x, y]) {
  let value = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [ax, ay] = boundary[i]; const [bx, by] = boundary[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) value = !value;
  }
  return value;
}

function centroid(points) {
  let area = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    area += cross; cx += (points[j][0] + points[i][0]) * cross; cy += (points[j][1] + points[i][1]) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    return [points.reduce((s, p) => s + p[0], 0) / points.length,
      points.reduce((s, p) => s + p[1], 0) / points.length];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

const metresPerDegLat = 111132;
const metresPerDegLon = 111320 * Math.cos((39.79 * Math.PI) / 180);
const areaOf = (points) => {
  let total = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    total += points[j][0] * metresPerDegLon * points[i][1] * metresPerDegLat
      - points[i][0] * metresPerDegLon * points[j][1] * metresPerDegLat;
  }
  return Math.abs(total / 2);
};

const buildings = [];
const named = [];
for (const way of $('way').toArray()) {
  const id = $(way).attr('id');
  if (id === '269147024') continue;
  const tags = tagsOf(way);
  if (!tags.building) continue;
  const points = $(way).children('nd').toArray()
    .map((nd) => nodes.get($(nd).attr('ref'))).filter(Boolean).map((node) => [node.lon, node.lat]);
  if (points.length < 3) continue;
  const center = centroid(points);
  if (!inside(center)) continue;
  const entry = {
    id, name: tags.name ?? '', type: tags.building, levels: tags['building:levels'] ?? '',
    height: tags.height ?? '', area: Math.round(areaOf(points)), center: center.map((v) => Number(v.toFixed(6))),
  };
  buildings.push(entry);
  if (tags.name) named.push(entry);
}

console.log(`buildings inside boundary: ${buildings.length}`);
console.log('--- named buildings ---');
for (const entry of named.sort((a, b) => a.name.localeCompare(b.name, 'tr'))) {
  console.log(`${entry.name}\tway/${entry.id}\t${entry.area} m2\tlevels=${entry.levels || '-'}\t${entry.center.join(', ')}`);
}

console.log('--- unnamed buildings, largest 30 ---');
for (const entry of buildings.filter((item) => !item.name).sort((a, b) => b.area - a.area).slice(0, 30)) {
  console.log(`way/${entry.id}\t${entry.area} m2\ttype=${entry.type}\tlevels=${entry.levels || '-'}\t${entry.center.join(', ')}`);
}

console.log('--- named nodes (POI) ---');
for (const [id, node] of nodes) {
  if (!node.tags.name || !inside([node.lon, node.lat])) continue;
  console.log(`${node.tags.name}\tnode/${id}\t${node.tags.amenity ?? node.tags.tourism ?? node.tags.entrance ?? node.tags.highway ?? '-'}\t${node.lat.toFixed(6)}, ${node.lon.toFixed(6)}`);
}

console.log('--- boundary ---');
console.log(`points: ${boundary.length}`);
const lons = boundary.map((p) => p[0]); const lats = boundary.map((p) => p[1]);
console.log(`bbox lon ${Math.min(...lons).toFixed(5)}..${Math.max(...lons).toFixed(5)} lat ${Math.min(...lats).toFixed(5)}..${Math.max(...lats).toFixed(5)}`);
console.log(`extent: ${Math.round((Math.max(...lons) - Math.min(...lons)) * metresPerDegLon)} m x ${Math.round((Math.max(...lats) - Math.min(...lats)) * metresPerDegLat)} m`);
