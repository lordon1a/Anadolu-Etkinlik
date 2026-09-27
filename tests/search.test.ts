import { describe, expect, it } from 'vitest';
import {
  buildSearchIndex, foldTurkish, matchRanges, searchCampus, scoreText,
} from '../src/lib/search';
import { campusBuildings } from '../src/lib/campus';
import { venues } from '../src/data/campus';

/** Small synthetic index, so the ranking rules are checked without the real data. */
function index(
  venueRows: [id: string, name: string, aliases?: string[]][],
  buildingRows: [id: string, name: string][],
  eventRows: [id: string, title: string, category: string, place: string][],
) {
  return buildSearchIndex({
    venues: venueRows.map(([id, name, aliases = []]) => ({ id, name, shortName: name, aliases, buildingId: null })),
    buildings: buildingRows.map(([id, name]) => ({ id, name })),
    events: eventRows.map(([id, title, category, place]) => ({ id, title, category, place, startAt: '2026-09-27T12:00:00+03:00' })),
  });
}

function titles(query: string, entries: ReturnType<typeof index>): string[] {
  return searchCampus(query, entries).groups.flatMap((group) => group.hits.map((hit) => hit.entry.title));
}

function keys(query: string, entries: ReturnType<typeof index>): string[] {
  return searchCampus(query, entries).groups.flatMap((group) => group.hits.map((hit) => hit.entry.key));
}

describe('Turkish folding', () => {
  it('folds letters and case without changing the text length', () => {
    for (const sample of ['Kütüphane', 'İİBF Binası', 'Çağdaş Sanatlar Müzesi', 'Öğrenci Merkezi', 'Şükrü Saracoğlu']) {
      expect(foldTurkish(sample)).toHaveLength(sample.length);
    }
    expect(foldTurkish('KÜTÜPHANE')).toBe('kutuphane');
    expect(foldTurkish('İİBF')).toBe('iibf');
    expect(foldTurkish('Çağdaş')).toBe('cagdas');
    expect(foldTurkish('Öğrenci')).toBe('ogrenci');
    expect(foldTurkish('Şükrü')).toBe('sukru');
    expect(foldTurkish('Işık')).toBe('isik');
  });

  it('matches the same word written with or without Turkish letters', () => {
    const entries = index(
      [['kutuphane', 'Kütüphane'], ['ogrenci', 'Öğrenci Merkezi']],
      [['b1', 'Çağdaş Sanatlar Müzesi']],
      [],
    );
    for (const query of ['kutuphane', 'KÜTÜPHANE', 'Kütüphane', 'kütüphanE']) {
      expect(titles(query, entries)).toContain('Kütüphane');
    }
    expect(titles('cagdas', entries)).toEqual(['Çağdaş Sanatlar Müzesi']);
    expect(titles('OGRENCI', entries)).toEqual(['Öğrenci Merkezi']);
    expect(titles('muzesi', entries)).toEqual(['Çağdaş Sanatlar Müzesi']);
  });
});

describe('match strength', () => {
  it('scores exact above prefix above word start above inside a word', () => {
    const exact = scoreText('Müze', 'muze');
    const prefix = scoreText('Müze Binası', 'muze');
    const wordStart = scoreText('Çağdaş Müze', 'muze');
    const inside = scoreText('Sanatmüze', 'muze');
    expect(exact).toBe(100);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
    expect(scoreText('Sinema Anadolu', 'kutuphane')).toBe(0);
  });

  it('orders the result list by that strength', () => {
    const entries = index([['a', 'Müze'], ['b', 'Müze Binası'], ['c', 'Çağdaş Müze']], [], []);
    expect(titles('müze', entries)).toEqual(['Müze', 'Müze Binası', 'Çağdaş Müze']);
  });

  it('accepts a multi-word query when every word appears, in any order', () => {
    const entries = index([], [['b1', 'Çağdaş Sanatlar Müzesi']], []);
    expect(titles('cagdas muze', entries)).toEqual(['Çağdaş Sanatlar Müzesi']);
    expect(titles('muze cagdas', entries)).toEqual(['Çağdaş Sanatlar Müzesi']);
    expect(searchCampus('cagdas kutuphane', entries).total).toBe(0);
    expect(searchCampus('', entries).total).toBe(0);
    expect(searchCampus('   ', entries).groups).toEqual([]);
  });
});

