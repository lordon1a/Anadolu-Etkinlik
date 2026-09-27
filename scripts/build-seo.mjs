// Post-build step: turns the event snapshot into static, crawlable pages.
//
//   npm run build          (runs automatically as "postbuild")
//   SITE_URL=https://example.org npm run build
//
// Produces dist/etkinlik/<slug>/index.html for every event (past ones stay
// reachable), dist/sitemap.xml with the home page plus current and upcoming
// events, and dist/robots.txt. When SITE_URL is set, the placeholder URLs that
// index.html ships with are rewritten to that origin.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER_URL = 'https://anadolu-etkinlik.vercel.app';
const siteUrl = (process.env.SITE_URL || PLACEHOLDER_URL).replace(/\/+$/, '');
if (!URL.canParse(`${siteUrl}/`)) throw new Error(`SITE_URL geçersiz: ${process.env.SITE_URL}`);

const root = new URL('../', import.meta.url);
const distDir = fileURLToPath(new URL('dist/', root));
const indexPath = fileURLToPath(new URL('dist/index.html', root));

const snapshot = JSON.parse(await readFile(new URL('public/events.json', root), 'utf8'));
await readFile(indexPath, 'utf8').catch(() => {
  throw new Error('dist/index.html bulunamadı; önce vite derlemesini çalıştırın.');
});

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
});
const timeFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const jsonLd = (value) => JSON.stringify(value, null, 2).replaceAll('<', '\\u003c');

