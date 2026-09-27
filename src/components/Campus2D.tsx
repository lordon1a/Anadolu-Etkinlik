import { useMemo } from 'react';
import {
  campus, campusBuildings, campusGates, campusGreen, campusRoads, campusWater, debugOverlay,
  pointsToPath, spreadPins, viewBoxFor, viewBoxToPercent,
} from '../lib/campus';
import { venues, venueByOsmId } from '../data/campus';
import '../map-landmarks.css';

type Props = {
  counts: Record<string, number>;
  selectedVenueId: string | null;
  onSelectVenue: (id: string) => void;
  /** Venues with an event running right now; their pins pulse. */
  liveVenueIds?: string[];
  /** Building picked in the search box; its outline is highlighted. */
  highlightBuildingId?: string | null;
};

// Matches the 5/3 frame in map-landmarks.css, so pins land where the geometry is.
const MAP_ASPECT = 5 / 3;
const WATER_COLOR = '#8fc4cd';
const ROAD_COLORS: Record<string, string> = {
  street: '#b9b6ac',
  service: '#c3c0b6',
  footway: '#cdc9bb',
  steps: '#cdc9bb',
};
const ROAD_ORDER: Record<string, number> = { footway: 0, steps: 0, service: 1, street: 2 };

export default function Campus2D({ counts, selectedVenueId, onSelectVenue, liveVenueIds = [], highlightBuildingId = null }: Props) {
  const viewBox = useMemo(() => viewBoxFor(MAP_ASPECT), []);
  const scale = 1000 / viewBox.width; // screen pixels per metre at overlay size
  const showLandmarks = !Object.values(counts).some((count) => count > 0);
  const live = useMemo(() => new Set(liveVenueIds), [liveVenueIds]);

  // Selected venue first, then the busiest, so the important pin keeps its spot.
  const pins = useMemo(() => {
    const withCounts = venues
      .filter((venue) => venue.scenePoint && counts[venue.id] > 0)
      .sort((a, b) => Number(b.id === selectedVenueId) - Number(a.id === selectedVenueId)
        || counts[b.id] - counts[a.id] || a.id.localeCompare(b.id));
    const offsets = spreadPins(withCounts.map((venue) => ({
      id: venue.id, x: (venue.scenePoint as [number, number])[0], z: (venue.scenePoint as [number, number])[1],
    })));
    return withCounts.map((venue, index) => ({ venue, offset: offsets[index] }));
  }, [counts, selectedVenueId]);

  const roads = useMemo(() => [...campusRoads].sort((a, b) => ROAD_ORDER[a.kind] - ROAD_ORDER[b.kind] || b.length - a.length), []);
  const selected = venues.find((venue) => venue.id === selectedVenueId);

  return <div className="map-2d">
    <div className="map-2d-inner" data-viewbox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}>
      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-label="Yunus Emre Kampüsü haritası; kampüs sınırı, yollar ve bina ayak izleri OpenStreetMap verisinden"
      >
        <defs>
          <filter id="building-shadow" x="-15%" y="-15%" width="130%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#31514a" floodOpacity="0.2" />
          </filter>
          <style>{`.map-2d-landmark text{font-size:${(10 / scale).toFixed(1)}px;font-weight:750;fill:#3d6152;letter-spacing:.02em}
            .map-2d-debug{font-size:${(16 / scale).toFixed(1)}px;font-weight:800;fill:#b8452f}`}</style>
        </defs>

        <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="#e4ece1" />
        <path d={pointsToPath(campus.boundary, true)} fill="#d7e3c9" stroke="#bccdb2" strokeWidth={4 / scale} />

        {campusGreen.map((area) => <path
          key={area.id}
          d={pointsToPath(area.points, true)}
          fill={area.kind === 'forest' ? '#a9c79c' : area.kind === 'parking' ? '#c5c7c2' : area.kind === 'garden' ? '#bcd7a8' : '#bdd6ac'}
        />)}

        {campusWater.map((area) => <path
          key={area.id} d={pointsToPath(area.points, true)} fill={WATER_COLOR} stroke="#7fb3bd" strokeWidth={1.5 / scale}
        />)}

        {roads.map((road) => <path
          key={road.id}
          d={pointsToPath(road.points)}
          fill="none"
          stroke={ROAD_COLORS[road.kind] ?? '#c3c0b6'}
          strokeWidth={road.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />)}

        {campusGates.filter((gate) => gate.onBoundary).map((gate) => <g key={gate.id}>
          <circle cx={gate.point[0]} cy={gate.point[1]} r={7 / scale} fill="#fdfbf3" stroke="#7c8f7d" strokeWidth={3 / scale} />
          <circle cx={gate.point[0]} cy={gate.point[1]} r={2.4 / scale} fill="#7c8f7d" />
        </g>)}

        {campusBuildings.filter((building) => !venueByOsmId.has(building.id)).map((building) => {
          const isFocused = building.id === highlightBuildingId;
          return <path
            key={building.id}
            d={pointsToPath(building.points, true)}
            fill={building.color}
            stroke={isFocused ? '#e97657' : '#fbfcf6'}
            strokeWidth={(isFocused ? 3.4 : 1.6) / scale}
            filter={isFocused ? 'url(#building-shadow)' : undefined}
          />;
        })}

        {campusBuildings.filter((building) => venueByOsmId.has(building.id)).map((building) => {
          const isSelected = selected?.osmId === building.id;
          return <path
            key={building.id}
            d={pointsToPath(building.points, true)}
            fill={building.color}
            stroke={isSelected ? '#e97657' : '#fffdf2'}
            strokeWidth={(isSelected ? 3.4 : 1.6) / scale}
            filter="url(#building-shadow)"
          />;
        })}

        {showLandmarks && venues.filter((venue) => venue.footprint).map((venue) => {
          const [cx, cz] = venue.scenePoint ?? [0, 0];
          const width = Math.max(78, venue.shortName.length * 7.4);
          return <g key={venue.id} className="map-2d-landmark">
            <rect
              x={cx - width / 2} y={cz - 8.5} width={width} height={17} rx={4}
              fill="rgba(255,253,245,.92)" stroke="#c7d9c7" strokeWidth={1.2 / scale}
            />
            <text x={cx} y={cz + 3.6} textAnchor="middle">{venue.shortName}</text>
          </g>;
        })}
        {debugOverlay && <g className="map-2d-debug-layer">
          {Array.from({ length: 13 }, (_, index) => -1500 + index * 250).map((x) => <line
            key={`v${x}`} x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.height}
            stroke={x === 0 ? '#b8452f' : 'rgba(60,90,80,.28)'} strokeWidth={(x === 0 ? 3 : 1.5) / scale}
          />)}
          {Array.from({ length: 9 }, (_, index) => -1000 + index * 250).map((z) => <line
            key={`h${z}`} x1={viewBox.x} y1={z} x2={viewBox.x + viewBox.width} y2={z}
            stroke={z === 0 ? '#b8452f' : 'rgba(60,90,80,.28)'} strokeWidth={(z === 0 ? 3 : 1.5) / scale}
          />)}
        </g>}
      </svg>

      {pins.map(({ venue, offset }) => (
        <button
          key={venue.id} type="button"
          className={`map-pin map-pin-2d ${selectedVenueId === venue.id ? 'is-selected' : ''}${live.has(venue.id) ? ' is-live' : ''}`}
          style={{
            ...viewBoxToPercent(viewBox, venue.scenePoint as [number, number]),
            marginTop: `${offset.dy}px`,
          }}
          onClick={() => onSelectVenue(venue.id)}
          aria-label={`${venue.name}: ${counts[venue.id]} etkinlik${live.has(venue.id) ? ', şu an etkinlik sürüyor' : ''}`}
        ><span className="map-pin-count">{counts[venue.id]}</span><span className="map-pin-label">{venue.shortName}</span></button>
      ))}

      {debugOverlay && <>
        <span className="map-debug-note">x doğu + · z güney + · 250 m ızgara</span>
        {venues.filter((venue) => venue.scenePoint).map((venue) => <span
          key={`debug-${venue.id}`} className="map-debug-label"
          style={viewBoxToPercent(viewBox, venue.scenePoint as [number, number])}
        >{`${venue.id} ${(venue.scenePoint as number[]).map((value) => Math.round(value)).join(',')}`}</span>)}
        {campusGates.filter((gate) => gate.onBoundary).map((gate) => <span
          key={`debug-gate-${gate.id}`} className="map-debug-label is-gate"
          style={viewBoxToPercent(viewBox, gate.point)}
        >{gate.name || gate.id}</span>)}
      </>}
    </div>
  </div>;
}
