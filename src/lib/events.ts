import type { EventItem, Period } from './types';

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function istanbulDay(date: Date): string {
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function eventsForPeriod(events: EventItem[], period: Period, now = new Date()): EventItem[] {
  const today = istanbulDay(now);
  const tomorrow = addDays(today, 1);
  const endOfWeek = addDays(today, 6);
  return events.filter((event) => {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    if (Number.isNaN(+start) || Number.isNaN(+end) || +end <= +now) return false;
    if (period === 'now') return +start <= +now && +now < +end;
    const firstDay = istanbulDay(start);
    const lastDay = istanbulDay(end);
    if (period === 'today') return firstDay <= today && lastDay >= today;
    if (period === 'tomorrow') return firstDay <= tomorrow && lastDay >= tomorrow;
    return firstDay <= endOfWeek && lastDay >= today;
  }).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

/**
 * What is running right now: the live events of an already filtered list plus
 * the venues they sit in. It rides on the same `now` test as the 'now' period,
 * so the map glow, the status pill and the 'Şimdi' tab cannot disagree.
 */
export function liveNow(events: EventItem[], now = new Date()): { events: EventItem[]; venueIds: Set<string> } {
  const live = eventsForPeriod(events, 'now', now);
  const venueIds = new Set<string>();
  for (const event of live) {
    if (event.venueId) venueIds.add(event.venueId);
  }
  return { events: live, venueIds };
}

export function eventState(event: EventItem, now = new Date()): 'live' | 'soon' | 'later' | 'ended' {
  if (Date.parse(event.endAt) <= +now) return 'ended';
  if (Date.parse(event.startAt) <= +now) return 'live';
  if (istanbulDay(new Date(event.startAt)) === istanbulDay(now)) return 'soon';
  return 'later';
}

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', weekday: 'long',
});
const timeFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function formatEventDate(event: EventItem): string {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const date = dateFormatter.format(start);
  const startTime = timeFormatter.format(start);
  const endTime = timeFormatter.format(end);
  return istanbulDay(start) === istanbulDay(end)
    ? `${date} · ${startTime}–${endTime}`
    : `${date} ${startTime} – ${dateFormatter.format(end)} ${endTime}`;
}

const badgeDayFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', day: '2-digit', month: 'short',
});

/** Afişin üstündeki tarih rozeti: "28 EYL" ve "09:00" iki satır. */
export function formatDateBadge(event: EventItem): { day: string; time: string } {
  const start = new Date(event.startAt);
  return {
    day: badgeDayFormatter.format(start).replace('.', '').toLocaleUpperCase('tr-TR'),
    time: timeFormatter.format(start),
  };
}

export function formatCardTime(event: EventItem, now = new Date()): string {
  const active = eventState(event, now) === 'live';
  const date = new Date(active ? event.endAt : event.startAt);
  const label = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' }).format(date);
  return `${active ? 'Bitiş: ' : ''}${label} · ${timeFormatter.format(date)}`;
}

export function updatedLabel(iso: string): string {
  const age = Date.now() - Date.parse(iso);
  if (!Number.isFinite(age)) return 'Güncelleme zamanı bilinmiyor';
  if (age < 60 * 60 * 1000) return `${Math.max(1, Math.floor(age / 60000))} dk önce güncellendi`;
  if (age < 24 * 60 * 60 * 1000) return `${Math.floor(age / 3600000)} sa önce güncellendi`;
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(new Date(iso)) + ' güncellendi';
}

export function shortTitle(title: string): string {
  return title.replace(/^["“”'\s]+|["“”'\s]+$/g, '');
}
