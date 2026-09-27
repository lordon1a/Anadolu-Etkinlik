// Shared campus geometry, generated once from the OpenStreetMap extract so the
// 3D scene, the 2D map and the event pins cannot disagree. Regenerate with:
//   node research/build-campus-data.mjs
//
// Coordinates are local metres: x grows east, z grows south, y is up.
import geometry from '../data/campus-geometry.json';

export type Point = [number, number];

export type BuildingRoof = 'flat' | 'flat-parapet' | 'hip' | 'gable' | 'barrel';
export type BuildingGroup = 'university' | 'housing' | 'industrial' | 'religious' | 'school';

export type CampusBuilding = {
  id: string;
  name: string;
  group: BuildingGroup;
  points: Point[];
  center: Point;
  area: number;
  height: number;
  heightSource: 'osm-height' | 'osm-levels' | 'estimated-from-area';
  roof: BuildingRoof;
  style: string | null;
  color: string;
  housingRow: boolean;
  glassBand: boolean;
  /** Ground height under the building's lowest corner, metres above the lowest campus point. */
  groundElevation: number;
  /** How much the ground drops across the footprint; a large value means the block sits on a slope. */
  terrainDrop: number;
};

export type GroundLayer = {
  attribution: { text: string; url: string }[];
  zoom: number;
  image: {
    /** Runtime satellite layer: tiles are fetched straight from the provider, never bundled. */
    urlTemplate: string;
    /** Full credit line shown while the satellite layer is on. */
    credit: string;
    tileRange: { left: number; right: number; top: number; bottom: number };
    tileSize: number;
    mosaicWidth: number;
    mosaicHeight: number;
    crop: { x: number; y: number; width: number; height: number };
  };
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  grid: { size: number; values: number[] };
  baseElevation: number;
  stats: { min: number; max: number; mean: number };
};

export type VenuePosition = 'footprint' | 'node' | 'unverified';

export type CampusVenue = {
  id: string;
  name: string;
  shortName: string;
  plan: number | null;
  position: VenuePosition;
  style: string;
  color: string;
  aliases: string[];
  evidence: string;
  osm: string | null;
  footprint: Point[] | null;
  center: Point | null;
  area: number;
  height: number;
  heightSource: string;
  width: number;
  depth: number;
};

export type CampusRoad = {
  id: string;
  kind: 'street' | 'service' | 'footway' | 'steps';
  name: string;
  width: number;
  points: Point[];
  length: number;
};

export type CampusArea = {
  id: string;
  name: string;
  kind: 'park' | 'forest' | 'garden' | 'parking' | 'water' | 'pond';
  points: Point[];
  area: number;
  center: Point;
};

export type CampusGate = {
  id: string;
  name: string;
  /** Plan number is null: the university plan could not be tied to a gate position. */
  plan: number | null;
  access: string;
  point: Point;
  onBoundary: boolean;
  distanceToBoundary: number;
  evidence: string;
};

export type CampusLandmark = {
  id: string;
  label: string;
  center: Point;
  height: number;
  venue: boolean;
};

export type CampusExtent = {
  minX: number; maxX: number; minZ: number; maxZ: number; width: number; depth: number;
};

export type CampusGeometry = {
  attribution: { text: string; license: string; url: string };
  source: { extract: string; api: string; boundary: string; generatedBy: string };
  origin: { lat: number; lon: number };
  projection: { metresPerDegLat: number; metresPerDegLon: number; axes: string };
  extent: CampusExtent;
  ground: GroundLayer;
  boundary: Point[];
  venues: CampusVenue[];
  buildings: CampusBuilding[];
  roads: CampusRoad[];
  green: CampusArea[];
  water: CampusArea[];
  gates: CampusGate[];
  landmarks: CampusLandmark[];
};

export const campus = geometry as CampusGeometry;

export const campusExtent = campus.extent;
export const groundLayer = campus.ground;

/**
 * Pan/clamp box for the interactive 3D camera: the mapped campus edge with a
 * little breathing room, so the target can never leave the surveyed area.
 */
export const campusBounds = {
  minX: campusExtent.minX - 80,
  maxX: campusExtent.maxX + 80,
  minZ: campusExtent.minZ - 80,
  maxZ: campusExtent.maxZ + 80,
};

/**
 * Opening camera frame: the campus boundary itself, so the 3D view fills the
 * canvas with the surveyed area instead of with empty ground around it.
 */
export const campusFramePoints: [number, number, number][] = campus.boundary.map(
  ([x, z]) => [x, 0, z],
);

/** Metres above the lowest campus point at a local position, from the sampled DEM grid. */
export function terrainHeightAt([x, z]: Point): number {
  const { size, values } = groundLayer.grid;
  const { box } = groundLayer;
  const column = ((x - box.minX) / (box.maxX - box.minX)) * (size - 1);
  const row = ((z - box.minZ) / (box.maxZ - box.minZ)) * (size - 1);
  const c0 = Math.max(0, Math.min(size - 1, Math.floor(column)));
  const r0 = Math.max(0, Math.min(size - 1, Math.floor(row)));
  const c1 = Math.min(size - 1, c0 + 1);
  const r1 = Math.min(size - 1, r0 + 1);
  const tx = column - c0;
  const tz = row - r0;
  const at = (columnIndex: number, rowIndex: number) => values[rowIndex * size + columnIndex];
  const top = at(c0, r0) * (1 - tx) + at(c1, r0) * tx;
  const bottom = at(c0, r1) * (1 - tx) + at(c1, r1) * tx;
  return top * (1 - tz) + bottom * tz - groundLayer.baseElevation;
}

