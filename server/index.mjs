import express from 'express';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refreshSnapshot } from '../scripts/event-source.mjs';

const app = express();
const snapshotPath = fileURLToPath(new URL('../public/events.json', import.meta.url));
const distPath = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';
let latest = null;

async function loadSnapshot() {
  try { latest = JSON.parse(await readFile(snapshotPath, 'utf8')); } catch { /* Refresh will retry. */ }
}

async function refresh() {
  try { latest = await refreshSnapshot(); }
  catch (error) { console.error(`Etkinlik güncellemesi başarısız: ${error.message}`); }
}

await loadSnapshot();
await refresh();
setInterval(refresh, 2 * 60 * 60 * 1000).unref();

app.get('/api/events', (_req, res) => {
  if (!latest) return res.status(503).json({ error: 'Etkinlik verisi henüz hazır değil.' });
  res.set('Cache-Control', 'public, max-age=300');
  return res.json(latest);
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*path}', (_req, res) => res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))));
}

app.listen(port, host, () => console.log(`Kampüste: http://${host}:${port}`));
