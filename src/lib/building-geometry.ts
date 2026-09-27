// Building, roof and tree geometry for the 3D scene, kept out of the React
// component so the merge step (one draw call for every mass) can be unit-tested
// without WebGL.
//
// World axes: x east, z south, y up. Footprints are local metres on that plane,
// so every roof builder works in (x, z) and turns the result into triangles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  campusBuildings, pointInRing, type BuildingRoof, type CampusBuilding, type Point,
} from './campus';

// ---------------------------------------------------------------- constants

/** Floor-to-floor height the facade band shader draws. */
export const FLOOR_HEIGHT = 3.5;

/** Nothing is drawn thinner than this, however low the survey says it is. */
const MIN_MASS_HEIGHT = 3;
/** The roof never eats the whole wall: the eaves stay at least this high. */
const MIN_WALL_HEIGHT = 2.6;
const MAX_ROOF_RISE = 4.5;
const MIN_ROOF_RISE = 0.4;
/** Rise per metre of run (half of the short side of the roof frame). */
const ROOF_PITCH: Record<'gable' | 'hip' | 'barrel', number> = { gable: 0.55, hip: 0.6, barrel: 0.7 };
/** Fallback parapet for flat roofs: how far the rim is inset from the wall. */
const PARAPET_INSET = 0.35;
/** Steps used to sample a barrel vault's half circle. */
const BARREL_STEPS = 8;
/** Footprints below this area are too small to carry a roof (m²). */
const MIN_FOOTPRINT_AREA = 8;
const EPS = 1e-6;

// ---------------------------------------------------------------- footprint maths

type Line2 = { x: number; z: number; dx: number; dz: number };

const cross2 = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;

/** Shoelace area; positive means counter-clockwise on the (x, z) plane. */
function signedArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += cross2(ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
  }
  return sum / 2;
}

/** Drops repeated points and returns the ring wound counter-clockwise in (x, z). */
function cleanRing(points: Point[]): Point[] {
  const ring: Point[] = [];
  for (const point of points) {
    const last = ring[ring.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 1e-3) continue;
    ring.push([point[0], point[1]]);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-3) {
    ring.pop();
  }
  return signedArea(ring) < 0 ? ring.reverse() : ring;
}

function ringBounds(ring: Point[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Outward normal of the boundary edge a→b of a counter-clockwise ring. */
function edgeNormal([ax, az]: Point, [bx, bz]: Point): Point {
  const length = Math.hypot(bx - ax, bz - az);
  if (length < EPS) return [0, 0];
  return [(bz - az) / length, -(bx - ax) / length];
}

/** Inward normal of the boundary edge a→b of a counter-clockwise ring. */
function inwardNormal(a: Point, b: Point): Point {
  const [nx, nz] = edgeNormal(a, b);
  return [-nx, -nz];
}

/** Signed distance of a point to an infinite line, positive on one side. */
function lineDistance(line: Line2, x: number, z: number): number {
  return (x - line.x) * line.dz - (z - line.z) * line.dx;
}

// ---------------------------------------------------------------- roof frame

/**
 * Oriented frame around a footprint. `axis` follows the longest edge, so a
 * gable ridge built on it comes out parallel to that edge, and `halfDepth` is
 * the run the roof climbs from the eaves to the ridge.
 */
export type RoofFrame = {
  axis: Point;
  across: Point;
  center: Point;
  halfLength: number;
  halfDepth: number;
};

export function roofFrame(ring: Point[]): RoofFrame | null {
  let longest = 0;
  let direction: Point = [1, 0];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length > longest) {
      longest = length;
      direction = [dx / length, dz / length];
    }
  }
  if (longest < 1) return null;
  const axis = direction;
  const across: Point = [-axis[1], axis[0]];
  let tMin = Infinity;
  let tMax = -Infinity;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const [x, z] of ring) {
    const t = x * axis[0] + z * axis[1];
    const s = x * across[0] + z * across[1];
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  const halfDepth = (sMax - sMin) / 2;
  if (halfDepth < 0.4) return null;
  const tc = (tMin + tMax) / 2;
  const sc = (sMin + sMax) / 2;
  return {
    axis,
    across,
    center: [tc * axis[0] + sc * across[0], tc * axis[1] + sc * across[1]],
    halfLength: (tMax - tMin) / 2,
    halfDepth,
  };
}

