// Pure helpers behind the 3D interaction layer: camera framing, screen-space pin
// layout and pointer gesture thresholds. They deliberately avoid three.js so the
// tests can exercise them without a WebGL context.

export type Bounds2D = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Vec3 = [number, number, number];
/** A world point the opening camera has to frame, in the shared campus frame. */
export type FramePoint = Vec3;
/** Screen-space rectangle with a centre position and a size, in pixels. */
export type Rect = { x: number; y: number; width: number; height: number };

const DEG = Math.PI / 180;

/** How far a pointer may travel between down and up and still count as a click. */
export const DRAG_CLICK_THRESHOLD = 6;

/** True once the pointer moved far enough that a click should be treated as a drag. */
export function exceedsDragThreshold(
  [startX, startY]: [number, number],
  [x, y]: [number, number],
  threshold = DRAG_CLICK_THRESHOLD,
): boolean {
  return Math.hypot(x - startX, y - startY) > threshold;
}

export function clampPointToBounds([x, z]: [number, number], bounds: Bounds2D): [number, number] {
  return [
    Math.min(Math.max(x, bounds.minX), bounds.maxX),
    Math.min(Math.max(z, bounds.minZ), bounds.maxZ),
  ];
}

/**
 * Distance at which a `tiltDeg` tilted, north-up camera frames every given
 * point, leaving `margin` of the frame empty on the limiting axis.
 *
 * The camera sits south of the target (+z) and above it, so in camera space
 * right is +x (east), up is north tilted into the sky and the camera is `d`
 * away on its own z axis. A point is inside the frustum when its screen-space
 * offset fits the field of view at that point's depth:
 *   |across| <= (d - depth) * tan(fovX / 2)
 *   |up|     <= (d - depth) * tan(fovY / 2)
 * Solving both for `d` and taking the largest point gives the fit distance.
 */
export function fitDistanceForPoints(
  points: FramePoint[],
  target: Vec3,
  aspect: number,
  fovDeg: number,
  tiltDeg: number,
  margin = 0.08,
): number {
  const tanYFull = Math.tan((fovDeg * DEG) / 2);
  const tanY = tanYFull * (1 - margin);
  const tanX = tanYFull * Math.max(aspect, 0.1) * (1 - margin);
  const tilt = tiltDeg * DEG;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const [targetX, targetY, targetZ] = target;
  let distance = 0;
  for (const [px, py, pz] of points) {
    const relativeX = px - targetX;
    const relativeY = py - targetY;
    const relativeZ = pz - targetZ;
    const up = relativeY * cos - relativeZ * sin;
    const depth = relativeY * sin + relativeZ * cos;
    distance = Math.max(
      distance,
      Math.abs(up) / tanY + depth,
      Math.abs(relativeX) / tanX + depth,
    );
  }
  return distance;
}

/**
 * Opening pose: the middle of the given points sits in the frame centre, the
 * camera stands to the south, north stays up and the view is tilted.
 */
export function initialCameraPose(
  points: FramePoint[],
  aspect: number,
  fovDeg: number,
  tiltDeg: number,
  margin = 0.08,
): { position: Vec3; target: Vec3; distance: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, , z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const target: Vec3 = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2];
  const distance = fitDistanceForPoints(points, target, aspect, fovDeg, tiltDeg, margin);
  const tilt = tiltDeg * DEG;
  return {
    target,
    distance,
    position: [
      target[0],
      target[1] + Math.sin(tilt) * distance,
      target[2] + Math.cos(tilt) * distance,
    ],
  };
}

/** Camera distance that frames a building of `radius` metres without losing the campus feel. */
export function flyDistanceFor(
  radius: number,
  fovDeg: number,
  aspect: number,
  padding = 1.6,
  minimum = 130,
  maximum = 640,
): number {
  const tanY = Math.tan((fovDeg * DEG) / 2);
  const tanX = tanY * Math.max(aspect, 0.1);
  const wanted = padding * Math.max(radius / tanY, radius / tanX);
  return Math.min(Math.max(wanted, minimum), maximum);
}

export function easeInOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export type PinOffset = { id: string; dx: number; dy: number };

/** A pin as it appears on screen: centre position plus the box it occupies. */
export type PinBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1; higher values move less, so the selected and busiest pins keep their spot. */
  weight?: number;
};

/**
 * Places pins that share screen space into vertical columns.
 *
 * Pure and deterministic. Boxes that overlap horizontally form a column; the
 * column is stacked top to bottom with `gap` between boxes and then moved as
 * little as possible, weighted by `weight` so the selected and busiest pins
 * travel least. X never changes: a pin stays in its building's column. Offsets
 * are capped at `maxShift`, which the caller pairs with label hiding.
 */
