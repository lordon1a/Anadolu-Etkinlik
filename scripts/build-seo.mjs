// Post-build step: turns the event snapshot into static, crawlable pages.
//
//   npm run build          (runs automatically as "postbuild")
//   SITE_URL=https://example.org npm run build
//
// dist/index.html gains a pre-rendered summary inside #root; React replaces it
// as soon as it mounts (the app uses createRoot, not hydrate). Besides that it
// produces dist/etkinlikler/index.html as the calendar hub, dist/etkinlik/<slug>/
// index.html for every event (past ones stay reachable), dist/sitemap.xml and
// dist/robots.txt. When SITE_URL is set, the placeholder URLs that index.html
// ships with are rewritten to that origin.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER_URL = 'https://anadolu-etkinlik.vercel.app';
const siteUrl = (process.env.SITE_URL || PLACEHOLDER_URL).replace(/\/+$/, '');
if (!URL.canParse(`${siteUrl}/`)) throw new Error(`SITE_URL geçersiz: ${process.env.SITE_URL}`);

const root = new URL('../', import.meta.url);
const indexPath = fileURLToPath(new URL('dist/index.html', root));

const SITE_NAME = 'Anadolu Etkinlik';
const CAMPUS = 'Anadolu Üniversitesi Yunus Emre Kampüsü';
const DEFAULT_PLACE = 'Yunus Emre Kampüsü';
const TITLE_LIMIT = 65;
const DESCRIPTION_LIMIT = 155;
const HOME_LIST_LIMIT = 30;
const PAST_LIST_LIMIT = 30;
const RELATED_LIMIT = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const snapshot = JSON.parse(await readFile(new URL('public/events.json', root), 'utf8'));
const indexHtml = await readFile(indexPath, 'utf8').catch(() => {
  throw new Error('dist/index.html bulunamadı; önce vite derlemesini çalıştırın.');
});

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
});
const timeFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const shortDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: 'numeric',
});
const dayFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric',
});
const weekdayFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', weekday: 'long',
});
const monthFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', month: 'long', year: 'numeric',
});
const stampFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
});

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const jsonLd = (value) => JSON.stringify(value, null, 2).replaceAll('<', '\\u003c');
const jsonLdBlock = (value) => `    <script type="application/ld+json">
${jsonLd(value)}
    </script>`;

