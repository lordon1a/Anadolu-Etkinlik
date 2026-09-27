import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowClockwise, ArrowRight, ArrowSquareOut, ArrowUpRight, Broadcast, CalendarBlank, CaretRight,
  Compass, Cube, GithubLogo, MapTrifold, X,
} from '@phosphor-icons/react';
import Campus2D from './components/Campus2D';
import EventCard from './components/EventCard';
import EventDialog from './components/EventDialog';
import EventSkeleton from './components/EventSkeleton';
import HeroSummary, { NextEventCard } from './components/HeroSummary';
import MapSearch from './components/MapSearch';
import MapSkeleton from './components/MapSkeleton';
import { venues } from './data/campus';
import { debugPanelOnly, sceneOnly } from './lib/campus';
import { eventsForPeriod, liveNow, updatedLabel } from './lib/events';
import { useNow } from './lib/use-now';
import type { EventItem, EventSnapshot, Period } from './lib/types';
import './venue-filter.css';

const CampusScene = lazy(() => import('./components/CampusScene'));
const SOURCE_URL = 'https://www.anadolu.edu.tr/etkinlikler';
const REPO_URL = 'https://github.com/lordon1a/Anadolu-Etkinlik';
const periods: { id: Period; label: string }[] = [
  { id: 'now', label: 'Şimdi' }, { id: 'today', label: 'Bugün' },
  { id: 'tomorrow', label: 'Yarın' }, { id: 'week', label: 'Bu hafta' },
];
const steps = ['Zaman seç', 'Haritada bul', 'Paylaş'];
const heroWords = [
  { text: 'Kampüste', em: false },
  { text: 'bugün', em: false },
  { text: 'ne', em: true },
  { text: 'var?', em: true },
];