export const buildingById = new Map(campus.buildings.map((building) => [building.id, building]));

/** Buildings that only exist to give the campus its mass, without a venue role. */
export const campusBuildings = campus.buildings;

/**
 * Debug switches for visual checks, never active in normal use:
 *   ?debug=grid  — compass axes and a 250 m grid on the map
 *   ?debug=panel — map-only page layout
 *   ?only=3d     — the 3D scene fills the page, with the debug grid
 */
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const debugParam = params.get('debug');
export const debugOverlay = debugParam === 'grid' || debugParam === 'panel' || params.get('only') === '3d';
export const debugPanelOnly = debugParam === 'panel';
export const sceneOnly = params.get('only') === '3d';

export const campusRoads = campus.roads;
export const campusGreen = campus.green;
export const campusWater = campus.water;
export const campusGates = campus.gates;
export const campusLandmarks = campus.landmarks;

export function polygonCentroid(points: Point[]): Point {
  if (!points.length) return [0, 0];
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    area += cross;
    cx += (points[j][0] + points[i][0]) * cross;
    cz += (points[j][1] + points[i][1]) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    const total = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
    return [total[0] / points.length, total[1] / points.length];
  }
  return [cx / (6 * area), cz / (6 * area)];
}

/** Radius of a footprint measured from its centre, used for labels and outlines. */
export function footprintRadius(points: Point[]): number {
  const center = polygonCentroid(points);
  return points.reduce((max, point) => Math.max(max, Math.hypot(point[0] - center[0], point[1] - center[1])), 0);
}

/** Path for an SVG polygon/polyline. Coordinates are already local metres. */
export function pointsToPath(points: Point[], close = false): string {
  const path = points.map(([x, z], index) => `${index === 0 ? 'M' : 'L'}${x} ${z}`).join(' ');
  return close ? `${path} Z` : path;
}

/** Stable pseudo-random numbers for a coordinate pair, so scenery never jumps between renders. */
export function seededRandom(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

const coordinateSeed = (x: number, z: number) => Math.abs(Math.round(x) * 73856093 ^ Math.round(z) * 19349663);

export function jitter([x, z]: Point, amount: number): Point {
  const random = seededRandom(coordinateSeed(x, z));
  return [x + (random() - 0.5) * amount, z + (random() - 0.5) * amount];
}

export function pointInRing(ring: Point[], [x, z]: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

export type Tree = { x: number; z: number; scale: number };

/**
 * Trees are scenery, not survey data: OSM has no individual trees here, so the
 * positions are generated inside mapped forest and park areas and the map says so.
 */
export function campusTrees(): Tree[] {
  const trees: Tree[] = [];
  const zones = campus.green.filter((area) => area.kind === 'forest' || area.kind === 'park' || area.kind === 'garden');
  for (const zone of zones) {
    const spacing = zone.kind === 'forest' ? 20 : 26;
    for (let x = zone.center[0] - 90; x <= zone.center[0] + 90; x += spacing) {
      for (let z = zone.center[1] - 90; z <= zone.center[1] + 90; z += spacing) {
        const point = jitter([x, z], spacing * 0.8);
        if (!pointInRing(zone.points, point)) continue;
        if (campus.buildings.some((building) => pointInRing(building.points, point))) continue;
        if (campus.roads.some((road) => road.points.some(([rx, rz]) => Math.hypot(rx - point[0], rz - point[1]) < road.width * 0.9))) continue;
        const random = seededRandom(coordinateSeed(point[0], point[1]));
        trees.push({ x: point[0], z: point[1], scale: 0.75 + random() * 0.5 });
      }
    }
  }
  return trees;
}

// ---------------------------------------------------------------- map viewports
// One projection for both views: local metres -> a rectangle that is fitted into
// the same box in the SVG (via viewBox) and in the browser overlay (via percentages).

export type ViewBox = { x: number; y: number; width: number; height: number };

export function viewBoxFor(aspect: number): ViewBox {
  const { minX, maxX, minZ, maxZ } = campusExtent;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  let width = maxX - minX;
  let height = maxZ - minZ;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;
  return { x: centerX - width / 2, y: centerZ - height / 2, width, height };
}

export function viewBoxToPercent(viewBox: ViewBox, [x, z]: Point): { left: string; top: string } {
  return {
    left: `${((x - viewBox.x) / viewBox.width) * 100}%`,
    top: `${((z - viewBox.y) / viewBox.height) * 100}%`,
  };
}

/**
 * Keeps map pins legible without moving them far: the first pin for a spot stays
 * on it, later pins that would land on top hang below in 26 px steps. Callers pass
 * pins in priority order (selected and busiest first), so those never move.
 */
export function spreadPins(items: { id: string; x: number | null; z: number | null }[], minGap = 22, step = 22) {
  const placed: { x: number; y: number }[] = [];
  return items.map((item) => {
    if (item.x === null || item.z === null) return { id: item.id, dy: 0 };
    let dy = 0;
    while (dy < step * 6 && placed.some((point) => Math.hypot(point.x - item.x!, point.y - (item.z! + dy)) < minGap)) {
      dy += step;
    }
    placed.push({ x: item.x, y: item.z + dy });
    return { id: item.id, dy };
  });
}
