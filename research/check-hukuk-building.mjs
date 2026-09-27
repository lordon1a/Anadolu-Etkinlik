// Which building does the official plan's law-faculty marker land on or next to?
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../src/data/campus-geometry.json', import.meta.url), 'utf8'));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const targets = {
  'plan 27 Hukuk': [132, -148],
  'OSM node (Hukuk)': [127, -181],
};
const named = new Set(['Rektörlük', 'Öğrenci Merkezi', 'Atatürk Kültür ve Sanat Merkezi', 'Sinema Anadolu',
  'Kütüphane', 'Anadolu Haber- Radyo A', 'Psikolojik Danışma ve Rehberlik Servisi', 'ETV', 'Misafirhane']);

for (const [label, target] of Object.entries(targets)) {
  console.log(`\n${label} -> [${target.join(', ')}]`);
  for (const building of data.buildings.map((item) => ({ item, d: distance(item.center, target) }))
    .sort((a, b) => a.d - b.d).slice(0, 7)) {
    console.log(`   ${Math.round(building.d)} m  ${building.item.id}  ${(building.item.name || '(isimsiz)').padEnd(38)} ${building.item.area} m2 [${building.item.center.join(',')}]${named.has(building.item.name) ? '  <-- adlı' : ''}`);
  }
}
