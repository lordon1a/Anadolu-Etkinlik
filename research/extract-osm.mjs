import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'node:fs/promises';

const input = new URL('./osm-yunus-emre-2026-09-26.osm', import.meta.url);
const output = new URL('./osm-campus-geometry.geojson', import.meta.url);
const $ = cheerio.load(await readFile(input, 'utf8'), { xmlMode: true });

const tagsOf = (element) => Object.fromEntries($(element).children('tag').toArray()
  .map((tag) => [$(tag).attr('k'), $(tag).attr('v')]));
const nodes = new Map($('node').toArray().map((node) => [$(node).attr('id'), {
  coordinates: [Number($(node).attr('lon')), Number($(node).attr('lat'))],
  tags: tagsOf(node),
}]));
const wayCoordinates = (way) => $(way).children('nd').toArray()
  .map((node) => nodes.get($(node).attr('ref'))?.coordinates).filter(Boolean);
const campus = $('way').toArray().find((way) => $(way).attr('id') === '269147024');
if (!campus) throw new Error('OSM campus boundary 269147024 was not found.');
const boundary = wayCoordinates(campus);

function inside([x, y]) {
  let value = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [ax, ay] = boundary[i];
    const [bx, by] = boundary[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) value = !value;
  }
  return value;
}

const features = [{
  type: 'Feature', id: 'way/269147024',
  properties: { ...tagsOf(campus), osmType: 'way', osmId: '269147024', role: 'campus-boundary' },
  geometry: { type: 'Polygon', coordinates: [boundary] },
}];

for (const way of $('way').toArray()) {
  const id = $(way).attr('id');
  if (id === '269147024') continue;
  const tags = tagsOf(way);
  if (!(tags.building || tags.highway || tags.waterway || tags.natural === 'water' || tags.leisure === 'park' || tags.landuse === 'grass' || tags.amenity === 'parking')) continue;
  const coordinates = wayCoordinates(way);
  if (coordinates.length < 2) continue;
  const center = [coordinates.reduce((sum, p) => sum + p[0], 0) / coordinates.length,
    coordinates.reduce((sum, p) => sum + p[1], 0) / coordinates.length];
  if (!inside(center)) continue;
  const closed = coordinates.length > 3 && coordinates[0][0] === coordinates.at(-1)[0]
    && coordinates[0][1] === coordinates.at(-1)[1];
  features.push({
    type: 'Feature', id: `way/${id}`,
    properties: { ...tags, osmType: 'way', osmId: id },
    geometry: closed && !tags.highway && !tags.waterway
      ? { type: 'Polygon', coordinates: [coordinates] }
      : { type: 'LineString', coordinates },
  });
}

for (const [id, node] of nodes) {
  if (!inside(node.coordinates) || !(node.tags.name || node.tags.entrance)) continue;
  features.push({ type: 'Feature', id: `node/${id}`,
    properties: { ...node.tags, osmType: 'node', osmId: id },
    geometry: { type: 'Point', coordinates: node.coordinates } });
}

const collection = {
  type: 'FeatureCollection',
  name: 'Anadolu Üniversitesi Yunus Emre Kampüsü — OpenStreetMap extract',
  source: 'https://api.openstreetmap.org/api/0.6/map?bbox=30.4885,39.7845,30.5105,39.7955',
  attribution: '© OpenStreetMap contributors; ODbL 1.0 — https://www.openstreetmap.org/copyright',
  note: 'The OSM boundary and features require on-site and official-plan verification before navigation use.',
  features,
};
await writeFile(output, `${JSON.stringify(collection)}\n`);
console.log(`${features.length} GeoJSON features written.`);