function frameCoords(frame: RoofFrame, x: number, z: number): Point {
  const px = x - frame.center[0];
  const pz = z - frame.center[1];
  return [px * frame.axis[0] + pz * frame.axis[1], px * frame.across[0] + pz * frame.across[1]];
}

// ---------------------------------------------------------------- roof surfaces

/**
 * A roof plane written in frame coordinates: the value is 0 at the eaves and 1
 * at a full rise, and the surface is the smallest of its planes.
 */
type RoofPlane = { base: number; along: number; across: number };

export type RoofSurface = {
  kind: 'gable' | 'hip' | 'barrel';
  /** Fraction of the rise (0 at the eaves, 1 at the ridge/crown) at a point. */
  factorAt: (x: number, z: number) => number;
  /** Lines the surface creases along; roof triangles are split so none cross. */
  creases: Line2[];
};

/**
 * Each pair of planes meets in a line where the surface folds, so those lines
 * become footprint-space creases the triangulation is cut along. Extras are
 * harmless: splitting more than needed only adds coplanar triangles.
 */
function creaseLines(frame: RoofFrame, planes: RoofPlane[]): Line2[] {
  const lines: Line2[] = [];
  for (let i = 0; i < planes.length; i += 1) {
    for (let j = i + 1; j < planes.length; j += 1) {
      const along = planes[i].along - planes[j].along;
      const across = planes[i].across - planes[j].across;
      const base = planes[i].base - planes[j].base;
      const scale = along * along + across * across;
      if (scale < 1e-9) continue;
      const t0 = -(along * base) / scale;
      const s0 = -(across * base) / scale;
      const dx = -across * frame.axis[0] + along * frame.across[0];
      const dz = -across * frame.axis[1] + along * frame.across[1];
      const length = Math.hypot(dx, dz);
      if (length < 1e-9) continue;
      lines.push({
        x: frame.center[0] + t0 * frame.axis[0] + s0 * frame.across[0],
        z: frame.center[1] + t0 * frame.axis[1] + s0 * frame.across[1],
        dx: dx / length,
        dz: dz / length,
      });
    }
  }
  return lines;
}

/** Ridge parallel to the longest edge, running the whole footprint. */
function gableSurface(frame: RoofFrame): RoofSurface {
  const depth = frame.halfDepth;
  const planes: RoofPlane[] = [
    { base: 1, along: 0, across: -1 / depth },
    { base: 1, along: 0, across: 1 / depth },
  ];
  return {
    kind: 'gable',
    factorAt: (x, z) => {
      const [, s] = frameCoords(frame, x, z);
      return Math.max(0, Math.min(1, 1 - Math.abs(s) / depth));
    },
    creases: creaseLines(frame, planes),
  };
}

/**
 * Hipped roof: every side slopes in, and the ridge stops half a span short of
 * both ends, so the hips climb at 45° like a kırma çatı.
 */
function hipSurface(frame: RoofFrame): RoofSurface {
  const depth = frame.halfDepth;
  const end = Math.min(frame.halfLength, frame.halfDepth);
  const planes: RoofPlane[] = [
    { base: 1, along: 0, across: -1 / depth },
    { base: 1, along: 0, across: 1 / depth },
    { base: frame.halfLength / end, along: 1 / end, across: 0 },
    { base: frame.halfLength / end, along: -1 / end, across: 0 },
    { base: 1, along: 0, across: 0 },
  ];
  return {
    kind: 'hip',
    factorAt: (x, z) => {
      const [t, s] = frameCoords(frame, x, z);
      return Math.max(0, Math.min(1, Math.min(
        (depth - s) / depth,
        (depth + s) / depth,
        (t + frame.halfLength) / end,
        (frame.halfLength - t) / end,
        1,
      )));
    },
    creases: creaseLines(frame, planes),
  };
}

/** Half-cylinder vault along the frame axis, sampled across the span. */
function barrelSurface(frame: RoofFrame): RoofSurface {
  const depth = frame.halfDepth;
  const creases: Line2[] = [];
  const axisPlane: RoofPlane = { base: 0, along: 0, across: 0 };
  for (let step = 1; step < BARREL_STEPS; step += 1) {
    const s = -depth + (2 * depth * step) / BARREL_STEPS;
    creases.push(...creaseLines(frame, [axisPlane, { base: -s, along: 0, across: 1 }]));
  }
  return {
    kind: 'barrel',
    factorAt: (x, z) => {
      const [, s] = frameCoords(frame, x, z);
      const ratio = Math.min(1, Math.abs(s) / depth);
      return Math.sqrt(Math.max(0, 1 - ratio * ratio));
    },
    creases,
  };
}

