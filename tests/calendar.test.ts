import { describe, expect, it } from 'vitest';
import { countdownLabel, remainingLabel } from '../src/lib/countdown';
import { escapeIcsText, eventIcs, istanbulStamp } from '../src/lib/calendar';
import type { EventItem } from '../src/lib/types';

const now = new Date('2026-09-28T09:00:00+03:00');

describe('countdownLabel', () => {
  it('writes minutes, hours and days the way the hero card reads', () => {
    expect(countdownLabel('2026-09-28T11:15:00+03:00', now)).toBe('2 sa 15 dk sonra');
    expect(countdownLabel('2026-09-28T11:00:00+03:00', now)).toBe('2 sa sonra');
    expect(countdownLabel('2026-09-28T09:40:00+03:00', now)).toBe('40 dk sonra');
    expect(countdownLabel('2026-09-30T09:00:00+03:00', now)).toBe('2 gün sonra');
  });

  it('returns nothing for a moment that has already arrived', () => {
    expect(countdownLabel('2026-09-28T08:59:00+03:00', now)).toBe('');
  });

  it('labels a running event by its end', () => {
    expect(remainingLabel('2026-09-28T10:10:00+03:00', now)).toBe('Bitişe 1 sa 10 dk');
  });
});

const event: EventItem = {
  id: 'ornek-1',
  title: '“Kampüs Söyleşisi”, ikinci oturum',
  startAt: '2026-09-28T13:00:00+03:00',
  endAt: '2026-09-28T15:00:00+03:00',
  place: 'Öğrenci Merkezi, Salon 2',
  venueId: 'ogrenci-merkezi',
  organiser: 'Öğrenci Kulübü',
  category: 'Söyleşi',
  posterUrl: null,
  sourceUrl: 'https://www.anadolu.edu.tr/etkinlikler/ornek',
};

describe('calendar', () => {
  it('stamps Istanbul wall-clock time, not the runner timezone', () => {
    expect(istanbulStamp('2026-09-28T13:00:00+03:00')).toBe('20260928T130000');
    expect(istanbulStamp('2026-09-28T10:00:00+00:00')).toBe('20260928T130000');
  });

  it('escapes the characters RFC 5545 reserves', () => {
    expect(escapeIcsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });

  it('produces a single VEVENT with the source link and location', () => {
    const ics = eventIcs(event, now);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTSTART;TZID=Europe/Istanbul:20260928T130000');
    expect(ics).toContain('DTEND;TZID=Europe/Istanbul:20260928T150000');
    expect(ics).toContain('LOCATION:Öğrenci Merkezi\\, Salon 2');
    expect(ics).toContain('URL:https://www.anadolu.edu.tr/etkinlikler/ornek');
    expect(ics).toContain('X-WR-TIMEZONE:Europe/Istanbul');
  });
});
