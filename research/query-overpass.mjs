// Live OSM check for venues the 26.09.2026 extract could not resolve by name
// (Kongre Merkezi, Salon 2003 / Koral Çalgan, Hukuk Fakültesi, kapılar).
const query = `[out:json][timeout:60];
(
  nwr["name"~"Kongre|Salon 2003|Koral|Hukuk|Kapı",i](39.784,30.487,39.797,30.512);
  nwr["building"="civic"](39.784,30.487,39.797,30.512);
  nwr[~"^name$"~"Salon",i](39.784,30.487,39.797,30.512);
);
out center tags;`;

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'anadolu-kampus-map-research/0.1' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) { console.log(`${endpoint} -> HTTP ${response.status}`); continue; }
    const data = await response.json();
    console.log(`${endpoint} -> ${data.elements.length} elements`);
    for (const element of data.elements) {
      const point = element.center ?? { lat: element.lat, lon: element.lon };
      console.log(`${element.type}/${element.id}\t${element.tags?.name ?? '(isimsiz)'}\t${point?.lat?.toFixed(6)},${point?.lon?.toFixed(6)}\t${JSON.stringify(element.tags)}`);
    }
  } catch (error) {
    console.log(`${endpoint} -> ${error.message}`);
  }
}