// ---------------------------------------------------------------- roof plan

/**
 * What is actually built for a building. `kind` can differ from `requested`
 * when the footprint cannot carry that roof, in which case the safe fallback is
 * a flat mass (with a parapet rim for `flat-parapet`).
 */
export type RoofPlan = {
  kind: BuildingRoof;
  requested: BuildingRoof;
  /** Footprint ring the plan was built from, counter-clockwise in (x, z). */
  ring: Point[];
  /** Top of the walls; the roof occupies [wallTop, envelopeHeight]. */
  wallTop: number;
  /** Surveyed height (never below MIN_MASS_HEIGHT) the ridge/vault reaches. */
  envelopeHeight: number;
  /** Rise from the eaves to the ridge/crown, 0 when flat. */
  rise: number;
  frame: RoofFrame | null;
  surface: RoofSurface | null;
  /** Ridge centre (gable/hip) or vault crown (barrel), in footprint coordinates. */
  apex: Point | null;
  /** Ridge/vault direction, parallel to the longest edge of the footprint. */
  axis: Point | null;
  /** Parapet rim thickness for flat-parapet, 0 otherwise. */
  parapet: number;
};

/**
 * The roof is kept inside the surveyed height instead of stacked on top of it:
 * the walls stop at `wallTop` and the ridge reaches exactly `height`. That
 * keeps the mass on the orthophoto, the roof outlines and everything pinned to
 * a rooftop (`groundElevation + height`) lined up with the survey.
 */
export function planRoof(points: Point[], roof: BuildingRoof, height: number): RoofPlan {
  const envelopeHeight = Math.max(height, MIN_MASS_HEIGHT);
  const ring = cleanRing(points);
  const flat: RoofPlan = {
    kind: 'flat',
    requested: roof,
    ring,
    wallTop: envelopeHeight,
    envelopeHeight,
    rise: 0,
    frame: null,
    surface: null,
    apex: null,
    axis: null,
    parapet: 0,
  };
  if (ring.length < 3 || Math.abs(signedArea(ring)) < MIN_FOOTPRINT_AREA) return flat;
  if (roof === 'flat') return flat;
  const frame = roofFrame(ring);
  if (!frame) return flat;

  if (roof === 'flat-parapet') {
    const parapet = Math.min(0.8, Math.max(0.45, envelopeHeight * 0.08));
    if (!insetRing(ring, PARAPET_INSET)) return flat;
    return {
      ...flat,
      kind: 'flat-parapet',
      frame,
      apex: frame.center,
      axis: frame.axis,
      wallTop: envelopeHeight - parapet,
      parapet,
    };
  }

  // A ridge that does not sit over the building would tilt the whole roof the
  // wrong way, so those footprints keep the flat fallback instead.
  if (!pointInRing(ring, frame.center)) return flat;

  const available = Math.min(MAX_ROOF_RISE, envelopeHeight * 0.42, envelopeHeight - MIN_WALL_HEIGHT);
  const rise = Math.min(available, ROOF_PITCH[roof] * frame.halfDepth);
  if (rise < MIN_ROOF_RISE) return flat;

  const surface = roof === 'gable'
    ? gableSurface(frame)
    : roof === 'hip' ? hipSurface(frame) : barrelSurface(frame);
  return {
    ...flat,
    kind: roof,
    rise,
    frame,
    surface,
    apex: frame.center,
    axis: frame.axis,
    wallTop: envelopeHeight - rise,
  };
}

/** Inward miter copy of a ring, or null when a corner makes it fold over itself. */
function insetRing(ring: Point[], inset: number): Point[] | null {
  const inner: Point[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const previous = ring[(i - 1 + ring.length) % ring.length];
    const point = ring[i];
    const next = ring[(i + 1) % ring.length];
    const before = inwardNormal(previous, point);
    const after = inwardNormal(point, next);
    const miter: Point = [before[0] + after[0], before[1] + after[1]];
    const length = Math.hypot(miter[0], miter[1]);
    if (length < 1e-6) return null;
    // The miter reaches inset / sin(half the corner angle), so a sharp corner
    // would shoot a spike across the footprint; those rings stay rimless.
    const sinHalf = (before[0] * miter[0] + before[1] * miter[1]) / length;
    if (sinHalf < 0.35) return null;
    const scale = inset / sinHalf;
    inner.push([point[0] + (miter[0] / length) * scale, point[1] + (miter[1] / length) * scale]);
  }
  return inner.every((point) => pointInRing(ring, point)) ? inner : null;
}

