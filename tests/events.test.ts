import { describe, expect, it } from 'vitest';
import { eventState, eventsForPeriod, formatCardTime, liveNow } from '../src/lib/events';
import type { EventItem } from '../src/lib/types';

function event(id: string, startAt: string, endAt: string): EventItem {
  return { id, startAt, endAt, title: id, place: '', venueId: null, organiser: '', category: 'Diğer', posterUrl: null, sourceUrl: 'https://www.anadolu.edu.tr/etkinlikler' };
}

describe('Istanbul time filters', () => {
  const now = new Date('2026-09-26T09:00:00Z'); // 12:00 in Eskişehir
  const events = [
    event('ended', '2026-09-26T09:00:00+03:00', '2026-09-26T11:59:00+03:00'),
    event('live', '2026-09-25T13:00:00+03:00', '2026-09-26T17:00:00+03:00'),
    event('later-today', '2026-09-26T14:00:00+03:00', '2026-09-26T16:00:00+03:00'),
    event('tomorrow', '2026-09-27T10:00:00+03:00', '2026-09-27T11:00:00+03:00'),
  ];

  it('excludes already finished events from today', () => {
    expect(eventsForPeriod(events, 'today', now).map((item) => item.id)).toEqual(['live', 'later-today']);
    expect(eventsForPeriod(events, 'now', now).map((item) => item.id)).toEqual(['live']);
    expect(eventsForPeriod(events, 'tomorrow', now).map((item) => item.id)).toEqual(['tomorrow']);
  });

  it('shows the end time for an ongoing multi-day event', () => {
    expect(eventState(events[1], now)).toBe('live');
    expect(formatCardTime(events[1], now)).toMatch(/^Bitiş: 26 Eyl/);
  });
});

describe('what is running right now', () => {
  const now = new Date('2026-09-26T09:00:00Z'); // 12:00 in Eskişehir
  const events: EventItem[] = [
    { ...event('live-at-akm', '2026-09-26T09:00:00+03:00', '2026-09-26T17:00:00+03:00'), venueId: 'akm' },
    { ...event('live-nowhere', '2026-09-26T10:00:00+03:00', '2026-09-26T13:00:00+03:00') },
    { ...event('starts-later', '2026-09-26T14:00:00+03:00', '2026-09-26T16:00:00+03:00'), venueId: 'sinema' },
    { ...event('already-ended', '2026-09-26T08:00:00+03:00', '2026-09-26T08:30:00+03:00'), venueId: 'kutuphane' },
  ];

  it('counts the events that are on now and names the venues they glow on', () => {
    const live = liveNow(events, now);
    expect(live.events.map((item) => item.id)).toEqual(['live-at-akm', 'live-nowhere']);
    // An event whose place is not on the map still counts, it just has no pin.
    expect([...live.venueIds]).toEqual(['akm']);
  });

  it('finds nothing once every event has finished', () => {
    const late = liveNow(events, new Date('2026-09-26T18:00:00Z')); // 21:00 in Eskişehir
    expect(late.events).toEqual([]);
    expect(late.venueIds.size).toBe(0);
  });
});