function hasWebGL() {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch { return false; }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function fetchEvents(): Promise<{ snapshot: EventSnapshot; live: boolean }> {
  try {
    const response = await fetch('/api/events', { cache: 'no-cache' });
    if (!response.ok) throw new Error('API unavailable');
    return { snapshot: await response.json() as EventSnapshot, live: true };
  } catch {
    const response = await fetch('/events.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Etkinlik verisine ulaşılamadı.');
    return { snapshot: await response.json() as EventSnapshot, live: false };
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [period, setPeriod] = useState<Period>('today');
  const [category, setCategory] = useState('all');
  const [activeVenueId, setActiveVenueId] = useState<string | null>(null);
  const [searchBuildingId, setSearchBuildingId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('etkinlik'));
  const [webGlAvailable] = useState(hasWebGL);
  const eventsPanelRef = useRef<HTMLElement>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [mapMode, setMapMode] = useState<'3d' | '2d'>(() => sceneOnly
    || (webGlAvailable && !prefersReducedMotion()) ? '3d' : '2d');
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const { snapshot: result, live } = await fetchEvents();
      setSnapshot(result);
      setIsLive(live);
      setLoadError('');
    } catch {
      setLoadError('Etkinlikler şu anda yüklenemiyor.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onPopState = () => setSelectedId(new URLSearchParams(window.location.search).get('etkinlik'));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // The sticky toolbar only gains a shadow once the page has actually moved.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const allEvents = snapshot?.events ?? [];
  const categories = useMemo(() => [...new Set(allEvents.map((event) => event.category))].sort((a, b) => a.localeCompare(b, 'tr')), [allEvents]);
  const periodEvents = useMemo(() => eventsForPeriod(allEvents, period, now), [allEvents, period, now]);
  const visibleEvents = useMemo(() => periodEvents.filter((event) => category === 'all' || event.category === category), [periodEvents, category]);
  const venueEvents = useMemo(() => activeVenueId ? visibleEvents.filter((event) => event.venueId === activeVenueId) : [], [visibleEvents, activeVenueId]);
  const listedEvents = activeVenueId ? venueEvents : visibleEvents;
  // "Şimdi": what is running right now among the events on screen. The map glow
  // and the status pill come from the same pass, so they can never disagree.
  const live = useMemo(() => liveNow(visibleEvents, now), [visibleEvents, now]);
  const liveVenueIds = useMemo(() => [...live.venueIds], [live]);
  const activeVenue = venues.find((item) => item.id === activeVenueId);
  const selectedEvent = allEvents.find((event) => event.id === selectedId) ?? null;
  const counts = useMemo(() => visibleEvents.reduce<Record<string, number>>((result, event) => {
    if (event.venueId) result[event.venueId] = (result[event.venueId] ?? 0) + 1;
    return result;
  }, {}), [visibleEvents]);
  const mappedCount = visibleEvents.filter((event) => event.venueId).length;
  const liveCount = useMemo(() => liveNow(allEvents, now).events.length, [allEvents, now]);
  const todayCount = useMemo(() => eventsForPeriod(allEvents, 'today', now).length, [allEvents, now]);
  const weekCount = useMemo(() => eventsForPeriod(allEvents, 'week', now).length, [allEvents, now]);
  const tomorrowCount = useMemo(() => eventsForPeriod(allEvents, 'tomorrow', now).length, [allEvents, now]);
  const categoryCounts = useMemo(() => periodEvents.reduce<Map<string, number>>((result, event) => {
    result.set(event.category, (result.get(event.category) ?? 0) + 1);
    return result;
  }, new Map()), [periodEvents]);
  // The next thing to happen: something already running first, then the soonest.
  const nextEvent = useMemo(() => {
    const stamp = +now;
    return allEvents
      .filter((event) => Date.parse(event.endAt) > stamp)
      .sort((a, b) => {
        const aLive = Date.parse(a.startAt) <= stamp;
        const bLive = Date.parse(b.startAt) <= stamp;
        if (aLive !== bLive) return aLive ? -1 : 1;
        return Date.parse(a.startAt) - Date.parse(b.startAt);
      })[0] ?? null;
  }, [allEvents, now]);

  // The active tab's pill is measured, not guessed: it keeps its place when the
  // labels change width or the toolbar reflows.
  const [pill, setPill] = useState({ x: 0, w: 0 });
  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLButtonElement>('button.active');
      if (active) setPill({ x: active.offsetLeft, w: active.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [period]);

  function openEvent(event: EventItem) {
    const url = new URL(window.location.href);
    url.searchParams.set('etkinlik', event.id);
    window.history.pushState({}, '', url);
    setSelectedId(event.id);
  }
  function closeEvent() {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('etkinlik');
    window.history.replaceState({}, '', url);
    setSelectedId(null);
  }
  function selectVenue(id: string) {
    setSearchBuildingId(null);
    setActiveVenueId((current) => current === id ? null : id);
  }
  // Search picks a spot outright instead of toggling it off when it is already open.
  function selectVenueFromSearch(id: string) {
    setSearchBuildingId(null);
    setActiveVenueId(id);
  }
  function selectBuildingFromSearch(id: string) {
    setActiveVenueId(null);
    setSearchBuildingId(id);
  }
  function openEventFromSearch(event: EventItem) {
    setSearchBuildingId(null);
    if (event.venueId) setActiveVenueId(event.venueId);
    openEvent(event);
  }
  /** Dialog's "Haritada gör": close the detail and fly the map to the venue. */
  function showEventOnMap(event: EventItem) {
    closeEvent();
    if (!event.venueId) return;
    selectVenueFromSearch(event.venueId);
    mapPanelRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  }
  function openNextEvent(event: EventItem) {
    if (event.venueId) showEventOnMap(event);
    else openEvent(event);
  }
  function pickPeriod(next: Period) {
    setPeriod(next);
    setActiveVenueId(null);
  }
  function showVenueEvents() {
    const panel = eventsPanelRef.current;
    if (!panel) return;
    // "… etkinlik daha" hands over to the side panel: scroll it into view and
    // put focus there, so the same list is reachable from the keyboard.
    panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    panel.focus({ preventScroll: true });
  }

  return <div className={`site-shell${debugPanelOnly ? ' debug-panel' : ''}${sceneOnly ? ' scene-only' : ''}`}>
    <a className="skip-link" href="#icerik">İçeriğe geç</a>

    <header className="topbar" style={sceneOnly ? { display: 'none' } : undefined}>
      <a className="brand" href="/" aria-label="Kampüste ana sayfa"><span className="brand-mark"><span /></span><span>KAMPÜSTE<span className="brand-period">.</span></span></a>
      <span className="topbar-subtitle">ANADOLU ETKİNLİK HARİTASI</span>
      <nav className="topbar-nav" aria-label="Kaynaklar">
        <a className="topbar-source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Resmî etkinlikler <ArrowUpRight size={15} weight="bold" aria-hidden="true" /></a>
      </nav>
    </header>

    <main id="icerik">
      <section className="intro">
        <div className="intro-copy">
          <p className="intro-kicker reveal" style={{ '--i': 0 } as CSSProperties}>
            <span className="pulse-dot" /> YUNUS EMRE KAMPÜSÜ <span className="kicker-line" /> ESKİŞEHİR
          </p>
          <h1>
            {heroWords.map((word, index) => <span key={word.text} className="word reveal" style={{ '--i': index + 1 } as CSSProperties}>
              {word.em ? <em>{`${word.text} `}</em> : `${word.text} `}
            </span>)}
          </h1>
          <p className="intro-description reveal" style={{ '--i': 5 } as CSSProperties}>Etkinlikleri keşfet, nerede olduklarını gör, arkadaşınla buluş.</p>
          <div className="reveal" style={{ '--i': 6 } as CSSProperties}>
            <HeroSummary
              liveCount={liveCount}
              todayCount={todayCount}
              weekCount={weekCount}
              period={period}
              onPick={pickPeriod}
            />
          </div>
        </div>
        <div className="reveal" style={{ '--i': 7 } as CSSProperties}>
          <NextEventCard event={nextEvent} todayCount={todayCount} now={now} onOpen={openNextEvent} />
        </div>
      </section>

      <section className="explorer reveal is-deep" aria-label="Etkinlik keşfi" style={{ '--i': 8 } as CSSProperties}>
        <div className={`explorer-toolbar${stuck ? ' is-stuck' : ''}`}>
          <div className="period-tabs" role="group" aria-label="Zaman aralığı" ref={tabsRef}>
            <span className="period-pill" aria-hidden="true" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} />
            {periods.map((option) => <button
              key={option.id}
              type="button"
              className={period === option.id ? 'active' : ''}
              onClick={() => pickPeriod(option.id)}
              aria-pressed={period === option.id}
            >{option.label}</button>)}
          </div>
          <div className="category-chips" role="group" aria-label="Etkinlik türü">
            <button type="button" className="chip" aria-pressed={category === 'all'} onClick={() => { setCategory('all'); setActiveVenueId(null); }}>
              Tümü <span className="chip-count">{periodEvents.length}</span>
            </button>
            {categories.filter((item) => item === category || (categoryCounts.get(item) ?? 0) > 0).map((item) => <button
              key={item}
              type="button"
              className="chip"
              aria-pressed={category === item}
              onClick={() => { setCategory(item); setActiveVenueId(null); }}
            >{item} <span className="chip-count">{categoryCounts.get(item) ?? 0}</span></button>)}
          </div>
        </div>

        <div className="explorer-grid">
          <div className={`map-panel${searchOpen ? ' is-searching' : ''}`} ref={mapPanelRef}>
            <div className="map-panel-header">
              <div>
                <span className="map-eyebrow">Etkileşimli harita</span>
                <h2>Yunus Emre Kampüsü</h2>
              </div>
              <MapSearch
                events={allEvents}
                onSelectVenue={selectVenueFromSearch}
                onSelectBuilding={selectBuildingFromSearch}
                onOpenEvent={openEventFromSearch}
                onOpenChange={setSearchOpen}
              />
              <div className="map-mode-switch" role="group" aria-label="Harita görünümü">
                <button type="button" className={mapMode === '3d' ? 'active' : ''} onClick={() => setMapMode('3d')} disabled={!webGlAvailable} aria-pressed={mapMode === '3d'}><Cube size={15} weight="regular" aria-hidden="true" /> 3D</button>
                <button type="button" className={mapMode === '2d' ? 'active' : ''} onClick={() => setMapMode('2d')} aria-pressed={mapMode === '2d'}><MapTrifold size={15} weight="regular" aria-hidden="true" /> 2D</button>
              </div>
            </div>
            <div className="map-viewport">
              <div className="map-swap" key={mapMode}>
                {mapMode === '3d' && webGlAvailable ? <Suspense fallback={<MapSkeleton />}><CampusScene
                  counts={counts}
                  selectedVenueId={activeVenueId ?? selectedEvent?.venueId ?? null}
                  onSelectVenue={selectVenue}
                  focusBuildingId={searchBuildingId}
                  cardVenueId={activeVenueId}
                  cardEvents={venueEvents}
                  liveVenueIds={liveVenueIds}
                  onCloseCard={() => setActiveVenueId(null)}
                  onOpenEvent={openEvent}
                  onShowVenueEvents={showVenueEvents}
                /></Suspense> : <Campus2D
                  counts={counts}
                  selectedVenueId={activeVenueId ?? selectedEvent?.venueId ?? null}
                  onSelectVenue={selectVenue}
                  liveVenueIds={liveVenueIds}
                  highlightBuildingId={searchBuildingId}
                />}
              </div>
              {live.events.length > 0 && <span className="map-live-pill" role="status">
                <span className="map-live-dot" aria-hidden="true" />
                Şu an {live.events.length} etkinlik sürüyor
              </span>}
              <span className="map-compass" aria-hidden="true"><Compass size={16} weight="regular" /> N</span>
              <span className="map-hint">{mappedCount ? `${mappedCount} etkinlik haritada` : 'Bu aralıkta haritada etkinlik yok'}</span>
            </div>
            <div className="map-footer">
              <span><span className="legend-pin" /> Etkinlik noktası</span>
              <span>Bina ve yollar OSM'den · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap katkıcıları</a></span>
            </div>
          </div>

          <aside className="events-panel" aria-label="Etkinlik listesi" ref={eventsPanelRef} tabIndex={-1}>
            <div className="events-heading">
              <div>
                <span className="section-eyebrow">{activeVenue ? 'Seçili mekân' : 'Keşfet'}</span>
                <h2>{activeVenue?.name ?? `${periods.find((item) => item.id === period)?.label} neler var?`}</h2>
                {activeVenue && <button type="button" className="venue-filter-clear" onClick={() => setActiveVenueId(null)}>
                  Tüm etkinlikleri göster <X size={12} weight="bold" aria-hidden="true" />
                </button>}
              </div>
              <span className="result-count">{listedEvents.length}</span>
            </div>
            <div className="events-list" key={`${period}-${category}-${activeVenueId ?? 'all'}`}>
              {!snapshot && !loadError && <EventSkeleton />}
              {loadError && <div className="list-message error">
                <span>{loadError}</span>
                <button type="button" className="retry-button" onClick={() => { void load(); }}>
                  <ArrowClockwise size={15} weight="regular" aria-hidden="true" /> Tekrar dene
                </button>
              </div>}
              {snapshot && listedEvents.length === 0 && <div className="empty-state">
                <span className="empty-icon"><CalendarBlank size={28} weight="regular" aria-hidden="true" /></span>
                <h3>{activeVenue ? 'Bu mekânda bu aralıkta etkinlik yok.' : 'Bu aralıkta etkinlik görünmüyor.'}</h3>
                <p>{tomorrowCount > 0 && period !== 'tomorrow'
                  ? `Yarın ${tomorrowCount} etkinlik var.`
                  : 'Başka bir zaman aralığı seçerek yaklaşan etkinliklere bakabilirsin.'}</p>
                <div className="empty-state-actions">
                  {tomorrowCount > 0 && period !== 'tomorrow' && <button type="button" onClick={() => { setPeriod('tomorrow'); setCategory('all'); setActiveVenueId(null); }}>
                    Yarını göster <ArrowRight size={15} weight="bold" aria-hidden="true" />
                  </button>}
                  <button
                    type="button"
                    className={tomorrowCount > 0 && period !== 'tomorrow' ? 'is-quiet' : ''}
                    onClick={() => { setPeriod('week'); setCategory('all'); setActiveVenueId(null); }}
                  >Bu haftaya bak <ArrowRight size={15} weight="bold" aria-hidden="true" /></button>
                </div>
              </div>}
              {listedEvents.map((event, index) => <EventCard key={event.id} event={event} onOpen={openEvent} index={index} animate />)}
            </div>
            {snapshot && <div className="data-note"><span className="status-dot" /> {updatedLabel(snapshot.updatedAt)}{!isLive && <span> · Kaydedilmiş veri</span>}</div>}
          </aside>
        </div>
      </section>

      <section className="about-strip" aria-label="Nasıl çalışır">
        <div>
          <span className="section-eyebrow">Nasıl çalışır</span>
          <h2>Bir etkinlik seç, yerini gör.</h2>
          <p>Bilgiler Anadolu Üniversitesi duyurularından alınır; harita verisi OpenStreetMap'ten gelir. İşaretler doğrulanmış bina ayak izlerine oturur, doğrulanmayan yerler listede kalır ama haritaya konmaz. Kesin salon ve saat için resmî duyuruya bak.</p>
        </div>
        <ol className="how-steps">
          {steps.map((step, index) => <li className="how-step" key={step}>
            <span className="how-step-index" aria-hidden="true">{index + 1}</span>
            {step}
            {index < steps.length - 1 && <CaretRight className="how-step-arrow" size={13} weight="bold" aria-hidden="true" />}
          </li>)}
        </ol>
      </section>
    </main>

    <footer className="footer" style={sceneOnly ? { display: 'none' } : undefined}>
      <span className="footer-brand">KAMPÜSTE<span className="brand-period">.</span></span>
      <p>Bağımsız öğrenci projesi · Anadolu Üniversitesi'nin resmî sitesi değildir</p>
      <nav className="footer-links" aria-label="Bağlantılar">
        <a className="footer-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <GithubLogo size={15} weight="regular" aria-hidden="true" /> GitHub
        </a>
        <a className="footer-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          Etkinlik kaynağı <ArrowSquareOut size={14} weight="regular" aria-hidden="true" />
        </a>
        <a className="footer-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          Harita verisi: © OpenStreetMap katkıcıları
        </a>
        <span className="footer-note"><Broadcast size={14} weight="regular" aria-hidden="true" /> Eskişehir · {new Date().getFullYear()}</span>
      </nav>
    </footer>

    <EventDialog event={selectedEvent} onClose={closeEvent} onShowOnMap={showEventOnMap} />
  </div>;
}
