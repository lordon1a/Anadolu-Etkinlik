import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { campus, campusTrees, terrainHeightAt, viewBoxFor, viewBoxToPercent } from '../src/lib/campus';
import { venues } from '../src/data/campus';
import { matchVenue } from '../scripts/event-source.mjs';

const boundary = campus.boundary;
const insideBoundary = ([x, z]: [number, number]) => {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i, i += 1) {
    const [ax, az] = boundary[i];
    const [bx, bz] = boundary[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
};

describe('generated campus geometry', () => {
  it('keeps every building centre inside the mapped campus boundary', () => {
    const outside = campus.buildings.filter((building) => !insideBoundary(building.center as [number, number]));
    expect(outside.map((building) => `${building.id} ${building.name}`)).toEqual([]);
  });

  it('fits every feature inside the declared extent', () => {
    const { minX, maxX, minZ, maxZ } = campus.extent;
    for (const points of campus.buildings.map((building) => building.points)) {
      for (const [x, z] of points) {
        expect(x).toBeGreaterThanOrEqual(minX);
        expect(x).toBeLessThanOrEqual(maxX);
        expect(z).toBeGreaterThanOrEqual(minZ);
        expect(z).toBeLessThanOrEqual(maxZ);
      }
    }
  });

  it('gives every building a height with a traceable source', () => {
    for (const building of campus.buildings) {
      expect(building.height).toBeGreaterThan(2);
      expect(['osm-height', 'osm-levels', 'estimated-from-area']).toContain(building.heightSource);
    }
  });

  it('has the campus landmarks the official plan names', () => {
    const labels = campus.landmarks.map((landmark) => landmark.label);
    expect(labels).toContain('AKM');
    expect(labels).toContain('Öğrenci Merkezi');
    expect(labels).toContain('Kütüphane');
    expect(labels).toContain('Sinema');
    expect(labels).toContain('Turizm');
    expect(labels).toContain('EMYO');
    // The plan's other named blocks have no venue entry, so LANDMARK_ORDER has to
    // reach them through their building ids; a display name there would match
    // nothing, and listing two ids for one faculty would print the label twice.
    expect(labels).toContain('Rektörlük');
    expect(labels).toContain('İletişim Fakültesi');
    expect(labels).toContain('Sağlık Bilimleri Fakültesi');
    expect(labels.filter((label) => label === 'İktisadi ve İdari Bilimler Fakültesi')).toEqual(['İktisadi ve İdari Bilimler Fakültesi']);
    // Small named blocks the plan numbers keep their labels too, so the budget
    // must not shrink back to the venue count.
    expect(labels).toContain('Basımevi 1');
    expect(labels).toContain('Endüstriyel Sanatlar Yüksekokulu ve Heykel Bölümü Atölyeleri');
    expect(labels).toContain('AÖF Kitap Deposu');
    expect(labels).toContain('Anadolu Üniversitesi Yabancı Diller Yüksekokulu');
  });

  it('scatters trees outside buildings', () => {
    const trees = campusTrees();
    expect(trees.length).toBeGreaterThan(100);
    const inBuilding = trees.filter((tree) => campus.buildings.some((building) => {
      const [cx, cz] = building.center;
      return Math.hypot(cx - tree.x, cz - tree.z) < 4;
    }));
    expect(inBuilding).toEqual([]);
  });

  it('names the gates the official plan numbers, and nothing else', () => {
    const named = campus.gates.filter((gate) => gate.name).map((gate) => gate.name).sort();
    expect(named).toEqual([
      'Cuma Kapısı',
      'Cumhuriyet Kapısı',
      'Lojmanlar Bölgesi Kapısı',
      'Tepebaşı–Eczacılık Kapısı',
    ].sort());
    for (const gate of campus.gates.filter((item) => item.name)) {
      expect(gate.onBoundary, `${gate.name} should sit on the campus edge`).toBe(true);
      expect(gate.distanceToBoundary).toBeLessThanOrEqual(40);
      expect(gate.evidence).toMatch(/campus plan/i);
      // Gate names come from the plan, but its marker coordinates were not usable.
      expect(gate.plan).toBeNull();
    }
    for (const gate of campus.gates.filter((item) => !item.name)) {
      expect(gate.plan).toBeNull();
      expect(gate.evidence).toMatch(/no name/i);
    }
  });

  it('builds every building on the terrain grid the scene renders', () => {
    // groundElevation is sampled by the generator from the same grid that
    // terrainHeightAt reads, so a row/column mismatch between the two would show
    // up here as buildings floating above or sunk into the ground.
    for (const building of campus.buildings) {
      const lowestCorner = Math.min(...building.points.map((point) => terrainHeightAt(point)));
      expect(Math.abs(building.groundElevation - lowestCorner), `${building.id} ${building.name}`).toBeLessThanOrEqual(1);
    }
  });
});

// The local frame is x east, z south, y up (research/campus-data.md "İzdüşüm").
// These checks pin the direction with real-world coordinates, so a sign flip in
// the generator cannot pass unnoticed.
describe('campus orientation', () => {
  // Named positions recorded from the OSM extract (ways 374982336, 374982357,
  // 374262148) and the project handoff notes: latitude/longitude are the ground
  // truth, the local metres must follow them.
  const realPositions = {
    'ogrenci-merkezi': { lat: 39.792863, lon: 30.500227 },
    akm: { lat: 39.791214, lon: 30.499968 },
    turizm: { lat: 39.793287, lon: 30.492415 },
  };
  const centerOf = (id: string) => campus.venues.find((venue) => venue.id === id)?.center as [number, number];

  it('puts the north of the campus at smaller z', () => {
    // Öğrenci Merkezi (39.792863) is north of AKM (39.791214), so it must have the smaller z.
    expect(centerOf('ogrenci-merkezi')[1]).toBeLessThan(centerOf('akm')[1]);
    expect(centerOf('ogrenci-merkezi')[1]).toBeLessThan(0);
    expect(centerOf('akm')[1]).toBeGreaterThan(0);
  });

  it('keeps the west of the campus at negative x', () => {
    // Turizm Fakültesi (30.492415) sits west of the campus centre (30.5006767).
    expect(centerOf('turizm')[0]).toBeLessThan(0);
  });

  it('reproduces the recorded positions from the published projection', () => {
    // The recorded coordinates are approximate footprint averages, so the
    // tolerance covers a few metres; the old sign error was off by 150 m+.
    for (const [id, { lat, lon }] of Object.entries(realPositions)) {
      const [x, z] = centerOf(id);
      const expectedX = (lon - campus.origin.lon) * campus.projection.metresPerDegLon;
      const expectedZ = (campus.origin.lat - lat) * campus.projection.metresPerDegLat;
      expect(Math.abs(x - expectedX), `${id} x`).toBeLessThan(15);
      expect(Math.abs(z - expectedZ), `${id} z`).toBeLessThan(15);
    }
  });
});

describe('venue placement', () => {
  it('anchors footprint venues on their own footprint centre', () => {
    for (const venue of venues.filter((item) => item.position === 'footprint')) {
      const building = campus.buildings.find((item) => item.id === venue.osmId);
      expect(building, `${venue.id} should reference a generated building`).toBeTruthy();
      expect(venue.footprint).toEqual(building?.points);
      expect(venue.height).toBe(building?.height);
      // Campuses features that the official plan does not number (cafeteria, mosque) carry no plan number.
      if (venue.plan !== null) expect(venue.plan).toBeGreaterThan(0);
      expect(venue.evidence.length).toBeGreaterThan(30);
    }
  });

  it('gives each mapped building one venue owner and one landmark label', () => {
    // The open-air stand area in front of the cinema is an alias of Sinema
    // Anadolu, not a venue of its own, so nothing can repaint or relabel the
    // cinema block and the street keeps dropping on the same pin.
    const table = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));
    expect(table.map((venue: { id: string }) => venue.id)).not.toContain('sinema-sokak');
    const building = campus.buildings.find((item) => item.id === 'way/374187005');
    const cinema = venues.find((venue) => venue.id === 'sinema');
    expect(building?.style).toBe('culture');
    expect(building?.color).toBe(cinema?.color);
    expect(campus.landmarks.filter((landmark) => landmark.label === 'Sinema')).toHaveLength(1);
  });

  it('never places an unverified venue on the map', () => {
    for (const venue of venues.filter((item) => item.position === 'unverified')) {
      expect(venue.scenePoint, `${venue.id} must not be drawn`).toBeNull();
      expect(venue.footprint, `${venue.id} must not be drawn`).toBeNull();
    }
  });

  it('keeps the event-matching table free of coordinates', () => {
    // Coordinates once lived in data/venues.json and quietly drifted from the map.
    const table = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));
    expect(table.length).toBe(venues.length);
    for (const venue of table) {
      expect(venue.aliases.length, `${venue.id} needs aliases`).toBeGreaterThan(0);
      for (const key of ['x', 'z', 'width', 'depth', 'height', 'color']) {
        expect(venue[key], `${venue.id}.${key} must not be in the event table`).toBeUndefined();
      }
      expect(venue.position).toMatch(/^(footprint|unverified)$/);
    }
    expect(table.map((venue: { id: string }) => venue.id)).toEqual(venues.map((venue) => venue.id));
  });

  it('keeps every pin inside the campus boundary', () => {
    for (const venue of venues.filter((item) => item.scenePoint)) {
      expect(insideBoundary(venue.scenePoint as [number, number]), `${venue.id} pin outside campus`).toBe(true);
    }
  });

  it('nudges footprint pins outside their own geometry, not just to the centre', () => {
    for (const venue of venues.filter((item) => item.position === 'footprint' && item.scenePoint)) {
      const [px, pz] = venue.scenePoint as [number, number];
      const center = campus.buildings.find((item) => item.id === venue.osmId)?.center as [number, number];
      const distance = Math.hypot(px - center[0], pz - center[1]);
      expect(distance, `${venue.id} pin should sit on the building edge`).toBeGreaterThan(1);
      expect(distance, `${venue.id} pin should stay on the building`).toBeLessThan(15);
    }
  });

  it('keeps venue ids unique and stable for event matching', () => {
    const ids = venues.map((venue) => venue.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['akm', 'sinema', 'salon-2003', 'ogrenci-merkezi', 'hukuk', 'kongre', 'egitim', 'biltek-myo', 'kyk-bankamatikler']) {
      expect(ids, `event data depends on venue id ${id}`).toContain(id);
    }
  });
});

