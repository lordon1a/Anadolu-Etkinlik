/** List view while the snapshot is on its way: shimmering rows, no layout jump. */
export default function EventSkeleton({ count = 4 }: { count?: number }) {
  return <>
    <span className="sr-only" role="status">Etkinlikler yükleniyor…</span>
    {Array.from({ length: count }, (_, index) => <div className="event-skeleton" key={index} aria-hidden="true">
      <div className="event-skeleton-image" />
      <div className="event-skeleton-body">
        <div className="event-skeleton-line is-short" />
        <div className="event-skeleton-line is-title" />
        <div className="event-skeleton-line" />
        <div className="event-skeleton-line is-short" />
      </div>
    </div>)}
  </>;
}
