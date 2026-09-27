/** Placeholder shown while the 3D chunk loads: a pale campus silhouette. */
export default function MapSkeleton() {
  return <div className="map-skeleton" role="status">
    <svg viewBox="0 0 520 300" aria-hidden="true">
      <path
        className="map-skeleton-shape"
        d="M28 214 Q116 128 236 158 T492 128 L492 262 Q286 292 28 258 Z"
      />
      <rect className="map-skeleton-shape is-soft" x="86" y="150" width="72" height="48" rx="9" />
      <rect className="map-skeleton-shape is-soft" x="196" y="112" width="94" height="58" rx="11" />
      <rect className="map-skeleton-shape is-soft" x="330" y="146" width="68" height="42" rx="9" />
      <rect className="map-skeleton-shape is-soft" x="418" y="182" width="44" height="30" rx="7" />
    </svg>
    <span className="map-skeleton-note">Harita hazırlanıyor…</span>
  </div>;
}
