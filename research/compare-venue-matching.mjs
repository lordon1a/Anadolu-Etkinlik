// Compares venue matching between the previous venue table (kept as a fixture)
// and the new one, so a regeneration cannot silently re-route events.
import { readFileSync } from 'node:fs';
import { matchVenue } from '../scripts/event-source.mjs';

const previous = JSON.parse(readFileSync(new URL('./venues-before.json', import.meta.url), 'utf8'));
const next = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));
const snapshot = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url), 'utf8'));

const places = [...new Set(snapshot.events.map((event) => event.place))].sort((a, b) => a.localeCompare(b, 'tr'));
let changed = 0;
for (const place of places) {
  const before = matchVenue(place, previous);
  const after = matchVenue(place, next);
  if (before !== after) changed += 1;
  console.log(`${before === after ? '  ' : '->'} ${place}\n     ${before} => ${after}`);
}
console.log(`\n${places.length} distinct places, ${changed} changed`);
