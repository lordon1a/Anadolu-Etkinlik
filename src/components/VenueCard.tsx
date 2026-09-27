// The event card that opens on the map when a venue is picked: a small popup
// hanging off the pin on wide screens, a bottom sheet on phones. Both share the
// same header, event rows and dismissal rules, so the panel flow and the map
// always show the same events.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUpRight, CalendarBlank, Clock, LinkSimple, X } from '@phosphor-icons/react';
import { formatCardTime, shortTitle } from '../lib/events';
import { exceedsDragThreshold } from '../lib/interaction';
import { eventShareUrl, shareEventUrl } from '../lib/share';
import type { EventItem, Venue } from '../lib/types';

/** The card stays a glance: three events, the rest is one click away. */
const EVENT_LIMIT = 3;
/** How long the "link copied" label stays before it goes back to "Paylaş". */
const COPIED_NOTICE_MS = 2400;

type CardProps = {
  venue: Venue;
  events: EventItem[];
  onClose: () => void;
  onOpenEvent: (event: EventItem) => void;
  onShowAll: () => void;
};

/**
 * Escape and a click outside close the popup. A drag on the map does not count
 * as an outside click, and pin clicks are left to the pin's own toggle, so
 * orbiting the camera or moving between venues never fights the card.
 */
function useDismiss(rootRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    let down: [number, number] | null = null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const held = rootRef.current?.contains(target as Node)
        || (target instanceof Element && Boolean(target.closest('.map-pin, dialog')));
      down = held ? null : [event.clientX, event.clientY];
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!down) return;
      const dragged = exceedsDragThreshold(down, [event.clientX, event.clientY]);
      down = null;
      if (!dragged) close.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // The event dialog owns Escape while it is open.
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) close.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [rootRef]);
}

/**
 * Moves focus into the popup and hands it back to whatever opened it. The card
 * is invisible until the frame loop has placed it on its pin, and a hidden
 * button cannot take focus, so the attempt is repeated for a few frames.
 */
function useFocusOnOpen(closeRef: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let attempts = 0;
    let frame = 0;
    const grabFocus = () => {
      closeRef.current?.focus();
      attempts += 1;
      const current = document.activeElement;
      // Only keep trying while nobody else has claimed focus in the meantime.
      const free = current === opener || current === document.body;
      if (current !== closeRef.current && free && attempts < 12) {
        frame = requestAnimationFrame(grabFocus);
      }
    };
    grabFocus();
    return () => {
      cancelAnimationFrame(frame);
      if (opener?.isConnected) opener.focus();
    };
  }, [closeRef]);
}

function VenueCardHeader({ venue, closeRef, onClose }: {
  venue: Venue;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return <header className="venue-card-head">
    <div>
      <span className="venue-card-eyebrow">Seçili mekân</span>
      <h3 className="venue-card-name" id="venue-card-title">{venue.name}</h3>
    </div>
    <button type="button" className="venue-card-close" ref={closeRef} onClick={onClose} aria-label="Kartı kapat">
      <X size={15} weight="bold" aria-hidden="true" />
    </button>
  </header>;
}

function VenueEventList({ events, onOpenEvent, onShowAll }: Pick<CardProps, 'events' | 'onOpenEvent' | 'onShowAll'>) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  async function share(event: EventItem) {
    const outcome = await shareEventUrl(eventShareUrl(event.id, window.location.href), shortTitle(event.title));
    if (outcome !== 'copied') return;
    setCopiedId(event.id);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedId(null), COPIED_NOTICE_MS);
  }

  if (!events.length) {
    return <p className="venue-card-empty">Bu aralıkta etkinlik görünmüyor.</p>;
  }
  const shown = events.slice(0, EVENT_LIMIT);
  const remaining = events.length - shown.length;
  return <>
    <ul className="venue-card-events">
      {shown.map((event) => {
        const title = shortTitle(event.title);
        return <li key={event.id} className="venue-card-event">
          <button
            type="button"
            className="venue-card-open"
            onClick={() => onOpenEvent(event)}
            aria-label={`${title}: ayrıntıları aç`}
          >
            <span
              className="venue-card-poster"
              style={event.posterUrl ? { backgroundImage: `url("${event.posterUrl}")` } : undefined}
              aria-hidden="true"
            >
              {!event.posterUrl && <CalendarBlank size={15} weight="regular" />}
            </span>
            <span className="venue-card-text">
              <span className="venue-card-title">{title}</span>
              <span className="venue-card-time"><Clock size={12} weight="regular" aria-hidden="true" /> {formatCardTime(event)}</span>
            </span>
          </button>
          <span className="venue-card-actions">
            <button
              type="button"
              className="venue-card-share"
              onClick={() => { void share(event); }}
              aria-label={`${title} bağlantısını paylaş`}
            >
              <LinkSimple size={12} weight="regular" aria-hidden="true" /> {copiedId === event.id ? 'Bağlantı kopyalandı' : 'Paylaş'}
            </button>
            <a
              className="venue-card-source"
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${title}: resmî duyuru`}
            >
              Resmî duyuru <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </span>
        </li>;
      })}
    </ul>
    {remaining > 0 && <button type="button" className="venue-card-more" onClick={onShowAll}>
      +{remaining} etkinlik daha
    </button>}
  </>;
}

/** Desktop popup: the parent positions the root element on the pin every frame. */
export function VenueCard({ containerRef, ...props }: CardProps & { containerRef: RefObject<HTMLDivElement | null> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useDismiss(containerRef, props.onClose);
  useFocusOnOpen(closeRef);
  return <div
    className="venue-card"
    ref={containerRef}
    role="dialog"
    aria-labelledby="venue-card-title"
    data-side="above"
  >
    <span className="venue-card-tail" aria-hidden="true" />
    <VenueCardHeader venue={props.venue} closeRef={closeRef} onClose={props.onClose} />
    <VenueEventList {...props} />
  </div>;
}

/** Phone layout: the same content as a bottom sheet with a dimmed map behind it. */
export function VenueSheet(props: CardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDismiss(rootRef, props.onClose);
  useFocusOnOpen(closeRef);
  return <div className="venue-sheet-layer">
    <button type="button" className="venue-sheet-backdrop" aria-label="Kartı kapat" onClick={props.onClose} />
    <div className="venue-sheet" ref={rootRef} role="dialog" aria-labelledby="venue-card-title">
      <span className="venue-sheet-grip" aria-hidden="true" />
      <VenueCardHeader venue={props.venue} closeRef={closeRef} onClose={props.onClose} />
      <VenueEventList {...props} />
    </div>
  </div>;
}

export default VenueCard;
