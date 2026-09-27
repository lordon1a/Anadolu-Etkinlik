import { ArrowRight, CalendarBlank } from '@phosphor-icons/react';
import { countdownLabel, remainingLabel } from '../lib/countdown';
import { eventState, shortTitle } from '../lib/events';
import { useCountUp } from '../lib/use-count-up';
import type { EventItem, Period } from '../lib/types';

type SummaryProps = {
  liveCount: number;
  todayCount: number;
  weekCount: number;
  period: Period;
  onPick: (period: Period) => void;
};

function Stat({ label, value, live = false, active, onPick }: {
  label: string;
  value: number;
  live?: boolean;
  active: boolean;
  onPick: () => void;
}) {
  const shown = useCountUp(value);
  return <button
    type="button"
    className={`hero-stat${live ? ' is-live' : ''}`}
    aria-pressed={active}
    onClick={onPick}
  >
    {live && <span className="hero-stat-dot" aria-hidden="true" />}
    <strong>{shown}</strong>
    <span>{label}</span>
  </button>;
}

/**
 * The live strip under the headline. Each figure is also the shortest way to
 * reach that time filter, so the numbers are buttons, not decoration.
 */
export default function HeroSummary({ liveCount, todayCount, weekCount, period, onPick }: SummaryProps) {
  return <div className="hero-summary">
    <Stat label="şu an sürüyor" value={liveCount} live active={period === 'now'} onPick={() => onPick('now')} />
    <span className="hero-sep" aria-hidden="true" />
    <Stat label="bugün" value={todayCount} active={period === 'today'} onPick={() => onPick('today')} />
    <span className="hero-sep" aria-hidden="true" />
    <Stat label="bu hafta" value={weekCount} active={period === 'week'} onPick={() => onPick('week')} />
  </div>;
}

type NextProps = {
  event: EventItem | null;
  todayCount: number;
  now: Date;
  onOpen: (event: EventItem) => void;
};

/**
 * The next thing that happens on campus, with a countdown that keeps ticking
 * (a running event says so instead). With nothing ahead it falls back to the
 * plain today badge.
 */
export function NextEventCard({ event, todayCount, now, onOpen }: NextProps) {
  if (!event) {
    return <div className="today-badge">
      <span>BUGÜN</span>
      <strong>{todayCount}</strong>
      <span>ETKİNLİK</span>
      <CalendarBlank size={22} weight="regular" aria-hidden="true" />
    </div>;
  }
  const state = eventState(event, now);
  const timing = state === 'live' ? remainingLabel(event.endAt, now) : countdownLabel(event.startAt, now);
  const place = event.place || 'Yer belirtilmemiş';
  return <button type="button" className="next-event" onClick={() => onOpen(event)}>
    <span
      className="next-event-poster"
      style={event.posterUrl ? { backgroundImage: `url("${event.posterUrl}")` } : undefined}
      aria-hidden="true"
    >
      {!event.posterUrl && <CalendarBlank size={20} weight="regular" />}
    </span>
    <span className="next-event-body">
      <span className="next-event-label">{state === 'live' ? 'Şu an sürüyor' : 'Sıradaki etkinlik'}</span>
      <span className="next-event-title">{shortTitle(event.title)}</span>
      <span className="next-event-time">{timing ? `${timing} · ` : ''}{place}</span>
    </span>
    <ArrowRight className="next-event-arrow" size={16} weight="bold" aria-hidden="true" />
  </button>;
}
