import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, CalendarBlank, CalendarPlus, Check, MapPin, MapPinLine, ShareNetwork, Stack, X } from '@phosphor-icons/react';
import { downloadEventIcs } from '../lib/calendar';
import { eventState, formatEventDate, shortTitle } from '../lib/events';
import { eventShareUrl, shareEventUrl } from '../lib/share';
import { venues } from '../data/campus';
import type { EventItem } from '../lib/types';

/** Matches the exit keyframes in style.css. */
const EXIT_MS = 180;

type Props = {
  /** The event from the URL (`?etkinlik=`); null closes the dialog. */
  event: EventItem | null;
  onClose: () => void;
  onShowOnMap: (event: EventItem) => void;
};

/**
 * The event detail dialog. It owns its own exit animation: the panel slides out
 * before the native dialog closes, so the close is never a jump cut. The
 * content stays mounted while it animates, which is why `visible` is separate
 * from the `event` prop.
 */
export default function EventDialog({ event, onClose, onShowOnMap }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState<EventItem | null>(event);
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const exitTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reduceMotion = useRef(typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open || exitTimer.current !== null) return;
    setClosing(true);
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      dialog.close();
    }, reduceMotion.current ? 0 : EXIT_MS);
  }, []);

  // Opens on a new event, animates out when the event leaves the URL.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (event) {
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setVisible(event);
      setClosing(false);
      setCopied(false);
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) requestClose();
  }, [event, requestClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      setVisible(null);
      setClosing(false);
      onCloseRef.current();
    };
    // Escape takes the same animated path as the close button.
    const handleCancel = (nativeEvent: Event) => {
      nativeEvent.preventDefault();
      requestClose();
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    };
  }, [requestClose]);

  async function share(target: EventItem) {
    const outcome = await shareEventUrl(eventShareUrl(target.id, window.location.href), shortTitle(target.title));
    if (outcome === 'copied') setCopied(true);
  }

  const venue = visible ? venues.find((item) => item.id === visible.venueId) : undefined;
  const mapped = venue?.position === 'footprint';
  const live = visible ? eventState(visible) === 'live' : false;

  return <dialog
    ref={dialogRef}
    className={`event-dialog${closing ? ' is-closing' : ''}`}
    aria-label={visible ? shortTitle(visible.title) : 'Etkinlik ayrıntısı'}
  >
    {visible && <>
      <button className="dialog-close" type="button" onClick={requestClose} aria-label="Ayrıntıyı kapat">
        <X size={17} weight="bold" aria-hidden="true" />
      </button>
      <div
        className="dialog-poster"
        style={visible.posterUrl
          ? { backgroundImage: `linear-gradient(180deg, rgba(19,42,51,.05), rgba(19,42,51,.18)), url("${visible.posterUrl}")` }
          : undefined}
      >
        {visible.posterUrl
          ? <img src={visible.posterUrl} alt={`${shortTitle(visible.title)} etkinlik afişi`} loading="lazy" />
          : <CalendarBlank size={54} weight="regular" aria-hidden="true" />}
      </div>
      <div className="dialog-content">
        <p className="eyebrow">
          {visible.category} <span>·</span> {live ? 'Şu an devam ediyor' : 'Anadolu Üniversitesi'}
        </p>
        <h2>{shortTitle(visible.title)}</h2>
        <div className="dialog-facts">
          <div>
            <CalendarBlank size={19} weight="regular" aria-hidden="true" />
            <span><small>Tarih ve saat</small>{formatEventDate(visible)}</span>
          </div>
          <div>
            <MapPin size={19} weight="regular" aria-hidden="true" />
            <span>
              <small>Yer</small>
              {visible.place || 'Duyuruda yer belirtilmemiş'}
              {venue && <em>Haritada: {venue.name}{venue.position === 'node' ? ' (yaklaşık konum)' : ''}</em>}
            </span>
          </div>
          {visible.organiser && <div>
            <Stack size={19} weight="regular" aria-hidden="true" />
            <span><small>Düzenleyen</small>{visible.organiser}</span>
          </div>}
        </div>
        <div className="dialog-actions">
          {mapped && <button type="button" className="is-primary" onClick={() => onShowOnMap(visible)}>
            <MapPinLine size={17} weight="regular" aria-hidden="true" /> Haritada gör
          </button>}
          <button type="button" onClick={() => downloadEventIcs(visible)}>
            <CalendarPlus size={17} weight="regular" aria-hidden="true" /> Takvime ekle
          </button>
          <button type="button" onClick={() => { void share(visible); }}>
            {copied
              ? <><Check size={17} weight="bold" aria-hidden="true" /> Bağlantı kopyalandı</>
              : <><ShareNetwork size={17} weight="regular" aria-hidden="true" /> Paylaş</>}
          </button>
          <a className="is-quiet" href={visible.sourceUrl} target="_blank" rel="noopener noreferrer">
            Resmî duyuru <ArrowSquareOut size={15} weight="regular" aria-hidden="true" />
          </a>
        </div>
        {!venue && <p className="dialog-note">Bu yerin haritadaki konumu henüz doğrulanmadı.</p>}
        {venue?.position === 'node' && <p className="dialog-note">Bu bina OpenStreetMap'te ayak izi olarak yok; işaret haritada yaklaşık konumu gösterir.</p>}
        {venue?.position === 'unverified' && <p className="dialog-note">Bu yer doğrulanmış bir bina ayak iziyle eşleşmedi; haritada işaretlenmez.</p>}
      </div>
    </>}
  </dialog>;
}
