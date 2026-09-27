// Stylised ground for the 3D scene: the OSM campus geometry drawn into one
// canvas, so the surface needs no satellite tiles at all.
//
// The canvas covers exactly `groundLayer.box` — the rectangle the DEM grid and
// the ground plane share — with row 0 at the north edge, so the texture lines up
// with the terrain, the trees and the buildings without any offset tricks. The
// palette matches the stylised 2D map (sage greens, cream roads, blue-green
// water), so both views read as one design.
import { campus, groundLayer, type Point } from './campus';

/** A 1.7 km campus box at 2 px/m; capped so the texture stays a sane size. */
const MAX_PIXELS = 8_000_000;
const MAX_SCALE = 2;
const MIN_SCALE = 1;

export const GROUND_COLORS = {
  /** Ground beyond the campus fence: muted, and the fog dissolves it into the sky. */
  outside: '#e3e9dd',
  campus: '#d7e3c9',
  water: '#8fc4cd',
  waterEdge: '#7fb3bd',
  boundary: '#a3b998',
  street: '#e8dfc8',
  service: '#eae3ce',
  footway: '#eee7d6',
  roadEdge: '#dbd1b6',
};

const GREEN_COLORS: Record<string, string> = {
  forest: '#a9c79c',
  park: '#bdd6ac',
  garden: '#bcd7a8',
  parking: '#c5c7c2',
};

const ROAD_COLORS: Record<string, string> = {
  street: GROUND_COLORS.street,
  service: GROUND_COLORS.service,
  footway: GROUND_COLORS.footway,
  steps: GROUND_COLORS.footway,
};

/** Canvas size for the styled ground, aspect-locked to the DEM box. */
export function styledGroundSize(): { width: number; height: number; scale: number } {
  const width = groundLayer.box.maxX - groundLayer.box.minX;
  const depth = groundLayer.box.maxZ - groundLayer.box.minZ;
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.sqrt(MAX_PIXELS / (width * depth))));
  return { width: Math.round(width * scale), height: Math.round(depth * scale), scale };
}

/** Paints the campus: neutral ground, campus fill, green areas, water, roads, fence line. */
export function drawStyledGround(): HTMLCanvasElement | null {
  const { width, height, scale } = styledGroundSize();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const toX = (x: number) => (x - groundLayer.box.minX) * scale;
  const toY = (z: number) => (z - groundLayer.box.minZ) * scale;
  const trace = (points: Point[], close: boolean) => {
    context.beginPath();
    points.forEach(([x, z], index) => {
      if (index === 0) context.moveTo(toX(x), toY(z));
      else context.lineTo(toX(x), toY(z));
    });
    if (close) context.closePath();
  };

  context.fillStyle = GROUND_COLORS.outside;
  context.fillRect(0, 0, width, height);

  trace(campus.boundary, true);
  context.fillStyle = GROUND_COLORS.campus;
  context.fill();

  for (const area of campus.green) {
    trace(area.points, true);
    context.fillStyle = GREEN_COLORS[area.kind] ?? GREEN_COLORS.park;
    context.fill();
  }

  for (const area of campus.water) {
    trace(area.points, true);
    context.fillStyle = GROUND_COLORS.water;
    context.fill();
    context.strokeStyle = GROUND_COLORS.waterEdge;
    context.lineWidth = Math.max(1, 1.5 * scale);
    context.stroke();
  }

  // Roads are cream strips; a wide casing pass first keeps junctions tidy.
  const roads = [...campus.roads].sort((a, b) => b.width - a.width);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const strokeRoads = (extra: number, colorOf: (road: typeof roads[number]) => string) => {
    for (const road of roads) {
      trace(road.points, false);
      context.strokeStyle = colorOf(road);
      context.lineWidth = Math.max(1, road.width * scale + extra);
      context.stroke();
    }
  };
  strokeRoads(2 * scale, () => GROUND_COLORS.roadEdge);
  strokeRoads(0, (road) => ROAD_COLORS[road.kind] ?? GROUND_COLORS.service);

  trace(campus.boundary, true);
  context.strokeStyle = GROUND_COLORS.boundary;
  context.lineWidth = Math.max(1, 1.4 * scale);
  context.stroke();

  return canvas;
}
