import type { CSSProperties } from 'react';
import { CalendarBlank, CaretRight, Clock, MapPin } from '@phosphor-icons/react';
import { eventState, formatCardTime, formatDateBadge, shortTitle } from '../lib/events';
import type { EventItem } from '../lib/types';

type Props = {
  event: EventItem;
  onOpen: (event: EventItem) => void;
  /** Position in the list, used for the staggered entrance. */
  index?: number;
  /** Off for lists that appear after the first paint (no second entrance). */
  animate?: boolean;
};

/**
 * One row in the event list: poster with a date badge, a sentence-case kicker,
 * the title and the two facts that decide whether you go. Everything is a
 * single button, so the whole row is one large touch target.
 */
export default function EventCard({ event, onOpen, index = 0, animate = false }: Props) {
  const state = eventState(event);
  const live = state === 'live';
  const badge = formatDateBadge(event);
  const style = animate
    ? { '--i': Math.min(index, 8) } as CSSProperties
    : undefined;

  return <button
    type="button"
    id={`event-${event.id}`}
    className={`event-card${animate ? ' reveal is-staggered' : ''}`}
    style={style}
    onClick={() => onOpen(event)}
  >
    <span
      className="event-card-image"
      style={event.posterUrl ? { backgroundImage: `linear-gradient(180deg, rgba(19,42,51,.02), rgba(19,42,51,.34)), url("${event.posterUrl}")` } : undefined}
      aria-hidden="true"
    >
      {!event.posterUrl && <CalendarBlank size={28} />}
      <span className="event-card-date">{badge.day}<br />{badge.time}</span>
    </span>
    <span className="event-card-main">
      <span className="event-card-kicker">
        <span className={`event-dot${live ? ' live' : ''}`} />
        <span>{live ? 'Devam ediyor' : event.category}</span>
      </span>
      <span className="event-card-title">{shortTitle(event.title)}</span>
      <span className="event-card-meta"><Clock size={14} weight="regular" aria-hidden="true" /> {formatCardTime(event)}</span>
      <span className="event-card-meta"><MapPin size={14} weight="regular" aria-hidden="true" /> {event.place || 'Yer belirtilmemiş'}</span>
    </span>
    <CaretRight className="event-card-arrow" size={16} weight="bold" aria-hidden="true" />
  </button>;
}
