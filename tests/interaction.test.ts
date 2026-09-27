import { describe, expect, it } from 'vitest';
import {
  DRAG_CLICK_THRESHOLD, clampPointToBounds, easeInOutCubic, exceedsDragThreshold,
  fitDistanceForPoints, flyDistanceFor, hideOverlappingLabels, initialCameraPose, placeOverlayCard,
  stackPinColumns,
} from '../src/lib/interaction';
import { campus, campusBounds, campusExtent, campusFramePoints } from '../src/lib/campus';

const DEG = Math.PI / 180;
const FOV = 40;

describe('drag guard', () => {
  it('treats a still pointer as a click', () => {
    expect(exceedsDragThreshold([100, 100], [100, 100])).toBe(false);
    expect(exceedsDragThreshold([100, 100], [103, 104])).toBe(false);
    expect(DRAG_CLICK_THRESHOLD).toBeGreaterThan(0);
  });

  it('treats a moved pointer as a drag, in any direction', () => {
    expect(exceedsDragThreshold([100, 100], [100 + DRAG_CLICK_THRESHOLD + 2, 100])).toBe(true);
    expect(exceedsDragThreshold([100, 100], [100, 100 - DRAG_CLICK_THRESHOLD - 2])).toBe(true);
    expect(exceedsDragThreshold([100, 100], [108, 108])).toBe(true);
  });
});

describe('camera clamp box', () => {
  it('surrounds the mapped campus', () => {
    expect(campusBounds.minX).toBeLessThan(campusExtent.minX);
    expect(campusBounds.maxX).toBeGreaterThan(campusExtent.maxX);
    expect(campusBounds.minZ).toBeLessThan(campusExtent.minZ);
    expect(campusBounds.maxZ).toBeGreaterThan(campusExtent.maxZ);
  });

  it('pulls runaway targets back inside and leaves inside points alone', () => {
    expect(clampPointToBounds([5000, -5000], campusBounds)).toEqual([campusBounds.maxX, campusBounds.minZ]);
    expect(clampPointToBounds([-5000, 5000], campusBounds)).toEqual([campusBounds.minX, campusBounds.maxZ]);
    const inside: [number, number] = [120, -80];
    expect(clampPointToBounds(inside, campusBounds)).toEqual(inside);
  });

  it('frames the campus boundary itself', () => {
    expect(campusFramePoints.length).toBe(campus.boundary.length);
    for (const [x, y, z] of campusFramePoints) {
      expect(y).toBe(0);
      expect(Number.isFinite(x + z)).toBe(true);
    }
  });
});

/** Project the frame points the way the renderer does, to check the fit is honest. */
function frameFill(aspect: number, tiltDeg: number, margin: number) {
  const pose = initialCameraPose(campusFramePoints, aspect, FOV, tiltDeg, margin);
  const tanY = Math.tan((FOV * DEG) / 2);
  const tanX = tanY * aspect;
  const tilt = tiltDeg * DEG;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [px, py, pz] of campusFramePoints) {
    const rx = px - pose.position[0];
    const ry = py - pose.position[1];
    const rz = pz - pose.position[2];
    const up = ry * cos - rz * sin;
    const depth = -(ry * sin + rz * cos);
    expect(depth).toBeGreaterThan(0);
    minX = Math.min(minX, rx / (depth * tanX));
    maxX = Math.max(maxX, rx / (depth * tanX));
    minY = Math.min(minY, up / (depth * tanY));
    maxY = Math.max(maxY, up / (depth * tanY));
  }
  return {
    pose,
    width: (maxX - minX) / 2,
    height: (maxY - minY) / 2,
    ndc: [minX, maxX, minY, maxY],
  };
}

