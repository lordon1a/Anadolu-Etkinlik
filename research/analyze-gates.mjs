// Second-pass reconnaissance: gates, named roads, water, parking and the full
// unnamed-building list, so the campus can be laid out from evidence.
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
const inside = ([x, y]) => {
  let value = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [ax, ay] = boundary[i]; const [bx, by] = boundary[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) value = !value;
  }
  return value;
};
const wayCoords = (way) => $(way).children('nd').toArray()
  .map((nd) => nodes.get($(nd).attr('ref'))).filter(Boolean).map((node) => [node.lon, node.lat]);

const metres = ([lon, lat], [lon0, lat0]) => [
  (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 111132,
];
const origin = [30.500675, 39.791895];
const local = (point) => metres(point, origin).map((v) => Math.round(v));

const gates = [];
for (const [id, node] of nodes) {
  const tags = node.tags;
  const isGate = tags.barrier === 'gate' || tags.entrance === 'main' || tags.entrance === 'yes'
    || /kap[ıi]/i.test(tags.name ?? '');
  if (!isGate) continue;
  gates.push({ id, name: tags.name ?? '', tags, point: [node.lon, node.lat], local: local([node.lon, node.lat]) });
}
console.log(`--- gate / entrance candidates (${gates.length}) ---`);
for (const gate of gates) {
  console.log(`node/${gate.id}\t${gate.name || '(isimsiz)'}\t${JSON.stringify(gate.tags)}\t${gate.point[1].toFixed(5)},${gate.point[0].toFixed(5)}\tlocal ${gate.local.join(',')}`);
}

console.log('--- named highways ---');
const namedRoads = new Map();
for (const way of $('way').toArray()) {
  const tags = tagsOf(way);
  if (!tags.highway || !tags.name) continue;
  const road = namedRoads.get(tags.name) ?? { count: 0, kinds: new Set(), points: [] };
  road.count += 1; road.kinds.add(tags.highway);
  road.points.push(...wayCoords(way));
  namedRoads.set(tags.name, road);
}
for (const [name, road] of namedRoads) {
  const points = road.points.filter((point) => inside(point));
  const box = points.length ? [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))].map((v) => v.toFixed(5)) : [];
  console.log(`${name}\tsegments=${road.count}\t${[...road.kinds].join('/')}\tinside-points=${points.length}\tbbox ${box.join(' ')}`);
}

console.log('--- water / green / parking / sports ---');
for (const way of $('way').toArray()) {
  const tags = tagsOf(way);
  if (!(tags.natural === 'water' || tags.waterway || tags.leisure === 'park' || tags.leisure === 'sports_centre'
    || tags.landuse === 'grass' || tags.amenity === 'parking' || tags.landuse === 'forest')) continue;
  const points = wayCoords(way);
  if (!points.length || !inside(points[0])) continue;
  const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  console.log(`way/${$(way).attr('id')}\t${tags.natural ?? tags.waterway ?? tags.leisure ?? tags.landuse ?? tags.amenity}\t${tags.name ?? ''}\tpoints=${points.length}\tlocal ${local(center).join(',')}`);
}

console.log('--- all unnamed buildings with local metres + nearest named ---');
const named = [];
const unnamed = [];
for (const way of $('way').toArray()) {
  const id = $(way).attr('id');
  if (id === '269147024') continue;
  const tags = tagsOf(way);
  if (!tags.building) continue;
  const points = wayCoords(way);
  if (points.length < 3) continue;
  const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  if (!inside(center)) continue;
  const entry = { id, tags, center, local: local(center), points };
  if (tags.name) named.push(entry); else unnamed.push(entry);
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * 111320;
for (const entry of unnamed) {
  const near = named.map((other) => ({ name: other.tags.name, d: distance(entry.center, other.center) }))
    .sort((a, b) => a.d - b.d)[0];
  console.log(`way/${entry.id}\t${entry.tags.building}${entry.tags['building:levels'] ? ' levels=' + entry.tags['building:levels'] : ''}\tlocal ${entry.local.join(',')}\tnear ${near.name} ${Math.round(near.d)} m`);
}