export function stackPinColumns(
  boxes: PinBox[],
  { gap = 6, maxShift = 150 } = {},
): PinOffset[] {
  const offsets = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 2) return boxes.map((box) => ({ id: box.id, dx: 0, dy: 0 }));

  // Union-find over horizontally overlapping boxes.
  const roots = boxes.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (roots[current] !== current) {
      roots[current] = roots[roots[current]];
      current = roots[current];
    }
    return current;
  };
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const overlapX = (boxes[i].width + boxes[j].width) / 2 + gap
        - Math.abs(boxes[j].x - boxes[i].x);
      if (overlapX <= 0) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) roots[b] = a;
    }
  }
  const columns = new Map<number, number[]>();
  boxes.forEach((_, index) => {
    const key = find(index);
    const members = columns.get(key);
    if (members) members.push(index);
    else columns.set(key, [index]);
  });

  for (const members of columns.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => boxes[a].y - boxes[b].y || a - b);
    const stacked: number[] = [];
    sorted.forEach((index, position) => {
      if (position === 0) {
        stacked.push(boxes[index].y);
        return;
      }
      const previous = sorted[position - 1];
      const minimum = stacked[position - 1] + (boxes[previous].height + boxes[index].height) / 2 + gap;
      stacked.push(Math.max(boxes[index].y, minimum));
    });
    // Remove the weighted mean movement: heavy pins stay closest to their spot.
    let weightedDelta = 0;
    let weightSum = 0;
    sorted.forEach((index, position) => {
      const resistance = 1 + Math.max(boxes[index].weight ?? 0, 0) * 4;
      weightedDelta += resistance * (stacked[position] - boxes[index].y);
      weightSum += resistance;
    });
    const shift = -weightedDelta / weightSum;
    sorted.forEach((index, position) => {
      const offset = stacked[position] + shift - boxes[index].y;
      offsets[index].dy = Math.min(Math.max(offset, -maxShift), maxShift);
    });
  }

  return boxes.map((box, index) => ({ id: box.id, dx: offsets[index].dx, dy: offsets[index].dy }));
}

export type PinLabelBox = {
  id: string;
  /** The whole pin: badge plus name label. */
  box: Rect;
  /** The round count badge, which always stays visible. */
  badge: Rect;
  /** 0..1; the most important pin keeps its name. */
  priority: number;
};

function labelRectFor(pin: PinLabelBox): Rect {
  const top = pin.badge.y + pin.badge.height / 2;
  const bottom = pin.box.y + pin.box.height / 2;
  return {
    x: pin.box.x,
    y: (top + bottom) / 2,
    width: pin.box.width,
    height: bottom - top,
  };
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
}

/**
 * Names that would sit on another pin are dropped: the badge still marks the
 * building, the label only shows when it has room. The most important pin keeps
 * its label, then the next one, and so on; a name yields to a badge that is at
 * least as important as its own pin.
 */
export function hideOverlappingLabels(pins: PinLabelBox[], gap = 2): Set<string> {
  const hidden = new Set<string>();
  const kept: Rect[] = [];
  const order = [...pins].sort((a, b) => b.priority - a.priority);
  for (const pin of order) {
    const label = labelRectFor(pin);
    // No label box (a phone pin, or a box that has not been measured yet): there
    // is nothing to hide, and pretending there is would blank every name.
    if (label.height < 4 || label.width < 4) continue;
    const clashesBadge = pins.some((other) => other.id !== pin.id
      && other.priority >= pin.priority
      && overlaps(other.badge, label, gap));
    const clashesLabel = kept.some((rect) => overlaps(rect, label, gap));
    if (clashesBadge || clashesLabel) hidden.add(pin.id);
    else kept.push(label);
  }
  return hidden;
}

/** Where the map card ends up: `x` is its centre, `y` its top edge, in canvas pixels. */
export type OverlayCardPlacement = { x: number; y: number; side: 'above' | 'below' };

/**
 * Places the venue card that hangs off a pin: centred on the pin, bottom edge
 * `gap` above the pin's box. When the card would leave the top of the canvas it
 * flips below the pin, and when neither side fits (a card taller than the space
 * it has, a phone-sized canvas) it is pushed inside on both axes rather than
 * hanging over the edge. Pure, so the pushing is testable without a browser.
 */
export function placeOverlayCard(
  pin: { x: number; y: number; height: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  { margin = 10, gap = 8 }: { margin?: number; gap?: number } = {},
): OverlayCardPlacement {
  const half = card.width / 2;
  const minX = margin + half;
  const maxX = viewport.width - margin - half;
  const x = minX > maxX ? viewport.width / 2 : Math.min(Math.max(pin.x, minX), maxX);
  const above = pin.y - pin.height / 2 - gap - card.height;
  const below = pin.y + pin.height / 2 + gap;
  if (above < margin && below + card.height <= viewport.height - margin) {
    return { x, y: below, side: 'below' };
  }
  const maxY = Math.max(margin, viewport.height - margin - card.height);
  return { x, y: Math.min(Math.max(above, margin), maxY), side: 'above' };
}
