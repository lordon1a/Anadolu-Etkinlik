export type EventItem = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  place: string;
  venueId: string | null;
  organiser: string;
  category: string;
  posterUrl: string | null;
  sourceUrl: string;
};

export type EventSnapshot = {
  source: string;
  updatedAt: string;
  timezone: 'Europe/Istanbul';
  events: EventItem[];
};

export type VenuePosition = 'footprint' | 'node' | 'unverified';

export type Venue = {
  id: string;
  name: string;
  shortName: string;
  aliases: string[];
  /** Number on the university's official campus plan, when the OSM feature could be matched to it. */
  plan: number | null;
  /** How the venue was placed: OSM area, OSM node only, or nowhere (event filtering only). */
  position: VenuePosition;
  heightSource: string;
  evidence: string;
  /** OpenStreetMap feature this venue was matched to, for example "way/374982336". */
  osmId: string | null;
  /** Footprint outline in metres (x east, z south), or null when the venue is not drawn. */
  footprint: [number, number][] | null;
  /** Where the 2D pin sits: footprint centre nudged towards the building's front. */
  scenePoint: [number, number] | null;
  /** Footprint centre, used by the 3D view so the pin lands on the roof. */
  pinAnchor: [number, number] | null;
  height: number;
  color: string;
  source: string;
};

export type Period = 'now' | 'today' | 'tomorrow' | 'week';
