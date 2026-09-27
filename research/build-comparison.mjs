// Builds a local side-by-side check: our generated 2D map next to the same
// area rendered from OpenStreetMap's own tiles, so venue/building placement can
// be compared objectively. Writes research/compare/index.html.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const Z = 16;
const ORIGIN = { lat: 39.7918961, lon: 30.5006767 };
const METRES_PER_DEG_LAT = 111132;
const METRES_PER_DEG_LON = 85540;

const data = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const { minX, maxX, minZ, maxZ } = data.extent;

function lonLatToPixel(lat, lon, zoom) {
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return [x, y];
}

// Our local metres -> tile pixel space (z south+, so north is the smaller latitude).
const toPixels = ([x, z]) => lonLatToPixel(
  ORIGIN.lat - z / METRES_PER_DEG_LAT,
  ORIGIN.lon + x / METRES_PER_DEG_LON,
  Z,
);

const corners = [
  toPixels([minX, minZ]), toPixels([maxX, minZ]), toPixels([minX, maxZ]), toPixels([maxX, maxZ]),
];
const left = Math.min(...corners.map((point) => point[0]));
const right = Math.max(...corners.map((point) => point[0]));
const top = Math.min(...corners.map((point) => point[1]));
const bottom = Math.max(...corners.map((point) => point[1]));
const tileLeft = Math.floor(left / 256);
const tileRight = Math.floor(right / 256);
const tileTop = Math.floor(top / 256);
const tileBottom = Math.floor(bottom / 256);

const tiles = [];
for (let tx = tileLeft; tx <= tileRight; tx += 1) {
  for (let ty = tileTop; ty <= tileBottom; ty += 1) {
    tiles.push({ tx, ty, url: `https://tile.openstreetmap.org/${Z}/${tx}/${ty}.png` });
  }
}

const osmWidth = (tileRight - tileLeft + 1) * 256;
const osmHeight = (tileBottom - tileTop + 1) * 256;
const offsetX = left - tileLeft * 256;
const offsetY = top - tileTop * 256;

