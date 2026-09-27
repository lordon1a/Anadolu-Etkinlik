// What stands around the OSM "Hukuk Fakültesi" node, and is it inside the
// campus boundary the map uses?
import * as cheerio from 'cheerio';
import { readFile } from 'node:fs/promises';

const geometry = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const ring = geometry.boundary;
const inside = ([x, z]) => {
  let value = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, az] = ring[i]; const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) value = !value;
  }
  return value;
};
console.log('boundary ring near the node (x 0..300):');
for (const [x, z] of ring.filter(([x]) => x > -80 && x < 340)) console.log(`  ${x}, ${z}  inside-test-at-node=${inside([x, z])}`);
const node = [127, -181];
console.log(`node ${node.join(',')} inside boundary: ${inside(node)}`);
console.log('nearest boundary vertices:');
console.log(ring.map(([x, z]) => ({ x, z, d: Math.round(Math.hypot(x - node[0], z - node[1])) })).sort((a, b) => a.d - b.d).slice(0, 4));

// Building footprints from the extract that sit in the same block.
const $ = cheerio.load(await readFile(new URL('./osm-yunus-emre-2026-09-26.osm', import.meta.url), 'utf8'), { xmlMode: true });
const tagsOf = (element) => Object.fromEntries($(element).children('tag').toArray().map((tag) => [$(tag).attr('k'), $(tag).attr('v')]));
const nodes = new Map($('node').toArray().map((item) => [$(item).attr('id'), { lat: Number($(item).attr('lat')), lon: Number($(item).attr('lon')), tags: tagsOf(item) }]));
const ORIGIN = [geometry.origin.lon, geometry.origin.lat];
const local = ([lon, lat]) => [Math.round((lon - ORIGIN[0]) * 85540), Math.round((lat - ORIGIN[1]) * 111132)];
console.log('buildings in the south-east block (x 40..420, z -400..-60):');
for (const way of $('way').toArray()) {
  const tags = tagsOf(way);
  if (!tags.building) continue;
  const points = $(way).children('nd').toArray().map((nd) => nodes.get($(nd).attr('ref'))).filter(Boolean);
  if (points.length < 3) continue;
  const center = local([points.reduce((sum, point) => sum + point.lon / points.length, 0),
    points.reduce((sum, point) => sum + point.lat / points.length, 0)]);
  if (center[0] < 40 || center[0] > 420 || center[1] < 60 || center[1] > 400) continue;
  console.log(`  way/${$(way).attr('id')}\t${(tags.name || '(isimsiz)').padEnd(30)}\tlocal ${center.join(',')}\tinside=${inside(center)}`);
}
