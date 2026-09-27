// Where do the faculties the event feed mentions actually sit?
const query = `[out:json][timeout:60];
(
  nwr["name"~"Hukuk",i](39.784,30.487,39.797,30.512);
  nwr["operator"~"Hukuk",i](39.784,30.487,39.797,30.512);
);
out center tags;`;

const response = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'anadolu-kampus-map-research/0.1' },
  body: `data=${encodeURIComponent(query)}`,
});
const data = await response.json();
console.log(`${data.elements.length} elements`);
for (const element of data.elements) {
  const point = element.center ?? { lat: element.lat, lon: element.lon };
  console.log(`${element.type}/${element.id}\t${element.tags?.name}\t${point?.lat?.toFixed(6)},${point?.lon?.toFixed(6)}\t${element.tags?.amenity ?? element.tags?.building ?? ''}\t${element.tags?.['addr:street'] ?? ''}`);
}
console.log('--- campus frames (local metres, x east / z south) ---');
const ORIGIN = [30.5006767, 39.79189615];
for (const element of data.elements) {
  const point = element.center ?? { lat: element.lat, lon: element.lon };
  if (!point) continue;
  const x = Math.round((point.lon - ORIGIN[0]) * 85540);
  const z = Math.round((ORIGIN[1] - point.lat) * 111132);
  console.log(`${element.tags?.name}\tlocal [${x}, ${z}]\t(negative z = north)`);
}
