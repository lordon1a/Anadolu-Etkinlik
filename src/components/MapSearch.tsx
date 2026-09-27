import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { venues, venueByOsmId } from '../data/campus';
import { campusBuildings } from '../lib/campus';
import { shortTitle } from '../lib/events';
import { buildSearchIndex, searchCampus, type SearchHit } from '../lib/search';
import type { EventItem } from '../lib/types';
import '../map-search.css';

type Props = {
  /** Every known event; the box finds an event even when the list is filtered. */
  events: EventItem[];
  onSelectVenue: (id: string) => void;
  onSelectBuilding: (id: string) => void;
  onOpenEvent: (event: EventItem) => void;
  /** Tells the page whether a result list is covering the map. */
  onOpenChange?: (open: boolean) => void;
};

const LIST_ID = 'map-search-listbox';
const optionId = (key: string) => `map-search-option-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

/** Matched part of a title, marked for the highlight style. */
function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={index}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export default function MapSearch({ events, onSelectVenue, onSelectBuilding, onOpenEvent, onOpenChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => buildSearchIndex({
    venues: venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      shortName: venue.shortName,
      aliases: venue.aliases,
      buildingId: venue.osmId,
    })),
    // A venue's own building is already covered by the venue entry.
    buildings: campusBuildings
      .filter((building) => building.name.trim() && !venueByOsmId.has(building.id))
      .map((building) => ({ id: building.id, name: building.name })),
    events: events.map((event) => ({
      id: event.id,
      title: shortTitle(event.title),
      category: event.category,
      place: event.place,
      startAt: event.startAt,
    })),
  }), [events]);

  const outcome = useMemo(() => searchCampus(query, entries), [query, entries]);
  const hits = useMemo(() => outcome.groups.flatMap((group) => group.hits), [outcome]);
  const expanded = open && query.trim().length > 0;

  // Typing starts a new list, so the keyboard cursor goes back to the top.
  useEffect(() => { setActiveIndex(0); }, [query]);

  // The page dims the map pins while the list is open, so a click can only
  // land on a result and never on something hiding under it.
  useEffect(() => { onOpenChange?.(expanded); }, [expanded, onOpenChange]);
  useEffect(() => {
    if (activeIndex > hits.length - 1) setActiveIndex(0);
  }, [hits.length, activeIndex]);
  useEffect(() => {
    if (!expanded) return;
    document.getElementById(optionId(hits[activeIndex]?.entry.key ?? ''))?.scrollIntoView({ block: 'nearest' });
  }, [expanded, activeIndex, hits]);

  // "/" reaches the search box from anywhere on the page, except from a field.
  useEffect(() => {
    const onKeyDown = (nativeEvent: KeyboardEvent) => {
      if (nativeEvent.key !== '/' || nativeEvent.metaKey || nativeEvent.ctrlKey || nativeEvent.altKey) return;
      const target = nativeEvent.target as HTMLElement | null;
      if (target?.isContentEditable
        || (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      nativeEvent.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  function choose(hit: SearchHit) {
    setQuery(hit.entry.title);
    setOpen(false);
    if (hit.entry.kind === 'venue' && hit.entry.venueId) onSelectVenue(hit.entry.venueId);
    else if (hit.entry.kind === 'building' && hit.entry.buildingId) onSelectBuilding(hit.entry.buildingId);
    else if (hit.entry.kind === 'event') {
      const event = events.find((item) => item.id === hit.entry.eventId);
      if (event) onOpenEvent(event);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!hits.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        return (next + hits.length) % hits.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      if (!expanded || !hits.length) return;
      event.preventDefault();
      choose(hits[Math.min(activeIndex, hits.length - 1)]);
      return;
    }
    if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
      } else if (query) {
        event.preventDefault();
        setQuery('');
      }
    }
  }

  return <div className="map-search" ref={rootRef}>
    <span className="map-search-icon" aria-hidden="true"><MagnifyingGlass size={16} weight="regular" /></span>
    <input
      ref={inputRef}
      className="map-search-input"
      type="search"
      role="combobox"
      autoComplete="off"
      spellCheck={false}
      placeholder="Mekân, bina veya etkinlik ara"
      aria-label="Haritada mekân, bina veya etkinlik ara"
      aria-expanded={expanded}
      aria-controls={LIST_ID}
      aria-autocomplete="list"
      aria-activedescendant={expanded && hits[activeIndex] ? optionId(hits[activeIndex].entry.key) : undefined}
      value={query}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onKeyDown={onKeyDown}
    />
    {query && <button
      type="button"
      className="map-search-clear"
      aria-label="Aramayı temizle"
      onClick={() => { setQuery(''); setOpen(false); inputRef.current?.focus(); }}
    ><X size={13} weight="bold" aria-hidden="true" /></button>}

    {expanded && <div className="map-search-results">
      {!hits.length
        ? <div className="map-search-empty" role="status">
          <strong>Sonuç yok</strong>
          <span>Mekân, bina veya etkinlik adı dene. Örnek: kütüphane, AKM, konser.</span>
        </div>
        : <div id={LIST_ID} role="listbox" aria-label="Arama sonuçları">
          {outcome.groups.map((group) => <div
            key={group.key}
            className="map-search-group"
            role="group"
            aria-labelledby={`map-search-group-${group.key}`}
          >
            <span className="map-search-group-title" id={`map-search-group-${group.key}`}>{group.label}</span>
            {group.hits.map((hit) => {
              const index = hits.indexOf(hit);
              return <div
                key={hit.entry.key}
                id={optionId(hit.entry.key)}
                role="option"
                aria-selected={index === activeIndex}
                className={`map-search-option${index === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(hit)}
              >
                <span className="map-search-option-title">
                  <Highlighted text={hit.entry.title} ranges={hit.ranges} />
                </span>
                <span className="map-search-option-detail">{hit.entry.detail}</span>
              </div>;
            })}
          </div>)}
        </div>}
    </div>}
  </div>;
}
