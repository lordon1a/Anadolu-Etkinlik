// Renders the social share image and the app icons with a local Chrome build.
//
//   CHROME_PATH="C:\...\chrome.exe" node scripts/make-og.mjs
//
// Outputs: public/og.png (1200x630), public/icon-512.png, public/apple-touch-icon.png.
// The committed images are regenerated only when the brand art changes; the build
// does not depend on Chrome.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const fontDir = fileURLToPath(new URL('../node_modules/@fontsource-variable/', import.meta.url));

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chromePath) throw new Error('Chrome bulunamadı; CHROME_PATH ortam değişkeniyle yol verin.');

async function fontFace(family, file, weight) {
  const data = await readFile(join(fontDir, family, 'files', `${family}-${file}.woff2`));
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}`;
}

const fonts = [
  await fontFace('inter-tight', 'latin-wght-normal', '100 900'),
  await fontFace('source-serif-4', 'latin-wght-normal', '200 900'),
  await fontFace('inter-tight', 'latin-ext-wght-normal', '100 900'),
  await fontFace('source-serif-4', 'latin-ext-wght-normal', '200 900'),
].join('');

const brandGlyph = `
  <svg viewBox="0 0 512 512" role="img" aria-label="Kampüste">
    <rect width="512" height="512" rx="112" fill="#204b43"/>
    <path d="M 120 300 A 136 136 0 1 1 392 300" fill="none" stroke="#e9f0d4" stroke-width="34" stroke-linecap="round"/>
    <circle cx="256" cy="392" r="30" fill="#e77b55"/>
  </svg>`;

const mapArt = `
  <svg viewBox="0 0 390 390" aria-hidden="true">
    <rect width="390" height="390" rx="26" fill="#eaf3e8"/>
    <path d="M-10 300 C 90 250, 140 330, 250 290 S 380 330, 420 300" fill="none" stroke="#fffdf5" stroke-width="14" stroke-linecap="round"/>
    <path d="M 60 -10 C 90 80, 40 160, 96 250 S 150 350, 130 410" fill="none" stroke="#fffdf5" stroke-width="11" stroke-linecap="round"/>
    <path d="M 250 -10 C 236 90, 300 150, 268 230 S 250 330, 286 400" fill="none" stroke="#fffdf5" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="122" cy="118" rx="52" ry="33" fill="#bcd9e2"/>
    <g fill="#cfe0d2">
      <rect x="176" y="86" width="66" height="44" rx="5"/>
      <rect x="262" y="70" width="46" height="60" rx="5"/>
      <rect x="196" y="168" width="82" height="52" rx="5"/>
      <rect x="292" y="196" width="58" height="40" rx="5" fill="#c3d8c9"/>
      <rect x="150" y="248" width="54" height="38" rx="5" fill="#c3d8c9"/>
    </g>
    <g fill="#a9c9b0">
      <circle cx="70" cy="220" r="11"/><circle cx="98" cy="252" r="8"/>
      <circle cx="330" cy="120" r="9"/><circle cx="150" cy="70" r="7"/>
      <circle cx="56" cy="330" r="9"/><circle cx="340" cy="300" r="7"/>
    </g>
    <g transform="translate(238 148)">
      <path d="M0 -44 C 24 -44, 40 -26, 40 -4 C 40 22, 0 52, 0 52 C 0 52, -40 22, -40 -4 C -40 -26, -24 -44, 0 -44 Z" fill="#e97657" stroke="#fffdf6" stroke-width="7"/>
      <circle cx="0" cy="-6" r="13" fill="#fffdf6"/>
    </g>
  </svg>`;

const page = (body, width, height, extra = '') => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><style>
${fonts}
*{box-sizing:border-box;margin:0}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{font-family:'inter-tight';background:#edf1eb;color:#18332e}
${extra}
</style></head><body>${body}</body></html>`;

const cardCss = `
.shell{position:relative;width:1200px;height:630px;padding:74px 76px;display:flex;align-items:center;gap:60px;
  background:radial-gradient(circle at 92% -6%,#d6e9dd 0,transparent 46%),radial-gradient(circle at -8% 108%,#e2ecdf 0,transparent 42%),#edf1eb}
.copy{width:612px;flex:0 0 612px}
.kicker{display:flex;align-items:center;gap:13px;font-size:14px;font-weight:800;letter-spacing:.2em;color:#537c6e}
.kicker i{width:11px;height:11px;border-radius:50%;background:#ec7a58;box-shadow:0 0 0 6px rgba(236,122,88,.18)}
.kicker s{width:30px;height:1px;background:#b9c9bd;text-decoration:none}
h1{margin:26px 0 0;font-size:126px;line-height:.94;letter-spacing:-.055em;font-weight:850}
h1 span{color:#e77b55}
.sub{margin:20px 0 0;font-family:'source-serif-4';font-weight:450;font-size:47px;line-height:1.16;letter-spacing:-.028em;color:#467d6d;max-width:560px}
.rule{width:96px;height:4px;border-radius:2px;background:#c7d8c9;margin:34px 0 26px}
.meta{font-size:16px;font-weight:750;color:#4c7763;letter-spacing:-.01em}
.note{margin-top:9px;font-size:14px;font-weight:650;color:#849488}
.card{flex:1;height:430px;border-radius:34px;border:1px solid #d5e0d5;background:#f8faf5;padding:19px;
  box-shadow:0 30px 80px rgba(26,57,44,.13);display:flex}
.card svg{width:100%;height:100%;display:block}
.mark{position:absolute;left:76px;top:74px;width:1px;height:1px;opacity:0}`;

const iconCss = `
body{background:transparent}
svg{width:${'{SIZE}'}px;height:${'{SIZE}'}px;display:block}`;

const ogHtml = page(
  `<div class="shell">
     <div class="copy">
       <p class="kicker"><i></i>ANADOLU ÜNİVERSİTESİ<s></s>ESKİŞEHİR</p>
       <h1>Kampüste<span>.</span></h1>
       <p class="sub">— Yunus Emre Kampüsü etkinlik haritası</p>
       <div class="rule"></div>
       <p class="meta">Etkinlikleri minyatür kampüs haritasında keşfet</p>
       <p class="note">Bağımsız öğrenci projesi · Resmî duyurulardan derlenir</p>
     </div>
     <div class="card">${mapArt}</div>
   </div>`,
  1200,
  630,
  cardCss,
);

const iconHtml = (size) => page(brandGlyph, size, size, iconCss.replaceAll('{SIZE}', String(size)));

async function screenshot(html, file, width, height) {
  const work = await mkdtemp(join(tmpdir(), 'kampuste-og-'));
  const htmlPath = join(work, 'page.html');
  const target = join(publicDir, file);
  await writeFile(htmlPath, html, 'utf8');
  await new Promise((resolve, reject) => {
    const child = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      '--virtual-time-budget=4000',
      `--user-data-dir=${join(work, 'chrome')}`,
      `--window-size=${width},${height}`,
      `--screenshot=${target}`,
      new URL(`file:///${htmlPath.replaceAll('\\', '/')}`).toString(),
    ], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Chrome çıkış kodu ${code}`)));
  });
  await rm(work, { recursive: true, force: true });
  console.log(`${file} yazıldı (${width}x${height})`);
}

await screenshot(ogHtml, 'og.png', 1200, 630);
await screenshot(iconHtml(512), 'icon-512.png', 512, 512);
await screenshot(iconHtml(180), 'apple-touch-icon.png', 180, 180);
