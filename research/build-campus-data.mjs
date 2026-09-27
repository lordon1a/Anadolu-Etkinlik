// Turns the raw OSM extract into the geometry the map is built from.
//
//   node research/build-campus-data.mjs
//
// Output: src/data/campus-geometry.json — local metre coordinates (x east,
// z south, y up) for the campus boundary, building footprints, roads, water,
// green areas, gates and the venue anchors. Attribution: © OpenStreetMap
// contributors, ODbL 1.0.
//
// Nothing in the app measures latitude/longitude; the projection lives here so
// that the 3D scene and the 2D SVG cannot drift apart.
import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'node:fs/promises';
import { venueConfig } from './venue-config.mjs';

const OSM_ID = '269147024'; // Anadolu Üniversitesi campus boundary
const METRES_PER_DEG_LAT = 111132;
const METRES_PER_DEG_LON = 85540;
const CLIP_BUFFER_METRES = 60;
const EDGE_TOLERANCE_METRES = 0; // a building counts as on campus when its centre is inside the boundary polygon
const GATE_TOLERANCE_METRES = 40; // gate nodes sit on the fence line, a few metres off the drawn ring

const $ = cheerio.load(await readFile(new URL('./osm-yunus-emre-2026-09-26.osm', import.meta.url), 'utf8'), { xmlMode: true });
const tagsOf = (element) => Object.fromEntries($(element).children('tag').toArray()
  .map((tag) => [$(tag).attr('k'), $(tag).attr('v')]));
const nodes = new Map($('node').toArray().map((node) => [$(node).attr('id'), {
  lat: Number($(node).attr('lat')), lon: Number($(node).attr('lon')), tags: tagsOf(node),
}]));
const ways = new Map($('way').toArray().map((way) => [$(way).attr('id'), way]));
const wayLonLat = (way) => $(way).children('nd').toArray()
  .map((nd) => nodes.get($(nd).attr('ref'))).filter(Boolean).map((node) => [node.lon, node.lat]);

const boundaryLonLat = wayLonLat(ways.get(OSM_ID));
if (!boundaryLonLat) throw new Error(`Campus boundary way ${OSM_ID} is missing from the extract.`);
const lons = boundaryLonLat.map((point) => point[0]);
const lats = boundaryLonLat.map((point) => point[1]);
const ORIGIN = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];

// x: east (+) / west (-). z: south (+) / north (-) — screen-down in both views.
const project = ([lon, lat]) => [(lon - ORIGIN[0]) * METRES_PER_DEG_LON, (ORIGIN[1] - lat) * METRES_PER_DEG_LAT];
const round = ([x, z]) => [Math.round(x), Math.round(z)];
const toLocal = (lonLat) => round(project(lonLat));
const metresBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const boundary = boundaryLonLat.map(toLocal);
const boundaryExact = boundaryLonLat.map(project);

// Signed helpers for smoothing road vertices later on.
const pointInRing = (ring, [x, z]) => {
  let value = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i]; const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) value = !value;
  }
  return value;
};
const distanceToRing = (ring, [x, z]) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i]; const [bx, bz] = ring[j];
    const dx = bx - ax; const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
};

function polygonArea(points) {
  let total = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    total += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(total / 2);
}

function polygonCentroid(points) {
  let area = 0; let cx = 0; let cz = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    area += cross; cx += (points[j][0] + points[i][0]) * cross; cz += (points[j][1] + points[i][1]) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    return [points.reduce((sum, p) => sum + p[0], 0) / points.length,
      points.reduce((sum, p) => sum + p[1], 0) / points.length];
  }
  return [cx / (6 * area), cz / (6 * area)];
}

// Sutherland–Hodgman clip against a rectangle built around the boundary.
function clipToBox(points, box) {
  const corners = [[box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ]];
  let output = points;
  for (let edge = 0; edge < corners.length && output.length; edge += 1) {
    const a = corners[edge]; const b = corners[(edge + 1) % corners.length];
    const side = (point) => (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i]; const previous = input[(i + input.length - 1) % input.length];
      const currentSide = side(current); const previousSide = side(previous);
      if (currentSide >= 0) {
        if (previousSide < 0) {
          const t = previousSide / (previousSide - currentSide);
          output.push([previous[0] + t * (current[0] - previous[0]), previous[1] + t * (current[1] - previous[1])]);
        }
        output.push(current);
      } else if (previousSide >= 0) {
        const t = previousSide / (previousSide - currentSide);
        output.push([previous[0] + t * (current[0] - previous[0]), previous[1] + t * (current[1] - previous[1])]);
      }
    }
  }
  return output;
}