// ---------------------------------------------------------------- triangulation

/** Ear-clipped triangles of a footprint, with degenerate slivers dropped. */
function triangulate(ring: Point[]): Point[][] {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const triangles: Point[][] = [];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const A = ring[a];
    const B = ring[b];
    const C = ring[c];
    if (Math.abs(cross2(B[0] - A[0], B[1] - A[1], C[0] - A[0], C[1] - A[1])) < 1e-6) continue;
    triangles.push([A, B, C]);
  }
  return triangles;
}

/** Splits a triangle along a line so that no piece crosses it. */
function splitTriangle(triangle: Point[], line: Line2): Point[][] {
  const distance = triangle.map(([x, z]) => lineDistance(line, x, z));
  if (distance.every((value) => Math.abs(value) <= EPS)) return [triangle];
  const onSide = (sign: number): Point[] => {
    const polygon: Point[] = [];
    for (let i = 0; i < triangle.length; i += 1) {
      const j = (i + 1) % triangle.length;
      const from = distance[i];
      const to = distance[j];
      if (sign * from >= -EPS) polygon.push(triangle[i]);
      if ((from > EPS && to < -EPS) || (from < -EPS && to > EPS)) {
        const t = from / (from - to);
        polygon.push([
          triangle[i][0] + (triangle[j][0] - triangle[i][0]) * t,
          triangle[i][1] + (triangle[j][1] - triangle[i][1]) * t,
        ]);
      }
    }
    return polygon;
  };
  const pieces: Point[][] = [];
  for (const sign of [1, -1]) {
    const polygon = onSide(sign);
    for (let i = 1; i + 1 < polygon.length; i += 1) pieces.push([polygon[0], polygon[i], polygon[i + 1]]);
  }
  return pieces.length ? pieces : [triangle];
}

/** Splits every triangle along every crease, so each piece stays flat. */
function refineTriangles(triangles: Point[][], lines: Line2[]): Point[][] {
  let current = triangles;
  for (const line of lines) {
    const next: Point[][] = [];
    for (const triangle of current) next.push(...splitTriangle(triangle, line));
    current = next;
  }
  return current;
}

/** Sub-segments of a boundary edge between its crease crossings. */
function splitSegment(from: Point, to: Point, lines: Line2[]): [Point, Point][] {
  const cuts = [0, 1];
  for (const line of lines) {
    const a = lineDistance(line, from[0], from[1]);
    const b = lineDistance(line, to[0], to[1]);
    if ((a > EPS && b < -EPS) || (a < -EPS && b > EPS)) cuts.push(a / (a - b));
  }
  cuts.sort((a, b) => a - b);
  const parts: [Point, Point][] = [];
  const at = (t: number): Point => [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    if (cuts[i + 1] - cuts[i] < 1e-6) continue;
    parts.push([at(cuts[i]), at(cuts[i + 1])]);
  }
  return parts;
}

// ---------------------------------------------------------------- geometry sink

type Vertex = [number, number, number];

export type MassTones = {
  /** Footprint-relative centre the mass is built around. */
  center: Point;
  wall: THREE.Color;
  roof: THREE.Color;
  /** World height of the building's ground, so the floor bands line up with it. */
  base: number;
  /** 1 when the survey tags the building as a glass-banded block. */
  glass: number;
};

/**
 * Collects mass triangles with their vertex tone and facade attributes. Every
 * triangle is wound so its normal agrees with a reference direction, which is
 * what keeps the hand-built roof faces facing out.
 */
function triangleSink(tones: MassTones) {
  const positions: number[] = [];
  const colors: number[] = [];
  const bands: number[] = [];
  return {
    triangle(a: Vertex, b: Vertex, c: Vertex, tone: THREE.Color, mask: number, reference: Vertex) {
      const ab: Vertex = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac: Vertex = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal: Vertex = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const facing = normal[0] * reference[0] + normal[1] * reference[1] + normal[2] * reference[2];
      const corners = facing < 0 ? [a, c, b] : [a, b, c];
      for (const corner of corners) {
        positions.push(corner[0], corner[1], corner[2]);
        colors.push(tone.r, tone.g, tone.b);
        // Per-vertex facade attributes: band mask, ground height, glass flag.
        bands.push(mask, tones.base, tones.glass);
      }
    },
    geometry() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('facadeBand', new THREE.Float32BufferAttribute(bands, 3));
      geometry.computeVertexNormals();
      return geometry;
    },
  };
}

