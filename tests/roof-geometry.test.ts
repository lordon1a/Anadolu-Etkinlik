import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildingMassGeometry, buildingRoofPlan, createBuildingMaterial, createBuildingPulse, planRoof,
  pulseTextureWidth, roofFrame,
} from '../src/lib/building-geometry';
import { campusBuildings, pointInRing, type BuildingRoof, type Point } from '../src/lib/campus';

/** Rectangle centred on the origin, rotated counter-clockwise by `angle` degrees. */
function rectangle(width: number, depth: number, angle = 0): Point[] {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ].map(([x, z]) => [x * cos - z * sin, x * sin + z * cos] as Point);
}

function longestEdge(ring: Point[]): { direction: Point; length: number } {
  let length = 0;
  let direction: Point = [1, 0];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const candidate = Math.hypot(dx, dz);
    if (candidate > length) {
      length = candidate;
      direction = [dx / candidate, dz / candidate];
    }
  }
  return { direction, length };
}

const crossOf = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];

function massBox(building: (typeof campusBuildings)[number]) {
  const geometry = buildingMassGeometry(building);
  geometry.computeBoundingBox();
  return geometry.boundingBox as THREE.Box3;
}

describe('roof plans', () => {
  it('runs a gable ridge parallel to the longest edge', () => {
    for (const angle of [0, 17, 45, 90, 123, 270]) {
      const points = rectangle(60, 24, angle);
      const plan = planRoof(points, 'gable', 12);
      expect(plan.kind, `angle ${angle}`).toBe('gable');
      const edge = longestEdge(plan.ring);
      // The frame's axis is the longest edge direction, so the ridge (which
      // follows the axis through the apex) is parallel to it.
      expect(Math.abs(crossOf(edge.direction, plan.axis as Point)), `angle ${angle}`).toBeLessThan(1e-9);
      const length = Math.hypot(plan.axis![0], plan.axis![1]);
      expect(length).toBeCloseTo(1, 9);
    }
  });

  it('keeps the gable ridge on the footprint centre line, at the envelope top', () => {
    const points = rectangle(60, 24, 31);
    const plan = planRoof(points, 'gable', 12);
    const height = 12;
    expect(plan.envelopeHeight).toBe(height);
    expect(plan.wallTop + plan.rise).toBeCloseTo(height, 9);
    expect(plan.surface?.factorAt(plan.apex![0], plan.apex![1])).toBeCloseTo(1, 9);
  });

  it('keeps a hip top (ridge or apex) inside the footprint', () => {
    for (const [width, depth] of [[46, 18], [24, 22], [60, 14]]) {
      const points = rectangle(width, depth, 12);
      const plan = planRoof(points, 'hip', 10);
      expect(plan.kind).toBe('hip');
      expect(pointInRing(plan.ring, plan.apex as Point), `${width}x${depth}`).toBe(true);
    }
    const square = rectangle(20, 20);
    const pyramid = planRoof(square, 'hip', 10);
    expect(pyramid.kind).toBe('hip');
    expect(pointInRing(pyramid.ring, pyramid.apex as Point)).toBe(true);
  });

  it('crests a barrel vault at the envelope and meets the wall at the eaves', () => {
    const points = rectangle(50, 18);
    const plan = planRoof(points, 'barrel', 11);
    expect(plan.kind).toBe('barrel');
    const frame = plan.frame!;
    const crown = plan.surface!.factorAt(frame.center[0], frame.center[1]);
    expect(crown).toBeCloseTo(1, 6);
    // Half a span out the vault has fallen to sqrt(1 - 0.25).
    const half = [
      frame.center[0] + frame.across[0] * frame.halfDepth * 0.5,
      frame.center[1] + frame.across[1] * frame.halfDepth * 0.5,
    ] as Point;
    expect(plan.surface!.factorAt(half[0], half[1])).toBeCloseTo(Math.sqrt(0.75), 6);
    expect(plan.wallTop + plan.rise).toBeCloseTo(plan.envelopeHeight, 9);
  });

  it('falls back to flat for footprints that cannot carry a pitched roof', () => {
    const requests: [string, Point[]][] = [
      ['empty', []],
      ['two points', [[0, 0], [10, 0]]],
      ['repeated points', [[4, 4], [4, 4], [4, 4], [4, 4]]],
      ['collinear', [[0, 0], [10, 0], [20, 0], [30, 0]]],
      ['tiny', [[0, 0], [2, 0], [2, 2], [0, 2]]],
      // A courtyard block whose centre falls in the yard, not on the building.
      ['u shaped', [
        [-20, -20], [20, -20], [20, 20], [6, 20], [6, -6], [-6, -6], [-6, 20], [-20, 20],
      ]],
    ];
    for (const [label, points] of requests) {
      for (const roof of ['gable', 'hip', 'barrel'] as BuildingRoof[]) {
        const plan = planRoof(points, roof, 10);
        expect(plan.kind, `${label} / ${roof}`).toBe('flat');
        expect(plan.rise, label).toBe(0);
        expect(plan.wallTop, label).toBe(plan.envelopeHeight);
      }
    }
  });

  it('drops the parapet rim when the ring cannot take an inset copy', () => {
    // Two corners near 3°: the inward miter would shoot across the footprint.
    const plan = planRoof([[0, 0], [200, 0], [100, 6]], 'flat-parapet', 10);
    expect(plan.kind).toBe('flat');
    expect(plan.parapet).toBe(0);
    expect(plan.wallTop).toBe(plan.envelopeHeight);
  });

  it('drops the parapet rim only where the ring can take an inset copy', () => {
    const plan = planRoof(rectangle(30, 20), 'flat-parapet', 8);
    expect(plan.kind).toBe('flat-parapet');
    expect(plan.parapet).toBeGreaterThan(0.4);
    expect(plan.wallTop).toBeCloseTo(plan.envelopeHeight - plan.parapet, 9);
    expect(plan.rise).toBe(0);
  });

  it('resolves a frame from the longest edge in both windings', () => {
    const square = rectangle(30, 10);
    const clockwise = [...square].reverse();
    const frame = roofFrame(square)!;
    const reversed = roofFrame(clockwise)!;
    expect(frame.halfLength).toBeCloseTo(15, 6);
    expect(frame.halfDepth).toBeCloseTo(5, 6);
    expect(reversed.halfLength).toBeCloseTo(15, 6);
    expect(Math.abs(crossOf(frame.axis, reversed.axis))).toBeLessThan(1e-9);
  });
});

