// Campus search: venues, OSM-labelled buildings and events in one ranked list.
//
// Pure and dependency-free (no React, no DOM), so the matching rules are
// unit-tested in tests/search.test.ts.
//
// Turkish matching folds dotted/dotless i, ş, ç, ğ, ö, ü and â/î/û onto their
// plain counterparts, so "kutuphane", "Kütüphane" and "KÜTÜPHANE" all match.
// Order of a hit: exact > prefix > word start > contains; a multi-word query
// needs every word somewhere in the text, an ordered phrase scoring higher.

export type SearchKind = 'venue' | 'building' | 'event';

export type SearchEntry = {
  /** Stable id for React keys and `aria-activedescendant`. */
  key: string;
  kind: SearchKind;
  /** Shown in the list; the matched part of it is highlighted. */
  title: string;
  /** Small line under the title: what the entry is. */
  detail: string;
  /** Extra searchable text that is not displayed: aliases, category, place. */
  extra: string;
  /** Tie-breaker between equal scores; lower comes first. */
  rank: number;
  venueId?: string;
  buildingId?: string;
  eventId?: string;
};

export type SearchHit = {
  entry: SearchEntry;
  score: number;
  /** Match ranges in `title`, for the highlight. */
  ranges: [number, number][];
};

export type SearchGroup = { key: 'places' | 'events'; label: string; hits: SearchHit[] };

export type SearchOutcome = { groups: SearchGroup[]; total: number };

const FOLD: Record<string, string> = {
  ı: 'i', İ: 'i', I: 'i', ş: 's', Ş: 's', ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g',
  ö: 'o', Ö: 'o', ü: 'u', Ü: 'u', â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
};

/**
 * Folds Turkish letters and case, one UTF-16 unit at a time, so the result has
 * exactly the same length as the input and match indices can be used to slice
 * the original text for highlighting.
 */
export function foldTurkish(text: string): string {
  let folded = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const mapped = FOLD[character] ?? character.toLowerCase();
    folded += mapped.length === 1 ? mapped : character;
  }
  return folded;
}

/** Anything that is not an ASCII letter or digit starts a new word. */
const WORD_BREAK = /[^a-z0-9]/;

/**
 * Best score of `needle` inside an already folded `haystack`:
 * 100 exact, 90 prefix, 75 word start, 55 inside a word, 0 no match.
 */
function scoreOccurrence(haystack: string, needle: string): number {
  if (!needle || !haystack) return 0;
  let best = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    const prefix = index === 0;
    const exact = prefix && haystack.length === needle.length;
    const wordStart = prefix || WORD_BREAK.test(haystack[index - 1]);
    best = Math.max(best, exact ? 100 : prefix ? 90 : wordStart ? 75 : 55);
    if (best === 100) break;
    from = index + 1;
  }
  return best;
}

/** Score of a query against one piece of text; multi-word queries need every word. */
export function scoreText(text: string, query: string): number {
  const haystack = foldTurkish(text);
  if (!haystack || !query) return 0;
  const phrase = scoreOccurrence(haystack, query);
  if (phrase > 0) return phrase;
  const words = query.split(' ').filter(Boolean);
  if (words.length < 2) return 0;
  let weakest = Infinity;
  for (const word of words) {
    const score = scoreOccurrence(haystack, word);
    if (score === 0) return 0;
    weakest = Math.min(weakest, score);
  }
  return Math.max(10, weakest - 8);
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [sorted[0]];
  for (const [start, end] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Ranges of the query and of each of its words inside `text`, for the highlight. */
export function matchRanges(text: string, query: string): [number, number][] {
  const folded = foldTurkish(text);
  const normalized = foldTurkish(query).trim().replace(/\s+/g, ' ');
  if (!folded || !normalized) return [];
  const needles = [normalized, ...normalized.split(' ')];
  const ranges: [number, number][] = [];
  for (const needle of needles) {
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const index = folded.indexOf(needle, from);
      if (index < 0) break;
      ranges.push([index, index + needle.length]);
      from = index + needle.length;
    }
  }
  return mergeRanges(ranges);
}

export type SearchVenueInput = {
  id: string;
  name: string;
  shortName: string;
  aliases: string[];
  /** OpenStreetMap building this venue sits on, when it has one. */
  buildingId: string | null;
};

export type SearchBuildingInput = { id: string; name: string };

export type SearchEventInput = {
  id: string;
  title: string;
  category: string;
  place: string;
  startAt: string;
};

/** Flattens campus and event data into the searchable entries, in a stable order. */
export function buildSearchIndex(
  { venues, buildings, events }: {
    venues: SearchVenueInput[];
    buildings: SearchBuildingInput[];
    events: SearchEventInput[];
  },
): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const venue of venues) {
    entries.push({
      key: `venue:${venue.id}`,
      kind: 'venue',
      title: venue.name,
      detail: 'Mekân',
      extra: [venue.shortName, ...venue.aliases].join(' '),
      rank: 0,
      venueId: venue.id,
    });
  }
  for (const building of buildings) {
    entries.push({
      key: `building:${building.id}`,
      kind: 'building',
      title: building.name,
      detail: 'Bina',
      extra: '',
      rank: 50,
      buildingId: building.id,
    });
  }
  for (const event of events) {
    entries.push({
      key: `event:${event.id}`,
      kind: 'event',
      title: event.title,
      detail: event.place || 'Yer belirtilmemiş',
      extra: [event.category, event.place].filter(Boolean).join(' '),
      // Sooner events win a tie; an unreadable date sorts last.
      rank: Number.isFinite(Date.parse(event.startAt)) ? Date.parse(event.startAt) : Infinity,
      eventId: event.id,
    });
  }
  return entries;
}

/**
 * Ranked, grouped search over the entries. At most `limit` hits come back, split
 * into "Mekânlar" (venues and buildings) and "Etkinlikler".
 */
export function searchCampus(query: string, entries: SearchEntry[], limit = 8): SearchOutcome {
  const normalized = foldTurkish(query).trim().replace(/\s+/g, ' ');
  if (!normalized) return { groups: [], total: 0 };

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const titleScore = scoreText(entry.title, normalized);
    // A match in the supporting text counts, but always below a name match.
    const extraScore = entry.extra ? scoreText(entry.extra, normalized) - 12 : 0;
    const score = Math.max(titleScore, extraScore);
    if (score <= 0) continue;
    hits.push({ entry, score, ranges: matchRanges(entry.title, query) });
  }
  hits.sort((a, b) => b.score - a.score
    || a.entry.rank - b.entry.rank
    || a.entry.title.localeCompare(b.entry.title, 'tr'));
  const limited = hits.slice(0, Math.max(0, limit));

  const places = limited.filter((hit) => hit.entry.kind !== 'event');
  const events = limited.filter((hit) => hit.entry.kind === 'event');
  const groups: SearchGroup[] = [];
  if (places.length) groups.push({ key: 'places', label: 'Mekânlar', hits: places });
  if (events.length) groups.push({ key: 'events', label: 'Etkinlikler', hits: events });
  return { groups, total: limited.length };
}
