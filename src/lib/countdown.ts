// Sıradaki etkinlik için kısa zaman etiketi: "2 sa 15 dk sonra".
// Saf fonksiyon; hero kartı ve testler aynı hesabı kullanır.

const dayFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short',
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long until `targetIso`, in one short phrase. Past targets return an empty
 * string: the caller decides what a running or finished event says.
 */
export function countdownLabel(targetIso: string, now = new Date()): string {
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return '';
  const diff = target - +now;
  if (diff <= 30 * 1000) return '';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} dk sonra`;
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    const minutes = Math.round((diff - hours * HOUR) / MINUTE);
    return minutes ? `${hours} sa ${minutes} dk sonra` : `${hours} sa sonra`;
  }
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    const hours = Math.round((diff - days * DAY) / HOUR);
    return hours ? `${days} gün ${hours} sa sonra` : `${days} gün sonra`;
  }
  return `${dayFormatter.format(new Date(target))} tarihinde`;
}

/** "Bitişe 1 sa 10 dk" — süren bir etkinlik için. */
export function remainingLabel(endIso: string, now = new Date()): string {
  const label = countdownLabel(endIso, now);
  return label ? `Bitişe ${label.replace(' sonra', '')}` : 'Az sonra bitecek';
}