const displayTitle = (title) => title.replace(/^["“”'\s]+|["“”'\s]+$/g, '');
const upperFirst = (value) => value.charAt(0).toLocaleUpperCase('tr-TR') + value.slice(1);
const slugify = (id) => String(id).toLocaleLowerCase('tr-TR')
  .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
  .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'etkinlik';

/** Cut to at most `max` characters on a word boundary, adding an ellipsis when needed. */
function clamp(text, max) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut.trimEnd()).trimEnd()}…`;
}

/** "2026-09-28" in İstanbul time — a stable key for grouping by day. */
function dayKey(value) {
  const parts = Object.fromEntries(stampFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const monthKey = (value) => dayKey(value).slice(0, 7);
const monthLabel = (key) => upperFirst(monthFormatter.format(new Date(`${key}-01T12:00:00+03:00`)));
const dayLabel = (value) => `${dayFormatter.format(new Date(value))}, ${upperFirst(weekdayFormatter.format(new Date(value)))}`;
const placeOf = (event) => event.place || DEFAULT_PLACE;
const pageUrlOf = (slug) => `${siteUrl}/etkinlik/${slug}/`;

function formatRange(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const sameDay = start.toDateString() === end.toDateString();
  const startText = `${dateFormatter.format(start)} · ${timeFormatter.format(start)}`;
  return sameDay
    ? `${startText}–${timeFormatter.format(end)}`
    : `${startText} – ${dateFormatter.format(end)} ${timeFormatter.format(end)}`;
}

/** Start time, plus the end time when the event runs within a single day. */
function shortTimeRange(event) {
  const start = timeFormatter.format(new Date(event.startAt));
  return dayKey(event.startAt) === dayKey(event.endAt)
    ? `${start}–${timeFormatter.format(new Date(event.endAt))}`
    : start;
}

function posterOf(event) {
  return event.posterUrl && /^https?:\/\//.test(event.posterUrl) ? event.posterUrl : `${siteUrl}/og.png`;
}

function listingItem(event, slugById, meta) {
  return `          <li><a href="/etkinlik/${slugById.get(event.id)}/">${escapeHtml(displayTitle(event.title))}</a><span class="meta">${escapeHtml(meta)}</span></li>`;
}

function breadcrumbs(trail) {
  const items = trail.map(([label, href]) => href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : `<span aria-current="page">${escapeHtml(label)}</span>`);
  return `      <nav class="crumbs" aria-label="Site haritası">${items.join('<span aria-hidden="true">›</span>')}</nav>`;
}

function breadcrumbJsonLd(trail, currentUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([label, href], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: label,
      item: href ? `${siteUrl}${href}` : currentUrl,
    })),
  };
}

const pageStyle = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#edf1eb;color:#18332e;
  font:16px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
a{color:#276f5a}
.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 20px;
  font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#537c6e}
.crumbs a{text-decoration:none}
.crumbs a:hover{text-decoration:underline}
.crumbs [aria-current]{color:#18332e}
.card{background:#fbfdf8;border:1px solid #d5e0d5;border-radius:22px;padding:32px;box-shadow:0 18px 60px rgba(26,57,44,.07)}
h1{font-size:clamp(28px,5vw,40px);line-height:1.12;letter-spacing:-.04em;margin:0 0 20px}
.lede{margin:0 0 24px;color:#4a655b;max-width:64ch}
.block-title{font-size:11.5px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#6b8a7b;margin:0 0 14px}
.month{font-size:19px;letter-spacing:-.02em;margin:30px 0 14px}
.month-block:first-of-type .month{margin-top:6px}
.day{margin:0 0 20px}
.day h3{font-size:13.5px;margin:0 0 10px;color:#375447}
.events{list-style:none;margin:0;padding:0}
.events li{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:space-between;align-items:baseline;
  padding:10px 0;border-top:1px solid #e8eee6}
.events li:first-child{border-top:0}
.events a{font-weight:650}
.events .meta{font-size:12.5px;color:#7a8f82}
.poster{display:block;width:100%;max-height:420px;object-fit:contain;background:#e9dfcd;border-radius:14px;margin:0 0 24px}
dl{display:grid;grid-template-columns:auto 1fr;gap:9px 18px;margin:0 0 26px}
dt{font-size:11px;font-weight:800;letter-spacing:.12em;color:#90a497;padding-top:3px}
dd{margin:0;font-weight:650}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
.actions a{display:inline-flex;align-items:center;min-height:42px;padding:10px 16px;border-radius:10px;
  font-size:14px;font-weight:750;text-decoration:none}
.primary{background:#225e4b;color:#fff}
.secondary{background:#fff;border:1px solid #d4e1d6;color:#305b45}
.related{margin-top:32px;padding-top:24px;border-top:1px solid #d5e0d5}
.archive{margin-top:26px}
.note{font-size:12.5px;color:#849488;margin:0}
footer{margin-top:22px;font-size:12px;color:#70897a;display:flex;flex-wrap:wrap;gap:14px}`;

