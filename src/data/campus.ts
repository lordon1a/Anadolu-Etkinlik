// Venues for event matching plus the scene numbers each view needs.
// `aliases` is the event-matching table used by scripts/event-source.mjs;
// `x`, `z`, `width`, `depth`, `height` are metres in the shared campus frame.
import { campus, polygonCentroid, type Point } from '../lib/campus';
import type { Venue } from '../lib/types';

// Pin anchor helper.
function pinAnchor(center: Point | null, footprint: Point[] | null): Point | null {
  if (!center) return null;
  const geometry = footprint ?? [];
  const peak = geometry.reduce((best: Point | null, point) => (
    !best || point[1] < best[1] ? point : best), null) ?? [center[0], center[1] - 40];
  const centerTop = polygonCentroid(geometry);
  const dx = peak[0] - centerTop[0];
  const dz = peak[1] - centerTop[1];
  const length = Math.hypot(dx, dz) || 1;
  return [center[0] + (dx / length) * 6, center[1] + (dz / length) * 6];
}

export const venues: Venue[] = campus.venues.map((venue) => ({
  id: venue.id,
  name: venue.name,
  shortName: venue.shortName,
  aliases: venue.aliases,
  plan: venue.plan,
  position: venue.position,
  heightSource: venue.heightSource,
  evidence: venue.evidence,
  osmId: venue.osm,
  footprint: venue.footprint,
  scenePoint: pinAnchor(venue.center, venue.footprint),
  // 3D places the pin on the roof over the building centre, so it reads as sitting on the building.
  pinAnchor: venue.center,
  height: venue.height,
  color: venue.color,
  source: venue.osm
    ? `https://www.openstreetmap.org/${venue.osm}`
    : 'https://cdn.anadolu.edu.tr/files/anadolu-cms/yxl4j0ed/uploads/map-8cfaf1325315cc4c.pdf',
}));

export const venuesById = new Map(venues.map((venue) => [venue.id, venue]));

/** Venues that are safe to draw: anything OSM could place. */
export const mappedVenues = venues.filter((venue) => venue.position === 'footprint');

export const venueByOsmId = new Map(mappedVenues.map((venue) => [venue.osmId as string, venue]));
