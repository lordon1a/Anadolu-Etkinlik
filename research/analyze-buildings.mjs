// Fourth pass: every building inside the campus boundary, grouped by campus
// region so unnamed footprints can be matched to plan numbers by position.
import * as cheerio from 'cheerio';
import { readFile } from 'node:fs/promises';

const input = new URL('./osm-yunus-emre-2026-09-26.osm', import.meta.url);
const $ = cheerio.load(await readFile(input, 'utf8'), { xmlMode: true });
const tagsOf = (element) => Object.fromEntries($(element).children('tag').toArray()
  .map((tag) => [$(tag).attr('k'), $(tag).attr('v')]));
const nodes = new Map($('node').toArray().map((node) => [$(node).attr('id'), {
  lat: Number($(node).attr('lat')), lon: Number($(node).attr('lon')), tags: tagsOf(node),
}]));
const wayCoords = (way) => $(way).children('nd').toArray()
  .map((nd) => nodes.get($(nd).attr('ref'))).filter(Boolean).map((node) => [node.lon, node.lat]);
const boundary = wayCoords($('way').toArray().find((way) => $(way).attr('id') === '269147024'));
const inside = ([x, y]) => {
  let value = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [ax, ay] = boundary[i]; const [bx, by] = boundary[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) value = !value;
  }
  return value;
};
const ORIGIN = [30.5006767, 39.79189615];
const local = ([lon, lat]) => [Math.round((lon - ORIGIN[0]) * 85540), Math.round((lat - ORIGIN[1]) * 111132)];
const area = (points) => {
  let total = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    total += points[j][0] * 85540 * points[i][1] * 111132 - points[i][0] * 85540 * points[j][1] * 111132;
  }
  return Math.round(Math.abs(total / 2));
};

const buildings = [];
for (const way of $('way').toArray()) {
  const id = $(way).attr('id');
  if (id === '269147024') continue;
  const tags = tagsOf(way);
  if (!tags.building) continue;
  const points = wayCoords(way);
  if (points.length < 3) continue;
  const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  if (!inside(center)) continue;
  buildings.push({ id, name: tags.name ?? '', type: tags.building, metres: area(points), loc: local(center), tags });
}

const line = (building) => `way/${building.id}  ${(building.name || `(${building.type})`).padEnd(48)}${String(building.metres).padStart(5)} m2  [${building.loc.join(', ')}]`;
const east = buildings.filter((item) => item.loc[0] > 120).sort((a, b) => a.loc[1] - b.loc[1]);
const centre = buildings.filter((item) => item.loc[0] > -260 && item.loc[0] <= 120 && item.loc[1] > -250 && item.loc[1] < 250).sort((a, b) => a.loc[0] - b.loc[0]);
const rest = buildings.filter((item) => !east.includes(item) && !centre.includes(item)).sort((a, b) => a.loc[0] - b.loc[0]);

console.log(`=== EAST (x > 120 m) — ${east.length} ===`);
east.forEach((item) => console.log(line(item)));
console.log(`=== CENTRE (-260 < x <= 120, -250 < y < 250) — ${centre.length} ===`);
centre.forEach((item) => console.log(line(item)));
console.log(`=== WEST AND EDGES — ${rest.length} ===`);
rest.forEach((item) => console.log(line(item)));
console.log(`total buildings inside boundary: ${buildings.length}`);
