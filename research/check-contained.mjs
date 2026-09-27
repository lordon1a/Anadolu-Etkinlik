// Every drawn feature must sit inside the campus boundary polygon; anything
// sticking out is either a bad projection or a bad inclusion rule.
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const ring = data.boundary;
const inside = ([x, z]) => {
  let value = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, az] = ring[i]; const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) value = !value;
  }
  return value;
};

const report = (label, features) => {
  const outside = [];
  for (const feature of features) {
    const bad = feature.points.filter((point) => !inside(point));
    if (bad.length) outside.push(`${label} ${feature.id} ${feature.name || ''}: ${bad.length}/${feature.points.length} vertices outside, first ${JSON.stringify(bad[0])}`);
  }
  console.log(`${label}: ${features.length} features, ${outside.length} with vertices outside the boundary`);
  outside.slice(0, 12).forEach((line) => console.log('   ' + line));
};

report('buildings', data.buildings);
report('green', data.green);
report('water', data.water);

console.log('\nboundary ring, north-west quadrant (x < 250, z < 0), in ring order:');
ring.forEach(([x, z], index) => {
  if (x < 250 && z < 0) console.log(`  #${index} ${x}, ${z}`);
});
console.log('\ntotal ring length:', ring.length);