// ---------------------------------------------------------------- roof geometry

/**
 * Turns a roof plan into triangles that hug the footprint. The roof itself is a
 * height field over the footprint that falls to 0 at the eaves, so it never
 * leaves the outline; wherever the boundary still carries height (gable ends,
 * vault ends, clipped hips) a vertical skirt closes the gap to the wall top.
 */
export function roofGeometry(plan: RoofPlan, tones: MassTones): THREE.BufferGeometry | null {
  if (plan.kind === 'flat-parapet') return parapetGeometry(plan, tones);
  const { frame, surface, rise } = plan;
  if (!frame || !surface || rise <= 0) return null;
  const sink = triangleSink(tones);
  const [centerX, centerZ] = tones.center;
  const heightAt = (x: number, z: number) => plan.wallTop + rise * surface.factorAt(x, z);
  const at = ([x, z]: Point): Vertex => [x - centerX, heightAt(x, z), z - centerZ];

  for (const piece of refineTriangles(triangulate(plan.ring), surface.creases)) {
    sink.triangle(at(piece[0]), at(piece[1]), at(piece[2]), tones.roof, 0, [0, 1, 0]);
  }

  for (let i = 0; i < plan.ring.length; i += 1) {
    const from = plan.ring[i];
    const to = plan.ring[(i + 1) % plan.ring.length];
    const [nx, nz] = edgeNormal(from, to);
    for (const [a, b] of splitSegment(from, to, surface.creases)) {
      const riseA = heightAt(a[0], a[1]) - plan.wallTop;
      const riseB = heightAt(b[0], b[1]) - plan.wallTop;
      if (Math.max(riseA, riseB) <= 1e-3) continue;
      const lowerA: Vertex = [a[0] - centerX, plan.wallTop, a[1] - centerZ];
      const lowerB: Vertex = [b[0] - centerX, plan.wallTop, b[1] - centerZ];
      const upperB: Vertex = [b[0] - centerX, plan.wallTop + riseB, b[1] - centerZ];
      const upperA: Vertex = [a[0] - centerX, plan.wallTop + riseA, a[1] - centerZ];
      sink.triangle(lowerA, lowerB, upperB, tones.wall, 1, [nx, 0, nz]);
      sink.triangle(lowerA, upperB, upperA, tones.wall, 1, [nx, 0, nz]);
    }
  }

  return sink.geometry();
}

/** Parapet rim around a flat deck: outer face, top and inner face per edge. */
function parapetGeometry(plan: RoofPlan, tones: MassTones): THREE.BufferGeometry | null {
  const inner = insetRing(plan.ring, PARAPET_INSET);
  if (!inner) return null;
  const sink = triangleSink(tones);
  const [centerX, centerZ] = tones.center;
  const bottom = plan.wallTop;
  const top = plan.envelopeHeight;
  const vertex = ([x, z]: Point, y: number): Vertex => [x - centerX, y, z - centerZ];
  for (let i = 0; i < plan.ring.length; i += 1) {
    const j = (i + 1) % plan.ring.length;
    const outerFrom = plan.ring[i];
    const outerTo = plan.ring[j];
    const innerFrom = inner[i];
    const innerTo = inner[j];
    const [nx, nz] = edgeNormal(outerFrom, outerTo);
    const outward: Vertex = [nx, 0, nz];
    const inward: Vertex = [-nx, 0, -nz];
    sink.triangle(vertex(outerFrom, bottom), vertex(outerTo, bottom), vertex(outerTo, top), tones.wall, 1, outward);
    sink.triangle(vertex(outerFrom, bottom), vertex(outerTo, top), vertex(outerFrom, top), tones.wall, 1, outward);
    sink.triangle(vertex(outerFrom, top), vertex(outerTo, top), vertex(innerTo, top), tones.wall, 1, [0, 1, 0]);
    sink.triangle(vertex(outerFrom, top), vertex(innerTo, top), vertex(innerFrom, top), tones.wall, 1, [0, 1, 0]);
    sink.triangle(vertex(innerFrom, top), vertex(innerTo, top), vertex(innerTo, bottom), tones.wall, 1, inward);
    sink.triangle(vertex(innerFrom, top), vertex(innerTo, bottom), vertex(innerFrom, bottom), tones.wall, 1, inward);
  }
  return sink.geometry();
}

