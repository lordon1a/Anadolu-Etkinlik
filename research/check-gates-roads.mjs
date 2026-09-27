// Does each gate sit on a road that leaves the campus? A gate that is not on a
// road, or a gate whose road never crosses the boundary, is suspicious.
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const ring = data.boundary;
const outside = ([x, z]) => {
  let value = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, az] = ring[i]; const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) value = !value;
  }
  return !value;
};
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

for (const gate of data.gates.filter((item) => item.onBoundary)) {
  const near = data.roads.filter((road) => road.points.some((point) => distance(point, gate.point) < 25));
  console.log(`\n${gate.name || gate.id} [${gate.point.join(', ')}] plan ${gate.plan ?? '-'}`);
  if (!near.length) console.log('   no road within 25 m');
  for (const road of near.slice(0, 4)) {
    const ends = [road.points[0], road.points[road.points.length - 1]];
    const outsideEnds = ends.filter(outside).length;
    console.log(`   ${road.kind} ${road.id} ${road.length} m, ends ${JSON.stringify(ends)}, ends outside boundary: ${outsideEnds}`);
  }
}