const HEIGHT_BY_AREA = (area) => {
  if (area < 120) return 4;
  if (area < 400) return 5.5;
  if (area < 900) return 7;
  if (area < 1800) return 8.5;
  if (area < 3200) return 10;
  return 12;
};

const LEVELLED_HEIGHT_METRES = 3.6;

function heightOf(tags, area) {
  const explicit = Number.parseFloat(tags.height ?? '');
  if (Number.isFinite(explicit) && explicit > 2 && explicit < 80) return { height: explicit, source: 'osm-height' };
  const levels = Number.parseInt(tags['building:levels'] ?? '', 10);
  if (Number.isFinite(levels) && levels >= 1 && levels <= 30) return { height: levels * LEVELLED_HEIGHT_METRES, source: 'osm-levels' };
  return { height: HEIGHT_BY_AREA(area), source: 'estimated-from-area' };
}

function styleGroup(tags, name) {
  if (tags.building === 'dormitory' || /yurt|lojman/i.test(name)) return 'housing';
  if (tags.building === 'warehouse' || tags.building === 'garage' || tags.building === 'industrial'
    || /depo|garaj|basımevi|ayniyat/i.test(name)) return 'industrial';
  if (tags.building === 'mosque' || tags.building === 'religious') return 'religious';
  if (tags.building === 'kindergarten' || tags.building === 'school') return 'school';
  return 'university';
}

const GROUP_COLORS = {
  university: ['#c9d6d0', '#bccbc4', '#d3dcd2', '#c2d0c6'],
  housing: ['#ded3bd', '#d6c9ae', '#e2d8c4'],
  industrial: ['#c6c9c3', '#b9bdb8', '#cdd0c9'],
  religious: ['#cdd6c4', '#c2cdbb'],
  school: ['#d6d9c2', '#c9d0b6'],
};

const hash = (value) => {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) % 100000;
  return result;
};

// Spread-free bounds: the point lists here are far past the argument limit.
function boundsOf(pointGroups) {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const points of pointGroups) {
    for (const [x, z] of points) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { minX, maxX, minZ, maxZ };
}

const campusBounds = boundsOf([boundary]);
const boundaryBox = {
  minX: campusBounds.minX - CLIP_BUFFER_METRES,
  maxX: campusBounds.maxX + CLIP_BUFFER_METRES,
  minZ: campusBounds.minZ - CLIP_BUFFER_METRES,
  maxZ: campusBounds.maxZ + CLIP_BUFFER_METRES,
};

// ---------------------------------------------------------------- relations
// Some campus buildings (the education faculty blocks) are mapped as
// multipolygon relations rather than closed ways. Outer member ways are joined
// end to end into rings; inner rings are ignored because the map only needs the
// outer silhouette.
const relations = new Map($('relation').toArray().map((relation) => [$(relation).attr('id'), relation]));

