import type { EventItem } from './types';
import { shortTitle } from './events';

// Etkinliği takvime ekleme: tarayıcıda üretilen basit bir .ics dosyası.
// Saatler Europe/Istanbul duvar saatine göre yazılır (TZID ile birlikte).

const istanbul = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Local Istanbul wall-clock stamp, e.g. 20260928T090000. */
export function istanbulStamp(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = Object.fromEntries(istanbul.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Long lines must be folded at 75 octets; clients accept the simple form. */
function fold(line: string): string {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  chunks.push(rest);
  return chunks.join('\r\n ');
}

export function eventIcs(event: EventItem, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kampuste//Etkinlik haritasi//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:Europe/Istanbul',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.id)}@anadolu-etkinlik`,
    `DTSTAMP:${istanbulStamp(now)}Z`,
    `DTSTART;TZID=Europe/Istanbul:${istanbulStamp(event.startAt)}`,
    `DTEND;TZID=Europe/Istanbul:${istanbulStamp(event.endAt)}`,
    `SUMMARY:${escapeIcsText(shortTitle(event.title))}`,
    `LOCATION:${escapeIcsText(event.place || 'Anadolu Üniversitesi Yunus Emre Kampüsü')}`,
    `DESCRIPTION:${escapeIcsText(`${event.organiser ? `${event.organiser} · ` : ''}${event.sourceUrl}`)}`,
    `URL:${escapeIcsText(event.sourceUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}

/** Triggers the download; the object URL is released on the next tick. */
export function downloadEventIcs(event: EventItem, now = new Date()): void {
  const blob = new Blob([eventIcs(event, now)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.id}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
