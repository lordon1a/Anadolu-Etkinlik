import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseUrl = 'https://www.anadolu.edu.tr';
const snapshotPath = fileURLToPath(new URL('../public/events.json', import.meta.url));
const venuePath = fileURLToPath(new URL('../data/venues.json', import.meta.url));
const months = new Map(Object.entries({
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
  temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
}));

export function normalizeText(value = '') {
  return value.toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
    .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function parseTurkishDate(value) {
  const clean = normalizeText(value);
  const match = clean.match(/(\d{1,2}) ([a-z]+) (\d{4}) (\d{1,2}) (\d{2})/);
  if (!match) return null;
  const [, day, monthName, year, hour, minute] = match;
  const month = months.get(monthName);
  if (!month) return null;
  const numericDay = Number(day);
  const numericYear = Number(year);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const calendarDate = new Date(Date.UTC(numericYear, month - 1, numericDay));
  if (calendarDate.getUTCFullYear() !== numericYear || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== numericDay || numericHour > 23 || numericMinute > 59) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00+03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function parseDateRange(value) {
  const matches = [...value.matchAll(/\d{1,2}\s+\S+\s+\d{4}\s+\d{1,2}:\d{2}/g)];
  const startAt = matches[0] ? parseTurkishDate(matches[0][0]) : null;
  const endAt = matches[1] ? parseTurkishDate(matches[1][0]) : null;
  return { startAt, endAt };
}

export function matchVenue(place, venues) {
  const value = normalizeText(place);
  if (!value) return null;
  const matches = venues.flatMap((venue) => venue.aliases.map((alias) => ({
    id: venue.id, alias: normalizeText(alias),
  }))).sort((a, b) => b.alias.length - a.alias.length);
  return matches.find(({ alias }) => value === alias || value.startsWith(`${alias} `) || value.endsWith(` ${alias}`))?.id ?? null;
}

export function parseListing(html) {
  const $ = cheerio.load(html);
  return $('.event').map((_, element) => {
    const node = $(element);
    const link = node.find('.headLine a[href^="/etkinlikler/"]').first();
    const href = link.attr('href');
    if (!href) return null;
    const dates = parseDateRange(node.find('.calendar').text());
    return {
      sourceUrl: new URL(href, baseUrl).toString(),
      title: link.text().trim(),
      ...dates,
    };
  }).get().filter(Boolean);
}

export function parseDetail(html, sourceUrl, venues) {
  const $ = cheerio.load(html);
  const title = $('h2').filter((_, element) => $(element).closest('.content').length > 0).first().text().trim()
    || $('h2').first().text().trim();
  const items = $('.contact .item');
  const labeledValue = (label) => {
    const item = items.filter((_, element) => normalizeText($(element).find('.coloredBg').first().text()) === normalizeText(label)).first();
    return item.length ? item.clone().children().remove().end().text().replace(/\s+/g, ' ').trim() : '';
  };
  const startAt = parseTurkishDate(labeledValue('Başlangıç Tarihi'));
  const endAt = parseTurkishDate(labeledValue('Bitiş Tarihi'));
  const place = labeledValue('Yer');
  const organiser = $('.contact .set.titleBottom .item.long').first().text().replace(/\s+/g, ' ').trim();
  const category = $('.contact .set.titleBottom .item.long a[href*="/kategori/"]').first().text().trim();
  const posterPath = $('figure img[src*="/etkinlik/"]').first().attr('src');
  const id = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!id || !title || !startAt || !endAt || Date.parse(endAt) < Date.parse(startAt)) return null;
  return {
    id, title, startAt, endAt, place,
    venueId: matchVenue(place, venues),
    organiser, category: category || 'Diğer',
    posterUrl: posterPath ? new URL(posterPath, baseUrl).toString() : null,
    sourceUrl,
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AnadoluEtkinlikKampusu/0.1 (independent student project; public events)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshSnapshot({ force = false, maxPages = 8 } = {}) {
  let previous = null;
  try { previous = JSON.parse(await readFile(snapshotPath, 'utf8')); } catch { /* No snapshot yet. */ }
  const age = previous?.updatedAt ? Date.now() - Date.parse(previous.updatedAt) : Infinity;
  if (!force && age < 2 * 60 * 60 * 1000) return previous;

  const venues = JSON.parse(await readFile(venuePath, 'utf8'));
  const horizon = Date.now() + 90 * 24 * 60 * 60 * 1000;
  const current = Date.now() - 24 * 60 * 60 * 1000;
  const cards = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const listing = parseListing(await fetchHtml(`${baseUrl}/etkinlikler?page=${page}`));
    if (!listing.length) break;
    for (const card of listing) {
      if (!card.startAt || Date.parse(card.startAt) > horizon) continue;
      if (card.endAt && Date.parse(card.endAt) < current) continue;
      cards.set(card.sourceUrl, card);
    }
    if (listing.every((card) => card.startAt && Date.parse(card.startAt) > horizon)) break;
    await pause(250);
  }
  if (!cards.size) throw new Error('Resmî listede okunabilir etkinlik bulunamadı; mevcut veri korundu.');

  const events = [];
  let failed = 0;
  for (const card of cards.values()) {
    try {
      const event = parseDetail(await fetchHtml(card.sourceUrl), card.sourceUrl, venues);
      if (event && Date.parse(event.endAt) >= current && Date.parse(event.startAt) <= horizon) events.push(event);
      else failed++;
    } catch (error) {
      failed++;
      console.warn(`Etkinlik ayrıntısı alınamadı: ${card.sourceUrl} (${error.message})`);
    }
    await pause(200);
  }
  if (!events.length || failed > cards.size / 2) throw new Error('Etkinlik ayrıntılarının çoğu okunamadı; mevcut veri korundu.');

  const unique = new Map();
  for (const event of events) {
    const key = [normalizeText(event.title), event.startAt, event.endAt, normalizeText(event.place)].join('|');
    if (!unique.has(key)) unique.set(key, event);
  }
  const snapshot = {
    source: `${baseUrl}/etkinlikler`,
    updatedAt: new Date().toISOString(),
    timezone: 'Europe/Istanbul',
    events: [...unique.values()].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
  };
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`${snapshot.events.length} etkinlik güncellendi; ${failed} ayrıntı okunamadı.`);
  return snapshot;
}