describe('roof geometry', () => {
  it('keeps every mass on its footprint and inside the surveyed height', () => {
    for (const building of campusBuildings) {
      const box = massBox(building);
      // Masses are centre-relative, so the footprint is shifted the same way.
      const xs = building.points.map(([x]) => x - building.center[0]);
      const zs = building.points.map(([, z]) => z - building.center[1]);
      const height = Math.max(building.height, 3);
      expect(box.min.y, `${building.id} base`).toBeCloseTo(0, 3);
      expect(box.max.y, `${building.id} ridge`).toBeCloseTo(height, 3);
      expect(box.min.x, `${building.id} west`).toBeCloseTo(Math.min(...xs), 3);
      expect(box.max.x, `${building.id} east`).toBeCloseTo(Math.max(...xs), 3);
      expect(box.min.z, `${building.id} north`).toBeCloseTo(Math.min(...zs), 3);
      expect(box.max.z, `${building.id} south`).toBeCloseTo(Math.max(...zs), 3);
    }
  });

  it('carries facade attributes on every vertex of every mass', () => {
    for (const building of campusBuildings) {
      const geometry = buildingMassGeometry(building);
      const count = geometry.getAttribute('position').count;
      expect(geometry.getAttribute('color').count, building.id).toBe(count);
      expect(geometry.getAttribute('facadeBand').count, building.id).toBe(count);
      const band = geometry.getAttribute('facadeBand');
      for (let index = 0; index < count; index += 1) {
        expect(Number.isFinite(band.getX(index)), `${building.id} band mask`).toBe(true);
        expect(band.getY(index), `${building.id} band ground`).toBeCloseTo(building.groundElevation, 4);
      }
    }
  });

  it('builds the requested pitched roofs and only falls back on hopeless footprints', () => {
    const pitched = campusBuildings.filter((b) => ['gable', 'hip', 'barrel'].includes(b.roof));
    expect(pitched.length).toBeGreaterThan(20);
    const kept: string[] = [];
    for (const building of pitched) {
      const plan = buildingRoofPlan(building);
      if (plan.kind !== building.roof) {
        // The only sanctioned fallback is a flat mass that still fills the envelope.
        expect(plan.kind, building.id).toBe('flat');
        expect(plan.rise, building.id).toBe(0);
        expect(plan.wallTop, building.id).toBe(plan.envelopeHeight);
        continue;
      }
      kept.push(building.id);
      expect(plan.rise, building.id).toBeGreaterThan(0);
      expect(plan.wallTop, building.id).toBeLessThan(plan.envelopeHeight);
      expect(pointInRing(plan.ring, plan.apex as Point), `${building.id} ridge over the building`).toBe(true);
    }
    // 63 of the 87 masses are pitched in the survey; only a handful of twisted
    // footprints should ever lose theirs.
    expect(kept.length).toBeGreaterThanOrEqual(pitched.length - 4);
  });

  it('reaches the ridge height and keeps roof faces off the walls', () => {
    for (const building of campusBuildings) {
      const plan = buildingRoofPlan(building);
      const geometry = buildingMassGeometry(building);
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const bands = geometry.getAttribute('facadeBand');
      let highest = -Infinity;
      let aboveWallTop = 0;
      let slopedRoofFaces = 0;
      for (let index = 0; index < position.count; index += 1) {
        const y = position.getY(index);
        highest = Math.max(highest, y);
        if (y > plan.wallTop + 1e-4) aboveWallTop += 1;
        // Roof faces (band mask 0) that are neither level decks nor walls.
        if (bands.getX(index) < 0.5 && Math.abs(normal.getY(index)) < 0.999) slopedRoofFaces += 1;
        expect(y, `${building.id} pokes above the envelope`).toBeLessThanOrEqual(plan.envelopeHeight + 1e-3);
      }
      expect(highest, `${building.id} ridge height`).toBeCloseTo(Math.max(building.height, 3), 3);
      if (plan.surface) {
        // A pitched roof that only contributes level faces means the surface
        // never made it into the mass (the flat fallback would have swallowed it).
        expect(slopedRoofFaces, `${building.id} sloped roof faces`).toBeGreaterThan(6);
        expect(aboveWallTop, `${building.id} roof vertices`).toBeGreaterThan(6);
      }
    }
  });

  it('draws the floor bands from the facade attribute the mass carries', () => {
    // The markers the material rewrites have to exist in the stock shader, or
    // the bands would silently never appear.
    const stock = THREE.ShaderLib.physical;
    expect(stock.vertexShader).toContain('#include <common>');
    expect(stock.vertexShader).toContain('#include <begin_vertex>');
    expect(stock.fragmentShader).toContain('#include <color_fragment>');

    const material = createBuildingMaterial();
    const shader = {
      vertexShader: stock.vertexShader,
      fragmentShader: stock.fragmentShader,
    };
    material.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain('attribute vec3 facadeBand');
    expect(shader.vertexShader).toContain('vFacade = vec3( facadeBand.x, position.y - facadeBand.y, facadeBand.z )');
    expect(shader.fragmentShader).toContain('varying vec3 vFacade');
    expect(shader.fragmentShader).toContain('fwidth( floorIndex )');
    expect(shader.fragmentShader).toContain('float floorIndex = vFacade.y / float( 3.5000 )');
    expect(material.vertexColors).toBe(true);
    expect(material.customProgramCacheKey?.()).toBe('campus-facade-bands');
  });

  it('reads the live pulse from a per-building flag texture', () => {
    const pulse = createBuildingPulse(campusBuildings.length);
    const material = createBuildingMaterial(pulse);
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {} as Record<string, unknown>,
    };
    material.onBeforeCompile(shader as never, null as never);
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uPulseMap', 'uPulseWidth', 'uPulseMotion']));
    expect(shader.vertexShader).toContain('attribute float buildingIndex');
    expect(shader.vertexShader).toContain('vPulseTexel = ( buildingIndex + 0.5 ) / uPulseWidth');
    expect(shader.fragmentShader).toContain('texture2D( uPulseMap, vec2( vPulseTexel, 0.5 ) ).r');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');

    // One texel per building: only the marked buildings glow, and the flag is
    // cleared again when nothing is running.
    const data = () => (pulse.uniforms.uPulseMap.value as THREE.DataTexture).image.data;
    pulse.setActive([2]);
    expect(data()[2 * 4]).toBe(255);
    expect(data()[3 * 4]).toBe(0);
    pulse.setActive([]);
    expect(data()[2 * 4]).toBe(0);
    pulse.dispose();
    material.dispose();
  });

  it('sizes the pulse texture to a power of two that holds every building', () => {
    expect(pulseTextureWidth(1)).toBe(1);
    expect(pulseTextureWidth(3)).toBe(4);
    expect(pulseTextureWidth(87)).toBe(128);
    expect(pulseTextureWidth(128)).toBe(128);
    expect(pulseTextureWidth(campusBuildings.length)).toBeGreaterThanOrEqual(campusBuildings.length);
  });
});
