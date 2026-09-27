import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchVenue, parseDateRange, parseDetail, parseListing, parseTurkishDate } from '../scripts/event-source.mjs';

const venues = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));

// Reduced excerpts of the public Anadolu event listing and detail markup.
const listing = `<div class="event">
  <div class="headLine"><a href="/etkinlikler/ogrenci-kulupleri-stant-senligi-1790074374">"Öğrenci Kulüpleri Stant Şenliği"</a></div>
  <div class="calendar">Tarih: 21 Eylül 2026 09:00 - 25 Eylül 2026 17:00</div>
  <div class="category"><a href="/etkinlikler/kategori/senlik">Şenlik</a></div>
</div>`;

const detail = `<div class="content"><h2>"Öğrenci Kulüpleri Stant Şenliği"</h2>
  <figure><img src="/uploads/anadolu/images/etkinlik/6ab25de48f0b8.jpg"></figure>
  <div class="contact">
    <div class="set titleBottom">
      <div class="item long"><i class="organiser"></i>Öğrenci Kulüpleri Koordinatörlüğü</div>
      <div class="item long"><i class="tag"></i><a href="/etkinlikler/kategori/senlik">Şenlik</a></div>
    </div>
    <div class="set">
      <div class="item"><div class="coloredBg">Başlangıç Tarihi</div> 21 Eylül 2026 09:00</div>
      <div class="item"><div class="coloredBg">Bitiş Tarihi</div> 25 Eylül 2026 17:00</div>
      <div class="item"><div class="coloredBg location">Yer</div> Sinema Anadolu Sokak</div>
    </div>
  </div>
</div>`;

describe('official event markup', () => {
  it('reads the dated listing link', () => {
    expect(parseListing(listing)).toEqual([{
      sourceUrl: 'https://www.anadolu.edu.tr/etkinlikler/ogrenci-kulupleri-stant-senligi-1790074374',
      title: '"Öğrenci Kulüpleri Stant Şenliği"',
      startAt: '2026-09-21T09:00:00+03:00',
      endAt: '2026-09-25T17:00:00+03:00',
    }]);
  });

  it('reads the detail and matches the street in front of the cinema', () => {
    const sourceUrl = 'https://www.anadolu.edu.tr/etkinlikler/ogrenci-kulupleri-stant-senligi-1790074374';
    expect(parseDetail(detail, sourceUrl, venues)).toMatchObject({
      title: '"Öğrenci Kulüpleri Stant Şenliği"',
      category: 'Şenlik',
      place: 'Sinema Anadolu Sokak',
      venueId: 'sinema',
      organiser: 'Öğrenci Kulüpleri Koordinatörlüğü',
      posterUrl: 'https://www.anadolu.edu.tr/uploads/anadolu/images/etkinlik/6ab25de48f0b8.jpg',
    });
  });

  it('rejects impossible dates and uncertain places', () => {
    expect(parseTurkishDate('31 Şubat 2026 10:00')).toBeNull();
    expect(parseTurkishDate('25 Eylül 2026 25:00')).toBeNull();
    expect(parseDateRange('Tarih: 2 Ekim 2026 15:00 - 2 Ekim 2026 19:00')).toEqual({
      startAt: '2026-10-02T15:00:00+03:00', endAt: '2026-10-02T19:00:00+03:00',
    });
    expect(matchVenue('Yunus Emre Yazı Sanatları Müzesi', venues)).toBeNull();
    expect(matchVenue('KYK ve Bankamatikler Önü', venues)).toBe('kyk-bankamatikler');
  });
});