describe('camera framing', () => {
  it('opens north-up, tilted, with the campus boundary filling the frame', () => {
    const viewports: [number, number][] = [[780 / 510, 50], [346 / 385, 60], [1100 / 600, 50], [390 / 300, 60]];
    for (const [aspect, tilt] of viewports) {
      const frame = frameFill(aspect, tilt, 0.08);
      // North up: no sideways offset, camera south of the target (+z) and above it.
      expect(frame.pose.position[0]).toBeCloseTo(frame.pose.target[0], 6);
      expect(frame.pose.position[2]).toBeGreaterThan(frame.pose.target[2]);
      expect(frame.pose.position[1]).toBeGreaterThan(0);
      // Everything inside the frustum, and the limiting axis close to full.
      for (const value of frame.ndc) {
        expect(Math.abs(value)).toBeLessThanOrEqual(1);
      }
      expect(Math.max(frame.width, frame.height)).toBeGreaterThan(0.85);
    }
  });

  it('backs off on narrow viewports', () => {
    const target: [number, number, number] = [0, 0, 0];
    const wide = fitDistanceForPoints(campusFramePoints, target, 1.8, FOV, 50);
    const narrow = fitDistanceForPoints(campusFramePoints, target, 0.8, FOV, 50);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('keeps a building flight close but clear of the mass', () => {
    const small = flyDistanceFor(18, FOV, 780 / 510);
    const large = flyDistanceFor(140, FOV, 780 / 510);
    expect(small).toBeGreaterThanOrEqual(130);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(640);
  });

  it('eases between the two flight poses', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(4)).toBe(1);
    let previous = -1;
    for (let step = 0; step <= 10; step += 1) {
      const value = easeInOutCubic(step / 10);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

type Box = { id: string; x: number; y: number; width: number; height: number; weight?: number };

describe('pin columns', () => {
  const clears = (a: Box, b: Box, gap: number) => Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + gap - 0.5
    || Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + gap - 0.5;

  it('stacks every horizontally overlapping box without leaving a collision', () => {
    const boxes: Box[] = [
      { id: 'a', x: 100, y: 100, width: 40, height: 40 },
      { id: 'b', x: 104, y: 106, width: 40, height: 40 },
      { id: 'c', x: 98, y: 112, width: 40, height: 40 },
      { id: 'd', x: 102, y: 96, width: 40, height: 40 },
    ];
    const offsets = stackPinColumns(boxes, { gap: 6, maxShift: 220 });
    expect(offsets.map((offset) => offset.id)).toEqual(['a', 'b', 'c', 'd']);
    const placed = boxes.map((box, index) => ({
      ...box,
      x: box.x + offsets[index].dx,
      y: box.y + offsets[index].dy,
    }));
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(clears(placed[i], placed[j], 6), `${placed[i].id} / ${placed[j].id}`).toBe(true);
      }
    }
  });

  it('resolves the squeeze the old pairwise push could not: a weak pin between two strong ones', () => {
    // Phone layout from the review: Öğrenci Merkezi (busy) above, Sinema (busy)
    // below, Camii (quiet) squeezed between them.
    const boxes: Box[] = [
      { id: 'ogrenci', x: 174, y: 133, width: 34, height: 28, weight: 0.45 },
      { id: 'cami', x: 193, y: 171, width: 34, height: 28, weight: 0.15 },
      { id: 'sinema', x: 193, y: 184, width: 34, height: 28, weight: 0.3 },
    ];
    const offsets = stackPinColumns(boxes, { gap: 6, maxShift: 150 });
    const placed = boxes.map((box, index) => ({ ...box, y: box.y + offsets[index].dy }));
    expect(clears(placed[0], placed[1], 6)).toBe(true);
    expect(clears(placed[1], placed[2], 6)).toBe(true);
    expect(clears(placed[0], placed[2], 6)).toBe(true);
    // The busiest pin moves least.
    const shifts = offsets.map((offset) => Math.abs(offset.dy));
    expect(shifts[0]).toBeLessThan(shifts[2]);
  });

  it('keeps a column near the buildings it belongs to', () => {
    const boxes: Box[] = [
      { id: 'a', x: 200, y: 200, width: 40, height: 40 },
      { id: 'b', x: 208, y: 206, width: 40, height: 40 },
    ];
    const offsets = stackPinColumns(boxes, { gap: 6, maxShift: 160 });
    const centreBefore = (boxes[0].y + boxes[1].y) / 2;
    const centreAfter = (boxes[0].y + offsets[0].dy + boxes[1].y + offsets[1].dy) / 2;
    expect(Math.abs(centreAfter - centreBefore)).toBeLessThan(1e-6);
    expect(Math.abs(offsets[0].dy - offsets[1].dy)).toBeGreaterThan(20);
  });

  it('only moves pins that share a column horizontally', () => {
    const boxes: Box[] = [
      { id: 'a', x: 0, y: 0, width: 40, height: 40 },
      { id: 'b', x: 300, y: 4, width: 40, height: 40 },
      { id: 'c', x: 240, y: 4, width: 40, height: 40 },
    ];
    const offsets = stackPinColumns(boxes, { gap: 6, maxShift: 160 });
    expect(offsets[0]).toEqual({ id: 'a', dx: 0, dy: 0 });
    expect(offsets[1]).toEqual({ id: 'b', dx: 0, dy: 0 });
    expect(offsets[2]).toEqual({ id: 'c', dx: 0, dy: 0 });
  });

  it('never drags a pin further than the shift cap, even in a pile-up', () => {
    const boxes: Box[] = Array.from({ length: 14 }, (_, index) => ({
      id: `p${index}`, x: 300, y: 300, width: 40, height: 40,
    }));
    for (const offset of stackPinColumns(boxes, { gap: 6, maxShift: 60 })) {
      expect(Math.abs(offset.dy)).toBeLessThanOrEqual(60 + 1e-9);
    }
  });

  it('leaves separated boxes and single boxes untouched', () => {
    expect(stackPinColumns([])).toEqual([]);
    expect(stackPinColumns([{ id: 'solo', x: 10, y: 10, width: 40, height: 40 }]))
      .toEqual([{ id: 'solo', dx: 0, dy: 0 }]);
    expect(stackPinColumns([
      { id: 'a', x: 0, y: 0, width: 40, height: 40 },
      { id: 'b', x: 300, y: 200, width: 40, height: 40 },
    ], { gap: 6 })).toEqual([{ id: 'a', dx: 0, dy: 0 }, { id: 'b', dx: 0, dy: 0 }]);
  });
});

describe('pin label collisions', () => {
  const pin = (id: string, x: number, y: number, priority: number, width = 96, height = 58, badge = 40) => ({
    id,
    priority,
    box: { x, y, width, height },
    badge: { x, y: y - height / 2 + badge / 2, width: badge, height: badge },
  });

  it('hides the lower-priority name when two labels sit on each other', () => {
    const hidden = hideOverlappingLabels([
      pin('busy', 300, 300, 0.6),
      pin('quiet', 302, 312, 0.1),
    ]);
    expect(hidden.has('busy')).toBe(false);
    expect(hidden.has('quiet')).toBe(true);
  });

  it('never hides the selected name for a less important badge', () => {
    const hidden = hideOverlappingLabels([
      pin('selected', 300, 300, 1),
      pin('below', 298, 330, 0.2),
    ]);
    expect(hidden.has('selected')).toBe(false);
  });

  it('keeps names that have room and never hides a box without a label', () => {
    const hidden = hideOverlappingLabels([
      pin('far-left', 100, 100, 0.3),
      pin('far-right', 400, 320, 0.3),
      // A phone pin (or one measured before layout): no label area at all.
      pin('phone', 700, 200, 0.3, 34, 34, 34),
    ]);
    expect(hidden.size).toBe(0);
  });
});

describe('map card placement', () => {
  const viewport = { width: 800, height: 800 };
  const card = { width: 240, height: 300 };
  const pin = { x: 400, y: 600, height: 58 };
  /** Bottom edge of the card when it hangs above the pin, and vice versa. */
  const above = (anchor: typeof pin) => anchor.y - anchor.height / 2 - 8 - card.height;
  const below = (anchor: typeof pin) => anchor.y + anchor.height / 2 + 8;

  it('centres the card on the pin, just above it, when there is room', () => {
    expect(placeOverlayCard(pin, card, viewport)).toEqual({ x: 400, y: above(pin), side: 'above' });
  });

  it('pushes the card inside when the pin sits against a canvas edge', () => {
    const margin = 10;
    const left = placeOverlayCard({ ...pin, x: 12 }, card, viewport);
    expect(left.x).toBe(margin + card.width / 2);
    expect(left.y).toBe(above(pin));
    const right = placeOverlayCard({ ...pin, x: viewport.width - 12 }, card, viewport);
    expect(right.x).toBe(viewport.width - margin - card.width / 2);
  });

  it('flips below the pin when the top of the canvas is too close', () => {
    const high = { ...pin, y: 100 };
    const placement = placeOverlayCard(high, card, viewport);
    expect(placement.side).toBe('below');
    expect(placement.y).toBe(below(high));
  });

  it('pushes a card taller than the canvas to the top margin instead of off it', () => {
    const short = { width: 800, height: 200 };
    const placement = placeOverlayCard({ ...pin, y: 120 }, card, short);
    expect(placement.y).toBe(10);
    expect(placement.y).toBeGreaterThanOrEqual(0);
    expect(placement.y).toBeLessThan(short.height);
  });

  it('centres a card wider than the canvas rather than hanging off one side', () => {
    const narrow = { width: 200, height: 800 };
    const wide = { width: 400, height: 120 };
    expect(placeOverlayCard({ ...pin, x: 150 }, wide, narrow).x).toBe(narrow.width / 2);
  });
});
