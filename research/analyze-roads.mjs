// Third pass: the campus' own street network (unnamed ways), the full gate list
// and the boundary's true extent.
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
const lons = boundary.map((p) => p[0]); const lats = boundary.map((p) => p[1]);
console.log(`boundary bbox lon ${Math.min(...lons)}..${Math.max(...lons)} lat ${Math.min(...lats)}..${Math.max(...lats)}`);
console.log(`boundary center ${(Math.min(...lons) + Math.max(...lons)) / 2}, ${(Math.min(...lats) + Math.max(...lats)) / 2}`);

const length = (points) => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot((points[i][0] - points[i - 1][0]) * 85540, (points[i][1] - points[i - 1][1]) * 111132);
  }
  return total;
};

const origin = [30.500675, 39.791895];
const local = ([lon, lat]) => [Math.round((lon - origin[0]) * 85540), Math.round((lat - origin[1]) * 111132)];

console.log('--- ways crossing the boundary (roads entering campus) ---');
for (const way of $('way').toArray()) {
  const tags = tagsOf(way);
  if (!tags.highway) continue;
  const points = wayCoords(way);
  const inCount = points.filter(inside).length;
  if (inCount === 0 || inCount === points.length) continue;
  console.log(`${tags.highway}\t${tags.name ?? '(isimsiz)'}\tway/${$(way).attr('id')}\t${inCount}/${points.length} pts inside\tends ${JSON.stringify(points[0])} -> ${JSON.stringify(points.at(-1))}`);
}

console.log('--- unnamed highways inside (length >= 60 m), grouped ---');
const unnamedInside = [];
for (const way of $('way').toArray()) {
  const tags = tagsOf(way);
  if (!tags.highway || tags.name) continue;
  const points = wayCoords(way);
  if (!points.length || !inside(points[0])) continue;
  const metres = length(points);
  if (metres < 60) continue;
  unnamedInside.push({ id: $(way).attr('id'), kind: tags.highway, metres, ends: [local(points[0]), local(points.at(-1))] });
}
unnamedInside.sort((a, b) => b.metres - a.metres);
for (const road of unnamedInside.slice(0, 45)) {
  console.log(`${road.kind}\t${Math.round(road.metres)} m\tway/${road.id}\t${JSON.stringify(road.ends)}`);
}
console.log(`(total unnamed inside ways >= 60 m: ${unnamedInside.length}, total length ${Math.round(unnamedInside.reduce((s, r) => s + r.metres, 0))} m)`);

console.log('--- all barrier=gate nodes anywhere in extract ---');
for (const [id, node] of nodes) {
  if (node.tags.barrier !== 'gate') continue;
  console.log(`node/${id}\t${node.tags.name ?? '(isimsiz)'}\taccess=${node.tags.access ?? '-'}\t${node.lat.toFixed(5)},${node.lon.toFixed(5)}\tlocal ${local([node.lon, node.lat]).join(',')}\tinside=${inside([node.lon, node.lat])}`);
}

console.log('--- ways that touch the boundary (boundary neighbours) ---');
for (const way of $('way').toArray()) {
  const id = $(way).attr('id');
  if (id === '269147024') continue;
  const points = wayCoords(way);
  if (!points.length) continue;
  const touches = points.filter((point) => boundary.some((bp) => Math.abs(bp[0] - point[0]) < 1e-9 && Math.abs(bp[1] - point[1]) < 1e-9));
  if (!touches.length) continue;
  const tags = tagsOf(way);
  console.log(`${tags.highway ?? tags.barrier ?? tags.building ?? 'other'}\t${tags.name ?? '(isimsiz)'}\tway/${id}\tshared nodes=${touches.length}\tlocal ${local(touches[0]).join(',')}`);
}