function eventPage(event, slug, slugById, related) {
  const title = displayTitle(event.title);
  const pageUrl = pageUrlOf(slug);
  const mapUrl = `${siteUrl}/?etkinlik=${encodeURIComponent(event.id)}`;
  const place = placeOf(event);
  const range = formatRange(event.startAt, event.endAt);
  const shortDate = shortDateFormatter.format(new Date(event.startAt));
  const titleSuffix = ` · ${shortDate} · ${SITE_NAME}`;
  const pageTitle = `${clamp(title, TITLE_LIMIT - titleSuffix.length)}${titleSuffix}`;
  const head = `${shortDate} · ${place} · ${CAMPUS}.`;
  const sentence = `${title}${event.organiser ? `, ${event.organiser}` : ''}.`;
  const withTail = `${head} ${sentence} Ayrıntılar ve haritadaki konum Kampüste'de.`;
  const bare = `${head} ${sentence}`;
  const description = withTail.length <= DESCRIPTION_LIMIT ? withTail
    : bare.length <= DESCRIPTION_LIMIT ? bare : clamp(bare, DESCRIPTION_LIMIT);
  const trail = [[SITE_NAME, '/'], ['Etkinlikler', '/etkinlikler/'], [clamp(title, 60), null]];

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

  const relatedSection = related.events.length === 0 ? '' : `      <section class="related" aria-labelledby="benzer">
        <h2 class="block-title" id="benzer">${related.sameContext ? 'Aynı mekândaki ve aynı haftadaki diğer etkinlikler' : 'Diğer etkinlikler'}</h2>
        <ul class="events">
${related.events.map((item) => listingItem(item, slugById, `${shortDateFormatter.format(new Date(item.startAt))} · ${placeOf(item)}`)).join('\n')}
        </ul>
      </section>`;

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#e9f0ea" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
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
${jsonLdBlock(eventJsonLd)}
${jsonLdBlock(breadcrumbJsonLd(trail, pageUrl))}
  </head>
  <body>
    <main>
${breadcrumbs(trail)}
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
${relatedSection}
      <footer>
        <a href="/">Ana sayfa ve harita</a>
        <a href="/etkinlikler/">Tüm etkinlikler</a>
        <a href="https://www.anadolu.edu.tr/etkinlikler" rel="noopener">Resmî etkinlik takvimi</a>
      </footer>
    </main>
  </body>
</html>
`;
}

function hubPage(upcoming, past, slugById) {
  const pageUrl = `${siteUrl}/etkinlikler/`;
  const pageTitle = `Anadolu Üniversitesi etkinlik takvimi · ${SITE_NAME}`;
  const description = clamp(`Anadolu Üniversitesi etkinlik takvimi: Yunus Emre Kampüsü'nde yaklaşan ve geçmiş tüm etkinlikler tarih, saat ve mekân bilgisiyle listelenir.`, DESCRIPTION_LIMIT);
  const trail = [[SITE_NAME, '/'], ['Etkinlikler', null]];

  const months = new Map();
  for (const event of upcoming) {
    const month = monthKey(event.startAt);
    if (!months.has(month)) months.set(month, new Map());
    const days = months.get(month);
    const key = dayKey(event.startAt);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(event);
  }

  const upcomingHtml = [...months].map(([month, days]) => `        <section class="month-block">
          <h2 class="month">${escapeHtml(monthLabel(month))}</h2>
${[...days.values()].map((events) => `          <div class="day">
            <h3>${escapeHtml(dayLabel(events[0].startAt))}</h3>
            <ul class="events">
${events.map((event) => listingItem(event, slugById, `${shortTimeRange(event)} · ${placeOf(event)}`)).join('\n')}
            </ul>
          </div>`).join('\n')}
        </section>`).join('\n');

  const archiveHtml = past.length === 0 ? '' : `      <section class="card archive" aria-labelledby="gecmis">
        <h2 class="block-title" id="gecmis">Geçmiş etkinlikler</h2>
        <ul class="events">
${past.map((event) => listingItem(event, slugById, `${shortDateFormatter.format(new Date(event.startAt))} · ${placeOf(event)}`)).join('\n')}
        </ul>
      </section>
`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Anadolu Üniversitesi etkinlik takvimi',
    url: pageUrl,
    inLanguage: 'tr-TR',
    numberOfItems: upcoming.length + past.length,
    itemListElement: [...upcoming, ...past].map((event, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: displayTitle(event.title),
      url: pageUrlOf(slugById.get(event.id)),
    })),
  };

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#e9f0ea" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:image" content="${escapeHtml(`${siteUrl}/og.png`)}" />
    <meta property="og:image:alt" content="${escapeHtml(`Anadolu Üniversitesi etkinlik takvimi — ${SITE_NAME}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(`${siteUrl}/og.png`)}" />
    <style>${pageStyle}
    </style>
${jsonLdBlock(itemList)}
${jsonLdBlock(breadcrumbJsonLd(trail, pageUrl))}
  </head>
  <body>
    <main>
${breadcrumbs(trail)}
      <h1>Anadolu Üniversitesi etkinlik takvimi</h1>
      <p class="lede">${escapeHtml(SITE_NAME)} bu takvimi Anadolu Üniversitesi'nin herkese açık duyurularından derler. Yaklaşan etkinlikler aya ve güne göre gruplanır; her kayıt kendi sayfasına ve haritadaki konumuna bağlanır.</p>
      <section class="card" aria-label="Yaklaşan etkinlikler">
        <p class="block-title">Yaklaşan etkinlikler</p>
        ${upcoming.length === 0 ? '<p class="note">Şu anda yaklaşan bir etkinlik yok; geçmiş kayıtlar aşağıda listelenir.</p>' : ''}
