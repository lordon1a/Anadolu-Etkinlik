// Sanity check on the generated geometry: how far outside the campus boundary
// do the included buildings sit, and what do the largest ones look like?
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const ring = data.boundary;
const pointInRing = ([x, z]) => {
  let value = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i]; const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) value = !value;
  }
  return value;
};
const distanceToRing = ([x, z]) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i]; const [bx, bz] = ring[j];
    const dx = bx - ax; const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
};

const outside = data.buildings.filter((building) => !pointInRing(building.center));
console.log(`buildings: ${data.buildings.length}, centres outside the boundary ring: ${outside.length}`);
for (const building of outside.sort((a, b) => distanceToRing(a.center) - distanceToRing(b.center)).slice(0, 20)) {
  console.log(`  way/${building.id.split('/')[1]}\t${(building.name || '(isimsiz)').padEnd(40)}\t${building.area} m2\tcenter ${building.center.join(',')}\tdist ${Math.round(distanceToRing(building.center))} m`);
}
console.log('--- 12 largest ---');
for (const building of [...data.buildings].sort((a, b) => b.area - a.area).slice(0, 12)) {
  console.log(`  ${(building.name || '(isimsiz)').padEnd(44)}\t${building.area} m2\theight ${building.height} (${building.heightSource})\troof ${building.roof}`);
}
console.log('--- venues ---');
for (const venue of data.venues) {
  console.log(`  ${venue.id.padEnd(16)}\t${venue.position.padEnd(11)}\tcenter ${venue.center ? venue.center.join(',') : '-'}\theight ${venue.height}\tplan ${venue.plan ?? '-'}`);
}
console.log('--- roads by kind ---');
const kinds = {};
for (const road of data.roads) kinds[road.kind] = (kinds[road.kind] ?? 0) + 1;
console.log(kinds);
console.log('--- green by kind ---');
const greens = {};
for (const area of data.green) greens[area.kind] = (greens[area.kind] ?? 0) + 1;
console.log(greens);
console.log('--- gates on boundary ---');
for (const gate of data.gates.filter((item) => item.onBoundary)) console.log(`  ${gate.id}\t${gate.point.join(',')}\t${gate.distanceToBoundary} m`);
console.log('--- landmarks ---');
console.log(data.landmarks.map((landmark) => landmark.label).join(' | '));
console.log('--- extent ---');
console.log(data.extent);
const size = (await readFile(new URL('../src/data/campus-geometry.json', import.meta.url))).length;
console.log(`file size: ${(size / 1024).toFixed(0)} KB`);