const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>Yerleşim karşılaştırması — bizim harita vs OpenStreetMap</title>
<style>
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #1d2b26; color: #eef4ee; }
  header { padding: 14px 20px; }
  h1 { font-size: 16px; margin: 0 0 6px; }
  p { margin: 0; color: #b7c8bf; font-size: 12px; }
  .panes { display: flex; gap: 16px; padding: 0 20px 20px; align-items: flex-start; }
  .pane { background: #26362f; border-radius: 10px; padding: 10px; }
  .pane h2 { font-size: 12px; margin: 0 0 8px; letter-spacing: .08em; text-transform: uppercase; color: #9fd0b6; }
  .stack { position: relative; }
  .tiles { position: relative; }
  .tiles img { position: absolute; image-rendering: auto; }
  iframe { border: 0; border-radius: 6px; display: block; background: #e4ece1; }
  .legend { font-size: 11px; color: #b7c8bf; padding-top: 8px; }
</style>
</head>
<body>
<header>
  <h1>Aynı alan, aynı ölçek — solda bizim 2B haritamız, sağda OpenStreetMap'in kendi çizimi</h1>
  <p>Kampüs sınırı ${Math.round(maxX - minX)} × ${Math.round(maxZ - minZ)} m. Sağdaki görüntü ${tiles.length} OSM karosu (z${Z}); karo genişliği ${osmWidth}px, kırpma ${Math.round(offsetX)}, ${Math.round(offsetY)}.
     Binaların ve mekân işaretlerinin örtüşmesi bu iki panelde karşılaştırılır. © OpenStreetMap contributors (ODbL).</p>
</header>
<div class="panes">
  <div class="pane">
    <h2>Bizim harita (OSM geometrisi)</h2>
    <div class="stack">
      <iframe src="./our-map.svg" width="${Math.round(osmWidth)}" height="${Math.round(osmHeight)}" title="Bizim 2B harita"></iframe>
    </div>
    <div class="legend">Etiketler mekân adları; gri alanlar bina ayak izleri.</div>
  </div>
  <div class="pane">
    <h2>OpenStreetMap (karo)</h2>
    <div class="tiles" style="width:${Math.round(osmWidth)}px;height:${Math.round(osmHeight)}px">
      ${tiles.map(({ tx, ty, url }) => `<img src="${url}" alt="" style="left:${(tx - tileLeft) * 256}px;top:${(ty - tileTop) * 256}px" width="256" height="256">`).join('\n      ')}
      <svg width="${Math.round(osmWidth)}" height="${Math.round(osmHeight)}" style="position:absolute;left:0;top:0;pointer-events:none">
        ${data.boundary.map(([x, z]) => {
    const [px, py] = toPixels([x, z]);
    return [px - tileLeft * 256, py - tileTop * 256];
  }).map(([px, py], index, list) => {
    const [nx, ny] = list[(index + 1) % list.length];
    return `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#d33" stroke-width="2" fill="none"/>`;
  }).join('\n        ')}
        ${data.venues.filter((venue) => venue.center).map((venue) => {
    const [px, py] = toPixels(venue.center);
    return `<circle cx="${(px - tileLeft * 256).toFixed(1)}" cy="${(py - tileTop * 256).toFixed(1)}" r="6" fill="#ffd166" stroke="#7a4a00" stroke-width="2"/>
          <text x="${(px - tileLeft * 256 + 9).toFixed(1)}" y="${(py - tileTop * 256 + 4).toFixed(1)}" font-size="13" font-weight="700" fill="#5a3300" stroke="#fff" stroke-width="3" paint-order="stroke">${venue.shortName}</text>`;
  }).join('\n        ')}
      </svg>
    </div>
    <div class="legend">Kırmızı çizgi: bizim kampüs sınırımız (OSM way/269147024). Sarı noktalar: bizim mekân merkezlerimiz.</div>
  </div>
</div>
</body>
</html>
`;
const fs = await import('node:fs/promises');

await mkdir(new URL('./compare/', import.meta.url), { recursive: true });

// Our map as a standalone SVG at tile scale, so both panes line up.
const px = (x) => ((x - left) ).toFixed(1);
const py = (z) => ((z - 0)).toFixed(1);
const localToPixel = ([x, z]) => {
  const [tx, ty] = toPixels([x, z]);
  return [tx - left, ty - top];
};
const polygon = (points) => points.map((point) => localToPixel(point).map((v) => v.toFixed(1)).join(',')).join(' ');
const svgWidth = right - left;
const svgHeight = bottom - top;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(svgWidth)}" height="${Math.round(svgHeight)}" viewBox="0 0 ${svgWidth.toFixed(1)} ${svgHeight.toFixed(1)}">
  <rect width="100%" height="100%" fill="#e4ece1"/>
  <polygon points="${polygon(data.boundary)}" fill="#d7e3c9" stroke="#bccdb2" stroke-width="3"/>
  ${data.green.map((area) => `<polygon points="${polygon(area.points)}" fill="${area.kind === 'forest' ? '#a9c79c' : area.kind === 'parking' ? '#c5c7c2' : '#bdd6ac'}"/>`).join('\n  ')}
  ${data.water.map((area) => `<polygon points="${polygon(area.points)}" fill="#8fc4cd"/>`).join('\n  ')}
  ${data.roads.map((road) => `<polyline points="${road.points.map((point) => localToPixel(point).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${road.kind === 'street' ? '#b9b6ac' : road.kind === 'service' ? '#c3c0b6' : '#cdc9bb'}" stroke-width="${road.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n  ')}
  ${data.buildings.map((building) => `<polygon points="${polygon(building.points)}" fill="${building.color}" stroke="#fbfcf6" stroke-width="1.4"/>`).join('\n  ')}
  ${data.venues.filter((venue) => venue.center).map((venue) => {
  const [vx, vy] = localToPixel(venue.center);
  return `<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="5" fill="#e9762f" stroke="#7a2f00" stroke-width="2"/>
  <text x="${(vx + 8).toFixed(1)}" y="${(vy + 4).toFixed(1)}" font-size="13" font-weight="700" fill="#4a2400" stroke="#fffdf5" stroke-width="3" paint-order="stroke">${venue.shortName}</text>`;
}).join('\n  ')}
</svg>
`;

await writeFile(new URL('./compare/our-map.svg', import.meta.url), svg, 'utf8');
await writeFile(new URL('./compare/index.html', import.meta.url), html, 'utf8');
console.log(`comparison written: ${Math.round(osmWidth)}x${Math.round(osmHeight)} px, ${tiles.length} OSM tiles (z${Z})`);
void fs; void px; void py;