${upcomingHtml}
      </section>
${archiveHtml}      <footer>
        <a href="/">Ana sayfa ve harita</a>
        <a href="https://www.anadolu.edu.tr/etkinlikler" rel="noopener">Resmî etkinlik takvimi</a>
      </footer>
    </main>
  </body>
</html>
`;
}

const prerenderStyle = `    <style id="seo-prerender">
      /* Shown until React mounts; createRoot replaces this markup. */
      #root .seo-intro{padding:52px 0 18px;max-width:900px}
      #root .seo-kicker{display:flex;align-items:center;gap:10px;margin:0 0 18px;font-size:10px;
        letter-spacing:.18em;font-weight:760;text-transform:uppercase;color:var(--brand-ink,#2c6252)}
      #root .seo-dot{width:8px;height:8px;border-radius:50%;background:var(--live,#e4704f);box-shadow:0 0 0 5px rgba(228,112,79,.15)}
      #root .seo-line{width:23px;height:1px;background:var(--line,#dbe4dc)}
      #root .seo-intro h1{font-family:var(--font-display,system-ui,sans-serif);font-size:clamp(32px,4.6vw,58px);
        line-height:1.03;letter-spacing:-.04em;margin:0;color:var(--ink,#16332c)}
      #root .seo-lede{max-width:62ch;margin:16px 0 0;font-size:15.5px;line-height:1.5;color:var(--muted,#5d7268)}
      #root .seo-list{margin:26px 0 64px;padding:26px 28px;background:var(--surface,#fbfdf8);
        border:1px solid var(--line,#dbe4dc);border-radius:22px;box-shadow:0 18px 60px rgba(26,57,44,.07)}
      #root .seo-list h2{font-family:var(--font-display,system-ui,sans-serif);font-size:15px;letter-spacing:-.01em;
        margin:0 0 6px;color:var(--ink,#16332c)}
      #root .seo-list ul{list-style:none;margin:0;padding:0}
      #root .seo-list li{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:space-between;align-items:baseline;
        padding:11px 0;border-top:1px solid var(--line-soft,#e8eee6);font-size:14.5px}
      #root .seo-list li:first-child{border-top:0}
      #root .seo-list li a{font-weight:560;color:var(--brand-ink,#2c6252)}
      #root .seo-list li a:hover{text-decoration:underline}
      #root .seo-meta{font-size:12.5px;color:var(--muted,#5d7268)}
      #root .seo-more{margin:18px 0 0;font-weight:650}
      #root .seo-more a{color:var(--brand-ink,#2c6252);text-decoration:underline}
    </style>`;

function homePrerender(upcoming, slugById) {
  const items = upcoming.slice(0, HOME_LIST_LIMIT)
    .map((event) => `            <li><a href="/etkinlik/${slugById.get(event.id)}/">${escapeHtml(displayTitle(event.title))}</a><span class="seo-meta"><time datetime="${escapeHtml(event.startAt)}">${escapeHtml(shortDateFormatter.format(new Date(event.startAt)))}</time> · ${escapeHtml(placeOf(event))}</span></li>`)
    .join('\n');
  return `    <div class="site-shell">
      <main>
        <section class="seo-intro" aria-label="Anadolu Üniversitesi etkinlikleri">
          <p class="seo-kicker"><span class="seo-dot"></span>ANADOLU ÜNİVERSİTESİ <span class="seo-line"></span> YUNUS EMRE KAMPÜSÜ</p>
          <h1>Anadolu Üniversitesi etkinlikleri</h1>
          <p class="seo-lede">Eskişehir'deki Anadolu Üniversitesi etkinliklerinin tarih, saat ve mekân bilgileri. Harita, filtreler ve etkileşimli takvim için JavaScript gerekir.</p>
        </section>
        <section class="seo-list" aria-labelledby="seo-upcoming">
          <h2 id="seo-upcoming">Yaklaşan etkinlikler</h2>
          <ul>
${items}
          </ul>
          <p class="seo-more"><a href="/etkinlikler/">Tüm etkinlikler</a></p>
        </section>
      </main>
    </div>`;
}

function relatedFor(event, allEvents) {
  const start = Date.parse(event.startAt);
  const scored = allEvents
    .filter((candidate) => candidate.id !== event.id)
    .map((candidate) => {
      const delta = Math.abs(Date.parse(candidate.startAt) - start);
      return {
        candidate,
        samePlace: candidate.place === event.place || Boolean(event.venueId && candidate.venueId === event.venueId),
        sameWeek: delta <= WEEK_MS,
        delta,
      };
    })
    .filter((item) => item.samePlace || item.sameWeek)
    .sort((a, b) => (Number(b.samePlace) - Number(a.samePlace)) || (a.delta - b.delta));
  const picked = scored.slice(0, RELATED_LIMIT).map((item) => item.candidate);
  const sameContext = picked.length >= 3;
  if (!sameContext) {
    const seen = new Set(picked.map((item) => item.id));
    const nearest = allEvents
      .filter((candidate) => candidate.id !== event.id && !seen.has(candidate.id))
      .sort((a, b) => Math.abs(Date.parse(a.startAt) - start) - Math.abs(Date.parse(b.startAt) - start));
    picked.push(...nearest.slice(0, 3 - picked.length));
  }
  return { events: picked.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)), sameContext };
}

const events = (Array.isArray(snapshot.events) ? [...snapshot.events] : [])
  .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
const now = Date.now();
const upcoming = events.filter((event) => Date.parse(event.endAt) >= now);
const past = events.filter((event) => Date.parse(event.endAt) < now).reverse();

const slugById = new Map();
const usedSlugs = new Set();
for (const event of events) {
  let slug = slugify(event.id);
  while (usedSlugs.has(slug)) slug = `${slug}-1`;
  usedSlugs.add(slug);
  slugById.set(event.id, slug);
}

for (const event of events) {
  const slug = slugById.get(event.id);
  const target = new URL(`dist/etkinlik/${slug}/`, root);
  await mkdir(fileURLToPath(target), { recursive: true });
  await writeFile(new URL('index.html', target), eventPage(event, slug, slugById, relatedFor(event, events)), 'utf8');
}

const hubTarget = new URL('dist/etkinlikler/', root);
await mkdir(fileURLToPath(hubTarget), { recursive: true });
await writeFile(new URL('index.html', hubTarget), hubPage(upcoming, past.slice(0, PAST_LIST_LIMIT), slugById), 'utf8');

const rootPattern = /(<div id="root">)([\s\S]*?)(<\/div>)/;
if (!rootPattern.test(indexHtml)) throw new Error('dist/index.html içinde id="root" bulunamadı.');
if (!indexHtml.includes('</head>')) throw new Error('dist/index.html içinde </head> bulunamadı.');
const homeCount = Math.min(upcoming.length, HOME_LIST_LIMIT);
const homeHtml = indexHtml
  .replace(rootPattern, (match, open, inner, close) => `${open}\n${homePrerender(upcoming, slugById)}\n    ${close}`)
  .replace('</head>', `${prerenderStyle}\n  </head>`);

const lastmod = new Date(snapshot.updatedAt ?? now).toISOString();
const urls = [
  { loc: `${siteUrl}/`, lastmod },
  { loc: `${siteUrl}/etkinlikler/`, lastmod, changefreq: 'hourly', priority: '0.9' },
  ...upcoming.map((event) => ({ loc: pageUrlOf(slugById.get(event.id)), lastmod })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ loc, lastmod: stamp, changefreq, priority }) => [
  '  <url>',
  `    <loc>${escapeHtml(loc)}</loc>`,
  `    <lastmod>${stamp}</lastmod>`,
  changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
  priority ? `    <priority>${priority}</priority>` : null,
  '  </url>',
].filter(Boolean).join('\n')).join('\n')}
</urlset>
`;
await writeFile(new URL('dist/sitemap.xml', root), sitemap, 'utf8');

const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
await writeFile(new URL('dist/robots.txt', root), robots, 'utf8');

const output = siteUrl === PLACEHOLDER_URL ? homeHtml : homeHtml.replaceAll(PLACEHOLDER_URL, siteUrl);
await writeFile(indexPath, output, 'utf8');

console.log(`SEO: ${events.length} etkinlik sayfası, 1 takvim sayfası (${upcoming.length} yaklaşan), ana sayfada ${homeCount} statik bağlantı, sitemap'te ${urls.length} adres, robots.txt yazıldı (${siteUrl}).`);