describe('event matching against the new venue table', () => {
  const realPlaces = [
    ['Öğrenci Merkezi Yunus Emre Salonu', 'ogrenci-merkezi'],
    ['Öğrenci Merkezi Nasrettin Hoca Salonu ve Fuaye Alanı', 'ogrenci-merkezi'],
    ['ğrenci Merkezi Yunus Emre Salonu', 'ogrenci-merkezi'],
    ['Öğrenci Mrekezi Yunus Emre Salonu', 'ogrenci-merkezi'],
    ['Fuaye Alanı', 'ogrenci-merkezi'],
    ['Koral Çalgan Salonu', 'salon-2003'],
    ['Hukuk Fakültesi Amfi-1', 'hukuk'],
    ['Turizm Fakültesi Amfi-1 ve 3', 'turizm'],
    ['Sinema Anadolu', 'sinema'],
    ['Sinema Anadolu Önü', 'sinema'],
    ['Sinema Anadolu Sokak', 'sinema'],
    ['Sinema Anadolu Sokağı', 'sinema'],
    ['Çağdaş Sanatlar Müzesi', 'cagdas-muze'],
    ['Yunus Emre Salonu', 'ogrenci-merkezi'],
    ['Bilişim Teknolojileri Meslek Yüksekokulu Konferans Salonu', 'biltek-myo'],
    ['Bilişim Bloğu', 'biltek-myo'],
    ['KYK ve Bankamatikler Önü', 'kyk-bankamatikler'],
    ['Kongre Merkezi', 'kongre'],
    ['Salon Anadolu', 'kongre'],
  ] as const;

  it('still matches the places the live event feed uses', () => {
    const table = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));
    for (const [place, id] of realPlaces) {
      expect(matchVenue(place, table), place).toBe(id);
    }
  });

  it('leaves outdoor and off-campus places without a building', () => {
    const table = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));
    for (const place of ['Yunus Emre Yazı Sanatları Müzesi', 'Anadolu Park']) {
      expect(matchVenue(place, table), place).toBeNull();
    }
  });

  it('puts the later-verified footprints on the map', () => {
    const table = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));
    // These places used to have no venue or no position; both are drawn now.
    const expected = [
      ['KYK ve Bankamatikler Önü', 'kyk-bankamatikler'],
      ['Bilişim Teknolojileri Meslek Yüksekokulu Konferans Salonu', 'biltek-myo'],
      ['Kongre Merkezi', 'kongre'],
    ] as const;
    for (const [place, id] of expected) {
      const matched = venues.find((venue) => venue.id === matchVenue(place, table));
      expect(matched?.position, place).toBe('footprint');
      expect(matched?.scenePoint, place).not.toBeNull();
    }
  });

  it('sends the new-dining-hall area to the new dining hall, not to the cinema', () => {
    const table = JSON.parse(readFileSync(new URL('../data/venues.json', import.meta.url), 'utf8'));
    // "Yeni Yemekhane Önü" is the space in front of that building; the old table left it unmapped.
    expect(matchVenue('Yeni Yemekhane Önü', table)).toBe('yeni-yemekhane');
    expect(matchVenue('Yeni Yemekhane ve Sinema Anadolu Önü', table)).toBe('yeni-yemekhane');
  });
});