function relationOuterRings(relation) {
  const memberIds = $(relation).children('member').toArray()
    .filter((member) => $(member).attr('type') === 'way' && ($(member).attr('role') ?? '') !== 'inner')
    .map((member) => $(member).attr('ref'));
  const segments = memberIds.map((id) => (ways.has(id) ? wayLonLat(ways.get(id)) : null)).filter(Boolean);
  const rings = [];
  const open = segments.map((points) => [...points]);
  while (open.length) {
    let ring = open.shift();
    let extended = true;
    while (extended && ring.length) {
      extended = false;
      const start = ring[0];
      const end = ring[ring.length - 1];
      for (let i = 0; i < open.length; i += 1) {
        const candidate = open[i];
        const candidateStart = candidate[0];
        const candidateEnd = candidate[candidate.length - 1];
        const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
        if (same(end, candidateStart)) ring = ring.concat(candidate.slice(1));
        else if (same(end, candidateEnd)) ring = ring.concat([...candidate].reverse().slice(1));
        else if (same(start, candidateEnd)) ring = candidate.slice(0, -1).concat(ring);
        else if (same(start, candidateStart)) ring = [...candidate].reverse().slice(0, -1).concat(ring);
        else continue;
        open.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

const buildingCandidates = [];
for (const [id, way] of ways) {
  if (id === OSM_ID) continue;
  const tags = tagsOf(way);
  if (!tags.building) continue;
  const lonLat = wayLonLat(way);
  if (lonLat.length < 3) continue;
  buildingCandidates.push({ id: `way/${id}`, tags, lonLat });
}
for (const [id, relation] of relations) {
  const tags = tagsOf(relation);
  if (!tags.building) continue;
  for (const [index, ring] of relationOuterRings(relation).entries()) {
    if (ring.length < 4) continue;
    buildingCandidates.push({ id: `relation/${id}${index ? `#${index}` : ''}`, tags, lonLat: ring });
  }
}

console.log(`building candidates: ${buildingCandidates.length} (ways + relation rings)`);

// ---------------------------------------------------------------- buildings
const buildings = [];
for (const candidate of buildingCandidates) {
  const { id, tags, lonLat } = candidate;
  const points = lonLat.map(toLocal);
  const centroid = round(polygonCentroid(points));
  // Metre rounding can push a centroid a few centimetres across the ring, so the
  // exact ring decides when the rounded one says "outside".
  if (!pointInRing(boundary, centroid) && !pointInRing(boundaryExact, polygonCentroid(points))
    && distanceToRing(boundary, centroid) > EDGE_TOLERANCE_METRES) continue;
  const area = Math.round(polygonArea(points));
  if (area < 20) continue;
  const { height, source } = heightOf(tags, area);
  const name = tags.name ?? '';
  buildings.push({
    id,
    name,
    group: styleGroup(tags, name),
    points,
    center: centroid,
    area,
    height: Math.round(height * 10) / 10,
    heightSource: source,
    levels: Number.parseInt(tags['building:levels'] ?? '', 10) || null,
  });
}
buildings.sort((a, b) => b.area - a.area);

const buildingById = new Map(buildings.map((building) => [building.id, building]));
const venueByOsmId = new Map(venueConfig.filter((venue) => venue.osm).map((venue) => [venue.osm, venue]));

for (const building of buildings) {
  const venue = venueByOsmId.get(building.id);
  const seed = hash(building.id);
  let longest = 0;
  for (let i = 0; i < building.points.length; i += 1) {
    for (let j = i + 1; j < building.points.length; j += 1) {
      longest = Math.max(longest, metresBetween(building.points[i], building.points[j]));
    }
  }
  const width = building.area / Math.max(longest, 1);
  const tall = building.height >= 13 || (building.levels ?? 0) >= 5;

  building.style = venue?.style ?? null;
  if (tall) building.roof = 'flat-parapet';
  else if (venue?.style === 'historic') building.roof = 'hip';
  else if (venue?.style === 'culture') building.roof = width > 45 ? 'barrel' : 'hip';
  else if (building.group === 'industrial' || building.area > 2600) building.roof = 'flat';
  else if (building.area < 160) building.roof = 'flat-parapet';
  else if (building.area < 700) building.roof = 'gable';
  else building.roof = 'hip';

  const palette = GROUP_COLORS[building.group] ?? GROUP_COLORS.university;
  building.color = venue?.color ?? palette[seed % palette.length];
  building.housingRow = building.group === 'housing' && building.area < 600;
  building.glassBand = building.area > 1500 && !tall && building.roof !== 'gable';
}

// ---------------------------------------------------------------- venues
const venues = [];
for (const config of venueConfig) {
  const entry = {
    id: config.id,
    name: config.name,
    shortName: config.shortName,
    plan: config.plan,
    position: config.position,
    style: config.style,
    color: config.color,
    aliases: config.aliases,
    evidence: config.evidence,
    osm: config.osm,
    footprint: null,
    center: null,
    area: 0,
    height: 0,
    heightSource: 'none',
    width: 0,
    depth: 0,
  };
  if (config.position === 'footprint') {
    const building = buildingById.get(config.osm);
    if (!building) throw new Error(`Venue ${config.id} points at ${config.osm}, which is not a building in the extract.`);
    entry.footprint = building.points;
    entry.center = building.center;
    entry.area = building.area;
    entry.height = building.height;
    entry.heightSource = building.heightSource;
    entry.width = Math.round(boundsOf([building.points]).maxX - boundsOf([building.points]).minX);
    entry.depth = Math.round(boundsOf([building.points]).maxZ - boundsOf([building.points]).minZ);
  } else if (config.position === 'node') {
    const node = nodes.get(config.osm.split('/')[1]);
    if (!node) throw new Error(`Venue ${config.id} points at ${config.osm}, which is not in the extract.`);
    entry.center = toLocal([node.lon, node.lat]);
  }
  venues.push(entry);
}

// ---------------------------------------------------------------- roads
const ROAD_KINDS = {
  residential: 'street', unclassified: 'street', living_street: 'street', tertiary: 'street',
  secondary: 'street', primary: 'street', trunk: 'street',
  service: 'service', track: 'service',
  footway: 'footway', path: 'footway', steps: 'steps', pedestrian: 'footway', cycleway: 'footway',
};
const ROAD_WIDTH = { street: 7, service: 4.5, footway: 2.4, steps: 2 };
const roads = [];
for (const [id, way] of ways) {
  if (id === OSM_ID) continue;
  const tags = tagsOf(way);
  const kind = ROAD_KINDS[tags.highway];
  if (!kind) continue;
  const lonLat = wayLonLat(way);
  if (lonLat.length < 2) continue;
  const raw = lonLat.map((point) => project(point));
  if (!raw.some((point) => pointInRing(boundary, round(point)))) continue;
  const clipped = clipToBox(raw, boundaryBox);
  if (clipped.length < 2) continue;
  const points = clipped.map(round);
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += metresBetween(points[i - 1], points[i]);
  if (length < 8) continue;
  roads.push({ id: `way/${id}`, kind, name: tags.name ?? '', width: ROAD_WIDTH[kind], points, length: Math.round(length) });
}
roads.sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------- water and green
const water = [];
const green = [];
for (const [id, way] of ways) {
  if (id === OSM_ID) continue;
  const tags = tagsOf(way);
  const isWater = tags.natural === 'water' || tags.water === 'pond' || tags.water === 'lake';
  const isGreen = tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'grass'
    || tags.landuse === 'forest' || tags.leisure === 'pitch' || tags.leisure === 'sports_centre'
    || tags.amenity === 'parking';
  if (!isWater && !isGreen) continue;
  const lonLat = wayLonLat(way);
  if (lonLat.length < 4) continue;
  const points = lonLat.map(toLocal);
  if (polygonArea(points) < 40) continue;
  const centroid = round(polygonCentroid(points));
  if (!pointInRing(boundary, centroid)) continue;
  const record = { id: `way/${id}`, name: tags.name ?? '', points, area: Math.round(polygonArea(points)), center: centroid };
  if (isWater) water.push({ ...record, kind: 'water' });
  else if (tags.amenity === 'parking') green.push({ ...record, kind: 'parking' });
  else if (tags.landuse === 'forest') green.push({ ...record, kind: 'forest' });
  else if (tags.name === 'Japon Bahçesi') green.push({ ...record, kind: 'garden' });
  else green.push({ ...record, kind: 'park' });
}

// The pond that sits inside the Japanese Garden is the one the plan highlights.
const japaneseGarden = green.find((area) => area.name === 'Japon Bahçesi');
const ponds = water.filter((area) => area.area > 300);
if (japaneseGarden) {
  const nearest = ponds.map((area) => ({ area, distance: metresBetween(area.center, japaneseGarden.center) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest && nearest.distance < 150) nearest.area.kind = 'pond';
}

// ---------------------------------------------------------------- gates
// Official gate names come from the university's numbered campus plan. The plan
// is a multi-page PDF whose marker coordinates could not be trusted per gate, so
// the position evidence here is OSM's own: every named gate must sit on a road
// that actually crosses the campus boundary.
const CAMPUS_GATES = [
  { id: 'node/6809879162', name: 'Cuma Kapısı', road: 'way/213145829' },
  { id: 'node/6809879160', name: 'Cumhuriyet Kapısı', road: 'way/213145811' },
  { id: 'node/6809879161', name: 'Lojmanlar Bölgesi Kapısı', road: 'way/213145700' },
  { id: 'node/308844075', name: 'Tepebaşı–Eczacılık Kapısı', road: 'way/28118416' },
];

const gates = [];
for (const [id, node] of nodes) {
  if (node.tags.barrier !== 'gate' && node.tags.entrance !== 'main' && node.tags.entrance !== 'gate') continue;
  const point = toLocal([node.lon, node.lat]);
  const distance = Math.round(distanceToRing(boundary, point));
  const official = CAMPUS_GATES.find((gate) => gate.id === `node/${id}`);
  const road = official ? roads.find((item) => item.id === official.road) : null;
  gates.push({
    id: `node/${id}`,
    name: official?.name ?? node.tags.name ?? '',
    plan: null,
    access: node.tags.access ?? '',
    point,
    onBoundary: distance <= GATE_TOLERANCE_METRES,
    distanceToBoundary: distance,
    evidence: official
      ? `Name from the university's numbered campus plan. Position from OSM: the gate node sits ${distance} m from the drawn boundary and on ${official.road}, which leaves the campus here${road ? ` (${road.length} m run)` : ''}. The plan's own marker coordinate for this gate disagreed with OSM and was not used.`
      : 'OSM barrier/entrance node with no name; shown without an official name.',
  });
}
gates.sort((a, b) => Number(b.onBoundary) - Number(a.onBoundary) || a.point[0] - b.point[0]);

// ---------------------------------------------------------------- landmarks
// The places the official campus plan highlights keep their label above the rest.
// Entries are feature ids, so the same list ranks venues and plain buildings
// (Rektörlük, İletişim Fakültesi, Sağlık Bilimleri Fakültesi and the main
// İktisadi ve İdari Bilimler blocks carry no venue entry; the smaller İİBF annex
// way/374982362 keeps its area rank so the faculty label is not printed twice).
const LANDMARK_ORDER = ['akm', 'ogrenci-merkezi', 'kutuphane', 'sinema', 'cagdas-muze', 'emyo', 'turizm', 'hukuk',
  'way/275001627', 'way/374480092', 'way/374262152', 'way/374982363', 'yemekhane'];
const planRank = (featureId) => {
  const index = LANDMARK_ORDER.indexOf(featureId);
  return index < 0 ? null : 10000 - index;
};
// How many labels the scene carries. 29 keeps every venue plus the small named
// blocks the plan numbers: Basımevi 1, Endüstriyel Sanatlar, AÖF Kitap Deposu and
// Yabancı Diller Yüksekokulu sit at ranks 26–29.
const LANDMARK_LIMIT = 29;
const landmarks = [];
for (const venue of venues) {
  if (venue.position !== 'footprint') continue;
  landmarks.push({
    id: venue.id,
    label: venue.shortName,
    center: venue.center,
    height: venue.height,
    venue: true,
    // A venue the plan list does not name still outranks a plain building.
    score: planRank(venue.id) ?? 10001,
  });
}
for (const building of buildings) {
  if (!building.name || venueByOsmId.has(building.id) || building.area < 900) continue;
  landmarks.push({
    id: building.id,
    label: building.name.replace(/\s*\(.*?\)\s*/g, ' ').trim(),
    center: building.center,
    height: building.height,
    venue: false,
    score: planRank(building.id) ?? building.area,
  });
}
landmarks.sort((a, b) => b.score - a.score);

// ---------------------------------------------------------------- extent
const allBounds = boundsOf([boundary, ...buildings.map((building) => building.points),
  ...green.map((area) => area.points), ...water.map((area) => area.points)]);
const PADDING = 30;
const extent = {
  minX: Math.round(allBounds.minX - PADDING),
  maxX: Math.round(allBounds.maxX + PADDING),
  minZ: Math.round(allBounds.minZ - PADDING),
  maxZ: Math.round(allBounds.maxZ + PADDING),
};
extent.width = extent.maxX - extent.minX;
extent.depth = extent.maxZ - extent.minZ;

// -------------------------------------------------- ground (terrain + imagery)
// The elevation grid comes from research/build-ground-data.mjs; the imagery is
// only a run-time tile template (Esri World Imagery), never a bundled file.
// Buildings are given the ground height of their lowest corner so they sit on
// the terrain instead of floating over or sinking into it.
const ground = JSON.parse(await readFile(new URL('./ground/ground.json', import.meta.url), 'utf8'));
const { size: gridSize, values: elevationValues } = ground.grid;
const sampleElevation = ([x, z]) => {
  const column = ((x - ground.box.minX) / (ground.box.maxX - ground.box.minX)) * (gridSize - 1);
  const row = ((z - ground.box.minZ) / (ground.box.maxZ - ground.box.minZ)) * (gridSize - 1);
  const c0 = Math.max(0, Math.min(gridSize - 1, Math.floor(column)));
  const r0 = Math.max(0, Math.min(gridSize - 1, Math.floor(row)));
  const c1 = Math.min(gridSize - 1, c0 + 1);
  const r1 = Math.min(gridSize - 1, r0 + 1);
  const tx = column - c0;
  const tz = row - r0;
  const at = (column_, row_) => elevationValues[row_ * gridSize + column_];
  const top = at(c0, r0) * (1 - tx) + at(c1, r0) * tx;
  const bottom = at(c0, r1) * (1 - tx) + at(c1, r1) * tx;
  return top * (1 - tz) + bottom * tz;
};

const baseElevation = Math.round(ground.stats.min);
for (const building of buildings) {
  const heights = building.points.map(sampleElevation);
  building.groundElevation = Math.round(Math.min(...heights) - baseElevation);
  building.groundElevationTop = Math.round(Math.max(...heights) - baseElevation);
  building.terrainDrop = building.groundElevationTop - building.groundElevation;
}

const groundOutput = {
  attribution: ground.attribution,
  zoom: ground.zoom,
  image: {
    urlTemplate: ground.image.urlTemplate,
    credit: ground.image.credit,
    tileRange: ground.image.tileRange,
    tileSize: ground.image.tileSize,
    mosaicWidth: ground.image.mosaicWidth,
    mosaicHeight: ground.image.mosaicHeight,
    crop: ground.image.crop,
  },
  box: ground.box,
  grid: { size: ground.grid.size, values: ground.grid.values },
  baseElevation,
  stats: ground.stats,
};

const output = {
  attribution: {
    text: '© OpenStreetMap contributors',
    license: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
  },
  source: {
    extract: 'research/osm-yunus-emre-2026-09-26.osm',
    api: 'https://api.openstreetmap.org/api/0.6/map?bbox=30.4885,39.7845,30.5105,39.7955',
    boundary: `way/${OSM_ID}`,
    generatedBy: 'research/build-campus-data.mjs',
  },
  origin: { lat: Number(ORIGIN[1].toFixed(7)), lon: Number(ORIGIN[0].toFixed(7)) },
  projection: {
    metresPerDegLat: METRES_PER_DEG_LAT,
    metresPerDegLon: METRES_PER_DEG_LON,
    axes: 'x = east, z = south, y = up; coordinates rounded to whole metres',
  },
  extent,
  ground: groundOutput,
  boundary,
  venues,
  buildings: buildings.map((building) => ({
    id: building.id,
    name: building.name,
    group: building.group,
    points: building.points,
    center: building.center,
    area: building.area,
    height: building.height,
    heightSource: building.heightSource,
    roof: building.roof,
    style: building.style,
    color: building.color,
    housingRow: building.housingRow,
    glassBand: building.glassBand,
    groundElevation: building.groundElevation,
    terrainDrop: building.terrainDrop,
  })),
  roads,
  green,
  water,
  gates,
  landmarks: landmarks.slice(0, LANDMARK_LIMIT).map(({ score, ...rest }) => rest),
};

await writeFile(new URL('../src/data/campus-geometry.json', import.meta.url), `${JSON.stringify(output)}\n`, 'utf8');

// The event matcher reads data/venues.json; it must never carry coordinates of
// its own, so the venue table is written from the same config the map uses.
const PLAN_URL = 'https://cdn.anadolu.edu.tr/files/anadolu-cms/yxl4j0ed/uploads/map-8cfaf1325315cc4c.pdf';
const venueTable = venues.map((venue) => ({
  id: venue.id,
  name: venue.name,
  shortName: venue.shortName,
  aliases: venue.aliases,
  position: venue.position,
  plan: venue.plan,
  osm: venue.osm,
  source: venue.osm ? `https://www.openstreetmap.org/${venue.osm}` : `${PLAN_URL}#${venue.plan ?? ''}`,
  evidence: venue.evidence,
}));
await writeFile(new URL('../data/venues.json', import.meta.url), `${JSON.stringify(venueTable, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  boundaryPoints: boundary.length,
  buildings: output.buildings.length,
  namedBuildings: output.buildings.filter((building) => building.name).length,
  venues: {
    footprint: venues.filter((venue) => venue.position === 'footprint').length,
    node: venues.filter((venue) => venue.position === 'node').length,
    unverified: venues.filter((venue) => venue.position === 'unverified').length,
  },
  roads: roads.length,
  roadMetres: roads.reduce((sum, road) => sum + road.length, 0),
  green: green.length,
  water: water.map((area) => ({ id: area.id, kind: area.kind, area: area.area, center: area.center })),
  gates: gates.length,
  boundaryGates: gates.filter((gate) => gate.onBoundary).length,
  extent,
}, null, 2));
console.log('wrote src/data/campus-geometry.json');
console.log('wrote data/venues.json');

