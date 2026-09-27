// One-off check: how the handoff's verified building centres compare with the
// mean-of-nodes centre and the polygon centroid of the same OSM way.
import * as cheerio from 'cheerio';
import { readFile } from 'node:fs/promises';

const input = new URL('./osm-yunus-emre-2026-09-26.osm', import.meta.url);
const $ = cheerio.load(await readFile(input, 'utf8'), { xmlMode: true });
const tagsOf = (element) => Object.fromEntries($(element).children('tag').toArray()
  .map((tag) => [$(tag).attr('k'), $(tag).attr('v')]));
const nodes = new Map($('node').toArray().map((node) => [$(node).attr('id'), {
  lat: Number($(node).attr('lat')), lon: Number($(node).attr('lon')),
}]));
const coords = (id) => {
  const way = $('way').toArray().find((item) => $(item).attr('id') === id);
  return $(way).children('nd').toArray().map((nd) => nodes.get($(nd).attr('ref'))).filter(Boolean)
    .map((node) => [node.lon, node.lat]);
};
const mean = (points) => [points.reduce((s, p) => s + p[0], 0) / points.length,
  points.reduce((s, p) => s + p[1], 0) / points.length];
const centroid = (points) => {
  let area = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    area += cross; cx += (points[j][0] + points[i][0]) * cross; cy += (points[j][1] + points[i][1]) * cross;
  }
  area *= 0.5;
  return [cx / (6 * area), cy / (6 * area)];
};
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 85540, (a[1] - b[1]) * 111132);

const handoff = {
  'way/374982336': [30.499968, 39.791214],  // AKM, plan 5
  'way/374982357': [30.500227, 39.792863],  // Öğrenci Merkezi, plan 49
  'way/374187005': [30.501279, 39.790342],  // Sinema Anadolu, plan 54
  'way/374262148': [30.492415, 39.793287],  // Turizm Fakültesi, plan 61
  'way/761605589': [30.499063, 39.791099],  // Kütüphane, plan 40
  'way/660042188': [30.497956, 39.790897],  // EMYO, plan 24
};
console.log('way       nodes  mean->handoff  centroid->handoff');
for (const [id, point] of Object.entries(handoff)) {
  const points = coords(id.split('/')[1]);
  console.log(`${id}  n=${String(points.length).padStart(2)}  mean ${metres(mean(points), point).toFixed(1)} m   centroid ${metres(centroid(points), point).toFixed(1)} m`);
}
console.log('--- centroid vs mean, per way ---');
for (const id of Object.keys(handoff)) {
  const points = coords(id.split('/')[1]);
  console.log(`${id}  centroid-mean ${metres(centroid(points), mean(points)).toFixed(1)} m`);
}