describe('map projection', () => {
  it('keeps the campus inside the same view box for 3D and 2D', () => {
    for (const aspect of [5 / 3, 1.4, 0.7]) {
      const viewBox = viewBoxFor(aspect);
      expect(viewBox.width / viewBox.height).toBeCloseTo(aspect, 6);
      for (const [x, z] of campus.boundary) {
        expect(x).toBeGreaterThanOrEqual(viewBox.x);
        expect(x).toBeLessThanOrEqual(viewBox.x + viewBox.width);
        expect(z).toBeGreaterThanOrEqual(viewBox.y);
        expect(z).toBeLessThanOrEqual(viewBox.y + viewBox.height);
      }
    }
  });

  it('maps a centre point to the middle of the overlay', () => {
    const viewBox = viewBoxFor(5 / 3);
    const center = viewBoxToPercent(viewBox, [viewBox.x + viewBox.width / 2, viewBox.y + viewBox.height / 2]);
    expect(center).toEqual({ left: '50%', top: '50%' });
  });
});

describe('real event snapshot', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url), 'utf8'));
  const ids = new Set(venues.map((venue) => venue.id));

  it('only maps events to venues that exist in the new table', () => {
    for (const event of snapshot.events) {
      if (event.venueId) expect(ids, `${event.place} -> ${event.venueId}`).toContain(event.venueId);
    }
  });

  it('keeps unverified venues out of the drawn map but inside the list', () => {
    const unverified = new Set(venues.filter((venue) => venue.position === 'unverified').map((venue) => venue.id));
    for (const venue of venues.filter((item) => unverified.has(item.id))) {
      expect(venue.scenePoint).toBeNull();
    }
  });
});