// ---------------------------------------------------------------- building mass

function wallGeometry(building: CampusBuilding, height: number): THREE.BufferGeometry {
  // Shape space feeds rotateX(-90°), which maps the shape's second axis to world
  // -z, so passing (x, -z) lands the mass on world z = data z (south positive,
  // like the ground texture). Centring it keeps the outline on the building.
  const [centerX, centerZ] = building.center;
  const shape = new THREE.Shape();
  building.points.forEach(([x, z], index) => (index === 0
    ? shape.moveTo(x - centerX, centerZ - z)
    : shape.lineTo(x - centerX, centerZ - z)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.deleteAttribute('uv');
  return geometry;
}

/** Walls take the facade tones, the flat deck on top takes the roof tone. */
function paintWallFaces(geometry: THREE.BufferGeometry, tones: MassTones) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const bands = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const isDeck = normal.getY(index) > 0.9;
    const tone = isDeck ? tones.roof : tones.wall;
    colors[index * 3] = tone.r;
    colors[index * 3 + 1] = tone.g;
    colors[index * 3 + 2] = tone.b;
    bands[index * 3] = isDeck ? 0 : 1;
    bands[index * 3 + 1] = tones.base;
    bands[index * 3 + 2] = tones.glass;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('facadeBand', new THREE.Float32BufferAttribute(bands, 3));
}

function paintSolid(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = color.r;
    values[index * 3 + 1] = color.g;
    values[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(values, 3));
}

/** Warm light tones for buildings whose survey record carries no colour. */
const FALLBACK_COLORS = ['#e2d6c2', '#dcd0bb', '#e6dccb'];
/** Roof tones: pitched roofs go warmer, flat decks stay closer to the wall. */
const PITCHED_ROOF_TONE = '#9c6a4c';
const FLAT_ROOF_TONE = '#8b9089';

export function buildingTones(building: CampusBuilding): { wall: THREE.Color; roof: THREE.Color } {
  const declared = building.color?.trim();
  const base = new THREE.Color(declared && declared.length > 1
    ? declared
    : FALLBACK_COLORS[Math.abs(building.id.length * 31 + building.group.length) % FALLBACK_COLORS.length]);
  const pitched = building.roof === 'gable' || building.roof === 'hip' || building.roof === 'barrel';
  return {
    wall: base.clone().offsetHSL(0, 0.03, -0.05),
    roof: base.clone().lerp(new THREE.Color(pitched ? PITCHED_ROOF_TONE : FLAT_ROOF_TONE), pitched ? 0.42 : 0.34),
  };
}

const planCache = new Map<string, RoofPlan>();
const massCache = new Map<string, THREE.BufferGeometry>();

/** Roof plan of a building, built once per id. */
export function buildingRoofPlan(building: CampusBuilding): RoofPlan {
  const cached = planCache.get(building.id);
  if (cached) return cached;
  const plan = planRoof(building.points, building.roof, building.height);
  planCache.set(building.id, plan);
  return plan;
}

function massTones(building: CampusBuilding): MassTones {
  const tones = buildingTones(building);
  return {
    center: building.center,
    wall: tones.wall,
    roof: tones.roof,
    base: building.groundElevation,
    glass: building.glassBand ? 1 : 0,
  };
}

function assembleMass(
  building: CampusBuilding, plan: RoofPlan, roof: THREE.BufferGeometry | null,
): THREE.BufferGeometry {
  const tones = massTones(building);
  const walls = wallGeometry(building, plan.wallTop);
  paintWallFaces(walls, tones);
  if (!roof) return walls;
  const merged = mergeGeometries([walls, roof]);
  if (!merged) {
    roof.dispose();
    return walls;
  }
  walls.dispose();
  roof.dispose();
  return merged;
}

/**
 * Last line of defence: a roof that leaves the footprint or misses the
 * envelope would pull the mass off the orthophoto, the outlines and the pins
 * hanging over the rooftop, so it is dropped for the flat fallback instead.
 * The roof is built around `center`, so its bounds are compared in that frame.
 */
function roofFits(plan: RoofPlan, roof: THREE.BufferGeometry, center: Point): boolean {
  roof.computeBoundingBox();
  const box = roof.boundingBox;
  if (!box) return false;
  const bounds = ringBounds(plan.ring.map(([x, z]) => [x - center[0], z - center[1]]));
  const slack = 1e-3;
  return box.min.x >= bounds.minX - slack && box.max.x <= bounds.maxX + slack
    && box.min.z >= bounds.minZ - slack && box.max.z <= bounds.maxZ + slack
    && box.min.y >= plan.wallTop - slack
    && box.max.y >= plan.envelopeHeight - slack && box.max.y <= plan.envelopeHeight + slack;
}

/** Local (centre-relative, ground at y=0) mass of a building, built once per id. */
export function buildingMassGeometry(building: CampusBuilding): THREE.BufferGeometry {
  const cached = massCache.get(building.id);
  if (cached) return cached;
  const tones = massTones(building);
  let plan = buildingRoofPlan(building);
  let roof = roofGeometry(plan, tones);
  if (roof && !roofFits(plan, roof, building.center)) {
    roof.dispose();
    roof = null;
    // Walls grow back to the full envelope so the fallback stays a closed mass.
    plan = planRoof(building.points, 'flat', building.height);
  }
  const geometry = assembleMass(building, plan, roof);
  massCache.set(building.id, geometry);
  return geometry;
}

// ---------------------------------------------------------------- facade material

/**
 * Flag texture behind the live-event glow: one texel per building, set while
 * the building's venue has an event running right now. The merged field keeps
 * its single draw call and its geometry untouched; the shader only reads the
 * texel that matches the building index the vertices already carry.
 */
export type BuildingPulse = {
  /** Live uniforms, shared with the material's shader. */
  uniforms: Record<string, THREE.IUniform>;
  /** Marks the glowing buildings by their index in `campusBuildings`. */
  setActive(indices: number[]): void;
  /** Keeps the glow breathing, or holds it steady when motion is reduced. */
  setMotion(animate: boolean): void;
  /** Advances the pulse clock, in seconds. */
  tick(elapsed: number): void;
  dispose(): void;
};

/** Smallest power of two that holds one texel per building. */
export function pulseTextureWidth(count: number): number {
  let width = 1;
  while (width < count) width *= 2;
  return width;
}

export function createBuildingPulse(count: number): BuildingPulse {
  const width = pulseTextureWidth(Math.max(count, 1));
  const data = new Uint8Array(width * 4);
  const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  const uniforms: Record<string, THREE.IUniform> = {
    uPulseMap: { value: texture },
    uPulseWidth: { value: width },
    uPulseTime: { value: 0 },
    uPulseMotion: { value: 1 },
  };
  return {
    uniforms,
    setActive(indices) {
      data.fill(0);
      for (const index of indices) {
        if (index >= 0 && index < width) data[index * 4] = 255;
      }
      texture.needsUpdate = true;
    },
    setMotion(animate) { uniforms.uPulseMotion.value = animate ? 1 : 0; },
    tick(elapsed) { uniforms.uPulseTime.value = elapsed; },
    dispose() { texture.dispose(); },
  };
}

/**
 * The merged field carries four values per vertex: band mask (0 on roofs), the
 * building's ground height, its glass flag and its index in the field. Floor
 * bands are worked out in the shader rather than from a texture, so the whole
 * field still renders in one draw call with one material, and the bands fade
 * away on their own once a floor shrinks below a pixel instead of shimmering at
 * distance. The same shader reads the pulse flag of its building, so a venue
 * with an event running now glows without splitting the merge.
 */
export function createBuildingMaterial(pulse: BuildingPulse = createBuildingPulse(1)): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  material.onBeforeCompile = (shader) => {
    // The stub shader object the unit test passes has no uniform map.
    if (shader.uniforms) Object.assign(shader.uniforms, pulse.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 facadeBand;
        attribute float buildingIndex;
        uniform float uPulseWidth;
        varying vec3 vFacade;
        varying float vPulseTexel;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFacade = vec3( facadeBand.x, position.y - facadeBand.y, facadeBand.z );
        vPulseTexel = ( buildingIndex + 0.5 ) / uPulseWidth;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uPulseMap;
        uniform float uPulseTime;
        uniform float uPulseMotion;
        varying vec3 vFacade;
        varying float vPulseTexel;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if ( vFacade.x > 0.5 ) {
          float floorIndex = vFacade.y / float( ${FLOOR_HEIGHT.toFixed(4)} );
          float level = fract( floorIndex );
          float soft = fwidth( floorIndex ) * 0.8 + 1e-4;
          float sill = mix( 0.18, 0.10, vFacade.z );
          float head = mix( 0.60, 0.86, vFacade.z );
          float window = smoothstep( sill - soft, sill + soft, level )
            * ( 1.0 - smoothstep( head - soft, head + soft, level ) );
          diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.52, 0.60, 0.68 ), window * mix( 0.5, 0.85, vFacade.z ) );
          float slab = smoothstep( 0.955 - soft, 0.955 + soft, level );
          diffuseColor.rgb *= 1.0 + slab * 0.07;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float venueLive = texture2D( uPulseMap, vec2( vPulseTexel, 0.5 ) ).r;
        if ( venueLive > 0.5 ) {
          float breathe = 0.5 + 0.5 * sin( uPulseTime * 2.4 );
          float glow = mix( 1.0, 0.35 + 0.65 * breathe, uPulseMotion );
          totalEmissiveRadiance += vec3( 1.0, 0.66, 0.28 ) * ( 0.6 * glow );
        }`);
  };
  material.customProgramCacheKey = () => 'campus-facade-bands';
  return material;
}

// ---------------------------------------------------------------- the field

export type BuildingFieldGeometry = {
  /** Every mass in world space, in one buffer. */
  geometry: THREE.BufferGeometry;
  /** Building id per triangle, so a raycast hit keeps its identity. */
  faceOwner: string[];
};

/** Where a building sits in the merged field, for the live pulse texture. */
export const buildingFieldIndex = new Map(campusBuildings.map((building, index) => [building.id, index]));

export function buildBuildingField(): BuildingFieldGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  const faceOwner: string[] = [];
  campusBuildings.forEach((building, index) => {
    const geometry = buildingMassGeometry(building).clone();
    geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(
      building.center[0], building.groundElevation, building.center[1],
    ));
    // The material reads the pulse flag of the building each vertex belongs to;
    // the merge keeps this attribute like any other, so the field still renders
    // in one draw call.
    const vertices = geometry.getAttribute('position').count;
    geometry.setAttribute('buildingIndex', new THREE.Float32BufferAttribute(new Float32Array(vertices).fill(index), 1));
    const faces = vertices / 3;
    for (let face = 0; face < faces; face += 1) faceOwner.push(building.id);
    geometries.push(geometry);
  });
  const geometry = mergeGeometries(geometries);
  for (const part of geometries) part.dispose();
  return { geometry, faceOwner };
}

/**
 * Roof and base outlines for every building in one line buffer, with the tones
 * as vertex colours: the roof ring stays dark and crisp, the ground ring is a
 * light hint. Two rings per mass are enough to keep neighbouring blocks apart
 * without turning the campus into a wireframe. The roof ring rides the eaves,
 * so it traces the wall/roof junction on pitched masses too.
 */
export function buildBuildingOutlines(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const roofTone = new THREE.Color('#39463f');
  const baseTone = new THREE.Color('#96a496');
  for (const building of campusBuildings) {
    const plan = buildingRoofPlan(building);
    const roofY = building.groundElevation + plan.wallTop + 0.18;
    const baseY = building.groundElevation + 0.4;
    const points = building.points;
    for (let index = 0; index < points.length; index += 1) {
      const [ax, az] = points[index];
      const [bx, bz] = points[(index + 1) % points.length];
      positions.push(ax, roofY, az, bx, roofY, bz, ax, baseY, az, bx, baseY, bz);
      for (const tone of [roofTone, roofTone, baseTone, baseTone]) {
        colors.push(tone.r, tone.g, tone.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** One low-poly tree (trunk plus two cone tiers), trunk base at y=0. */
export function buildTreeGeometry(): THREE.BufferGeometry {
  const cylinder = new THREE.CylinderGeometry(0.42, 0.62, 2.6, 5, 1).toNonIndexed();
  cylinder.translate(0, 1.3, 0);
  paintSolid(cylinder, new THREE.Color('#7b6a55'));
  const lower = new THREE.ConeGeometry(3.1, 5.4, 6).toNonIndexed();
  lower.translate(0, 4.8, 0);
  paintSolid(lower, new THREE.Color('#5c8757'));
  const upper = new THREE.ConeGeometry(2.15, 4.4, 6).toNonIndexed();
  upper.translate(0, 8.8, 0);
  paintSolid(upper, new THREE.Color('#679661'));
  const geometry = mergeGeometries([cylinder, lower, upper]);
  for (const part of [cylinder, lower, upper]) part.dispose();
  return geometry;
}
