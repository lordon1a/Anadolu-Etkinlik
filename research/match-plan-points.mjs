// Compares the positions derived from the university's numbered plan with the
// OSM gates and buildings, to decide what may honestly be named.
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const [lon0, lat0] = [data.origin.lon, data.origin.lat];
const local = (lat, lon) => [Math.round((lon - lon0) * data.projection.metresPerDegLon), Math.round((lat0 - lat) * data.projection.metresPerDegLat)];
const distance = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));

const planPoints = {
  '5 AKM': [39.791188, 30.499943],
  '14 Çağdaş Sanatlar Müzesi': [39.79054, 30.49733],
  '24 Eskişehir MYO': [39.79083, 30.49797],
  '27 Hukuk Fakültesi': [39.79056, 30.50222],
  '33 Cuma Kapısı': [39.79603, 30.49776],
  '34 Cumhuriyet Kapısı': [39.79048, 30.50534],
  '35 Lojmanlar Kapısı': [39.79325, 30.50767],
  '36 Tepebaşı-Eczacılık Kapısı': [39.78904, 30.49315],
  '38 Kongre Merkezi': [39.78975, 30.49775],
  '40 Kütüphane': [39.79116, 30.49896],
  '49 Öğrenci Merkezi': [39.79295, 30.50012],
  '53 Salon 2003': [39.79472, 30.49848],
  '54 Sinema Anadolu': [39.79046, 30.50135],
  '55 Spor Salonu': null,
  '61 Turizm Fakültesi': [39.79325, 30.49246],
};

for (const [label, point] of Object.entries(planPoints)) {
  if (!point) continue;
  const target = local(point[0], point[1]);
  console.log(`\n${label} -> local [${target.join(', ')}]`);
  const gates = data.gates.map((gate) => ({ gate, d: distance(gate.point, target) }))
    .sort((a, b) => a.d - b.d).slice(0, 2);
  for (const { gate, d } of gates) {
    console.log(`   gate ${gate.id} [${gate.point.join(', ')}] ${d} m  onBoundary=${gate.onBoundary}`);
  }
  const buildings = data.buildings.map((building) => ({ building, d: distance(building.center, target) }))
    .sort((a, b) => a.d - b.d).slice(0, 4);
  for (const { building, d } of buildings) {
    console.log(`   building ${building.id} ${(building.name || '(isimsiz)').padEnd(34)} [${building.center.join(', ')}] ${d} m ${building.area} m2`);
  }
}