describe('searchable data', () => {
  it('finds a venue through its aliases', () => {
    const entries = buildSearchIndex({
      venues: [{
        id: 'sinema', name: 'Sinema Anadolu', shortName: 'Sinema', aliases: ['Sinema Anadolu Sokak'], buildingId: 'way/1',
      }],
      buildings: [],
      events: [],
    });
    expect(titles('sokak', entries)).toEqual(['Sinema Anadolu']);
  });

  it('finds an event through its title, category or place', () => {
    const entries = index([], [], [
      ['e1', 'Genç Kadem Tanıtım Standı', 'Söyleşi', 'Öğrenci Merkezi'],
      ['e2', 'Piyano Günleri', 'Konser', 'Konser Salonu'],
    ]);
    expect(titles('piyano', entries)).toEqual(['Piyano Günleri']);
    expect(titles('soylesi', entries)).toEqual(['Genç Kadem Tanıtım Standı']);
    expect(titles('konser salonu', entries)).toEqual(['Piyano Günleri']);
  });

  it('groups places and events and caps the list at eight', () => {
    const entries = index(
      [['v1', 'Merkez Kafe'], ['v2', 'Kafe Binası']],
      [['b1', 'Kafe Deposu']],
      Array.from({ length: 10 }, (_, number) => [
        `e${number}`, `Kafe Etkinliği ${number}`, 'Söyleşi', 'Kafe',
      ] as [string, string, string, string]),
    );
    const outcome = searchCampus('kafe', entries);
    expect(outcome.total).toBe(8);
    expect(outcome.groups.map((group) => group.label)).toEqual(['Mekânlar', 'Etkinlikler']);
    for (const group of outcome.groups) expect(group.hits.length).toBeGreaterThan(0);
  });
});

describe('highlight ranges', () => {
  it('points at the matched part of the original title', () => {
    expect(matchRanges('Kütüphane', 'kutuphane')).toEqual([[0, 9]]);
    const [range] = matchRanges('Öğrenci Merkezi', 'ogrenci');
    expect('Öğrenci Merkezi'.slice(range[0], range[1])).toBe('Öğrenci');
    expect(matchRanges('Çağdaş Sanatlar Müzesi', 'cagdas muze')).toEqual([[0, 6], [16, 20]]);
    expect(matchRanges('Kütüphane', 'xyz')).toEqual([]);
  });

  it('hands the highlight to the result list', () => {
    const entries = index([['kutuphane', 'Kütüphane']], [], []);
    const [hit] = searchCampus('kutu', entries).groups[0].hits;
    expect(hit.ranges.length).toBeGreaterThan(0);
    expect(hit.entry.title.slice(hit.ranges[0][0], hit.ranges[0][1])).toBe('Kütü');
  });
});

describe('with the generated campus data', () => {
  // Venue buildings are dropped from the building list: the venue entry already
  // covers them, exactly like the search box does.
  const venueBuildings = new Set(venues.map((venue) => venue.osmId).filter(Boolean));
  const entries = buildSearchIndex({
    venues: venues.map((venue) => ({
      id: venue.id, name: venue.name, shortName: venue.shortName, aliases: venue.aliases, buildingId: venue.osmId,
    })),
    buildings: campusBuildings
      .filter((building) => building.name.trim() && !venueBuildings.has(building.id))
      .map((building) => ({ id: building.id, name: building.name })),
    events: [],
  });

  it('finds the library and the museum from folded queries', () => {
    expect(keys('kutuphane', entries)).toContain('venue:kutuphane');
    expect(keys('cagdas sanatlar', entries)[0]).toBe('venue:cagdas-muze');
    expect(keys('ogrenci merkezi', entries)).toContain('venue:ogrenci-merkezi');
    expect(keys('KÜTÜPHANE VE DOKÜMANTASYON', entries)[0]).toBe('venue:kutuphane');
  });

  it('keeps every index key unique, so the list ids stay stable', () => {
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
  });
});