const displayTitle = (title) => title.replace(/^["“”'\s]+|["“”'\s]+$/g, '');
const slugify = (id) => String(id).toLocaleLowerCase('tr-TR')
  .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
  .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'etkinlik';

function formatRange(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const sameDay = start.toDateString() === end.toDateString();
  const startText = `${dateFormatter.format(start)} · ${timeFormatter.format(start)}`;
  return sameDay
    ? `${startText}–${timeFormatter.format(end)}`
    : `${startText} – ${dateFormatter.format(end)} ${timeFormatter.format(end)}`;
}

function posterOf(event) {
  return event.posterUrl && /^https?:\/\//.test(event.posterUrl) ? event.posterUrl : `${siteUrl}/og.png`;
}

const pageStyle = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#edf1eb;color:#18332e;
  font:16px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
a{color:#276f5a}
.kicker{font-size:11px;font-weight:800;letter-spacing:.18em;color:#537c6e;margin:0 0 18px}
.kicker a{text-decoration:none}
.card{background:#fbfdf8;border:1px solid #d5e0d5;border-radius:22px;padding:32px;box-shadow:0 18px 60px rgba(26,57,44,.07)}
h1{font-size:clamp(28px,5vw,40px);line-height:1.12;letter-spacing:-.04em;margin:0 0 20px}
.poster{display:block;width:100%;max-height:420px;object-fit:contain;background:#e9dfcd;border-radius:14px;margin:0 0 24px}
dl{display:grid;grid-template-columns:auto 1fr;gap:9px 18px;margin:0 0 26px}
dt{font-size:11px;font-weight:800;letter-spacing:.12em;color:#90a497;padding-top:3px}
dd{margin:0;font-weight:650}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
.actions a{display:inline-flex;align-items:center;min-height:42px;padding:10px 16px;border-radius:10px;
  font-size:14px;font-weight:750;text-decoration:none}
.primary{background:#225e4b;color:#fff}
.secondary{background:#fff;border:1px solid #d4e1d6;color:#305b45}
.note{font-size:12.5px;color:#849488;margin:0}
footer{margin-top:22px;font-size:12px;color:#70897a;display:flex;flex-wrap:wrap;gap:14px}`;

function eventPage(event, slug) {
  const title = displayTitle(event.title);
  const pageUrl = `${siteUrl}/etkinlik/${slug}/`;
  const mapUrl = `${siteUrl}/?etkinlik=${encodeURIComponent(event.id)}`;
  const place = event.place || 'Yunus Emre Kampüsü';
  const range = formatRange(event.startAt, event.endAt);
  const description = `${title} — ${range}, ${place}. ${event.organiser ? `${event.organiser} tarafından düzenleniyor. ` : ''}Anadolu Üniversitesi Yunus Emre Kampüsü etkinlik haritası Kampüste'de.`;

  const eventJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    description,
    startDate: event.startAt,
    endDate: event.endAt,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: pageUrl,
    sameAs: event.sourceUrl,
    image: [posterOf(event)],
    inLanguage: 'tr-TR',
    location: {
      '@type': 'Place',
      name: place,
      address: {
        '@type': 'PostalAddress',
        name: 'Yunus Emre Kampüsü',
        streetAddress: 'Yunus Emre Kampüsü',
        addressLocality: 'Tepebaşı',
        addressRegion: 'Eskişehir',
        addressCountry: 'TR',
      },
    },
    ...(event.organiser ? { organizer: { '@type': 'Organization', name: event.organiser } } : {}),
  };

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#e9f0ea" />
    <title>${escapeHtml(title)} · Kampüste</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Kampüste" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:image" content="${escapeHtml(posterOf(event))}" />
    <meta property="og:image:alt" content="${escapeHtml(`${title} afişi`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(posterOf(event))}" />
    <style>${pageStyle}
    </style>
    <script type="application/ld+json">
${jsonLd(eventJsonLd)}
    </script>
  </head>
  <body>
    <main>
      <p class="kicker"><a href="/">KAMPÜSTE</a> · YUNUS EMRE KAMPÜSÜ · ESKİŞEHİR</p>
      <article class="card">
        ${event.posterUrl ? `<img class="poster" src="${escapeHtml(event.posterUrl)}" alt="${escapeHtml(`${title} afişi`)}" loading="lazy" />` : ''}
        <h1>${escapeHtml(title)}</h1>
        <dl>
          <dt>TARİH</dt><dd>${escapeHtml(range)}</dd>
          <dt>YER</dt><dd>${escapeHtml(place)}</dd>
          ${event.organiser ? `<dt>DÜZENLEYEN</dt><dd>${escapeHtml(event.organiser)}</dd>` : ''}
          ${event.category ? `<dt>KATEGORİ</dt><dd>${escapeHtml(event.category)}</dd>` : ''}
        </dl>
        <div class="actions">
          <a class="primary" href="${escapeHtml(mapUrl)}">Haritada gör</a>
          <a class="secondary" href="${escapeHtml(event.sourceUrl)}" rel="noopener">Resmî duyuru</a>
        </div>
        <p class="note">Kampüste bağımsız bir öğrenci projesidir; Anadolu Üniversitesi'nin resmî sitesi değildir. Etkinlik bilgileri üniversitenin herkese açık duyurularından derlenir, değişiklik için resmî duyuruyu izleyin.</p>
      </article>
      <footer>
        <a href="/">Ana sayfa ve harita</a>
        <a href="https://www.anadolu.edu.tr/etkinlikler" rel="noopener">Resmî etkinlik takvimi</a>
      </footer>
    </main>
  </body>
</html>
`;
}

const events = Array.isArray(snapshot.events) ? snapshot.events : [];
const usedSlugs = new Set();
let written = 0;

for (const event of events) {
  let slug = slugify(event.id);
  while (usedSlugs.has(slug)) slug = `${slug}-1`;
  usedSlugs.add(slug);
  const target = new URL(`dist/etkinlik/${slug}/`, root);
  await mkdir(fileURLToPath(target), { recursive: true });
  await writeFile(new URL('index.html', target), eventPage(event, slug), 'utf8');
  written++;
}

const now = Date.now();
const lastmod = new Date(snapshot.updatedAt ?? now).toISOString();
const urls = [
  { loc: `${siteUrl}/`, lastmod },
  ...events
    .filter((event) => Date.parse(event.endAt) >= now)
    .map((event) => ({ loc: `${siteUrl}/etkinlik/${slugify(event.id)}/`, lastmod })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ loc, lastmod: stamp }) => `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${stamp}</lastmod>\n  </url>`).join('\n')}
</urlset>
`;
await writeFile(new URL('dist/sitemap.xml', root), sitemap, 'utf8');

const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
await writeFile(new URL('dist/robots.txt', root), robots, 'utf8');

if (siteUrl !== PLACEHOLDER_URL) {
  const index = await readFile(indexPath, 'utf8');
  await writeFile(indexPath, index.replaceAll(PLACEHOLDER_URL, siteUrl), 'utf8');
}

console.log(`SEO: ${written} etkinlik sayfası, sitemap'te ${urls.length} adres, robots.txt yazıldı (${siteUrl}).`);
