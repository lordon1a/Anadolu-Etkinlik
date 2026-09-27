import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildBuildingField, buildBuildingOutlines, buildTreeGeometry, buildingMassGeometry,
} from '../src/lib/building-geometry';
import { campusBuildings } from '../src/lib/campus';

const field = buildBuildingField();
const position = field.geometry.getAttribute('position');

/** Vertex range of each building inside the merged buffer, in build order. */
const ranges = (() => {
  let offset = 0;
  return campusBuildings.map((building) => {
    const count = buildingMassGeometry(building).getAttribute('position').count;
    const range = { building, start: offset, count };
    offset += count;
    return range;
  });
})();

describe('merged building field', () => {
  it('merges every mass and keeps a building id per triangle', () => {
    expect(position.count).toBeGreaterThan(0);
    expect(field.faceOwner.length).toBe(position.count / 3);
    const owners = new Set(field.faceOwner);
    for (const building of campusBuildings) {
      expect(owners.has(building.id), `${building.id} lost its identity in the merge`).toBe(true);
    }
  });

  it('carries the vertex tint the material needs', () => {
    const color = field.geometry.getAttribute('color');
    expect(color).toBeTruthy();
    expect(color.count).toBe(position.count);
  });

  it('labels every vertex with the building it belongs to, for the live pulse', () => {
    const index = field.geometry.getAttribute('buildingIndex');
    expect(index, 'the pulse texture is read through this attribute').toBeTruthy();
    expect(index.itemSize).toBe(1);
    expect(index.count).toBe(position.count);
    ranges.forEach(({ building, start, count }, order) => {
      expect(index.getX(start), `${building.id} first vertex`).toBe(order);
      expect(index.getX(start + count - 1), `${building.id} last vertex`).toBe(order);
    });
  });

  it('draws every building on the shared terrain and footprint', () => {
    // x/z come from the OSM footprints, y from the sampled terrain grid: this is
    // the contract that keeps the masses aligned with the orthophoto and pins.
    const corner = new THREE.Vector3();
    for (const { building, start, count } of ranges) {
      const box = new THREE.Box3();
      for (let index = start; index < start + count; index += 1) {
        box.expandByPoint(corner.set(position.getX(index), position.getY(index), position.getZ(index)));
      }
      const xs = building.points.map(([x]) => x);
      const zs = building.points.map(([, z]) => z);
      expect(box.min.y, `${building.id} ground`).toBeCloseTo(building.groundElevation, 3);
      expect(box.max.y - box.min.y, `${building.id} height`).toBeCloseTo(Math.max(building.height, 3), 3);
      expect(box.min.x, `${building.id} west edge`).toBeCloseTo(Math.min(...xs), 3);
      expect(box.max.x, `${building.id} east edge`).toBeCloseTo(Math.max(...xs), 3);
      expect(box.min.z, `${building.id} north edge`).toBeCloseTo(Math.min(...zs), 3);
      expect(box.max.z, `${building.id} south edge`).toBeCloseTo(Math.max(...zs), 3);
    }
  });

  it('outlines every roof and base in a single line buffer', () => {
    const outlines = buildBuildingOutlines();
    const segments = campusBuildings.reduce((total, building) => total + building.points.length, 0);
    // Two rings per building: a roof segment pair and a base segment pair.
    expect(outlines.getAttribute('position').count).toBe(segments * 4);
    expect(outlines.getAttribute('color').count).toBe(segments * 4);
  });

  it('builds one low-poly tree with its trunk on the ground', () => {
    const tree = buildTreeGeometry();
    tree.computeBoundingBox();
    const box = tree.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeGreaterThan(9);
    expect(tree.getAttribute('color')).toBeTruthy();
    expect(tree.getAttribute('position').count / 3).toBeLessThan(80);
  });
});
