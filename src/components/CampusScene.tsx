import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, Edges, Html, useCursor } from '@react-three/drei';
import { GlobeHemisphereWest } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { venues, venueByOsmId, venuesById } from '../data/campus';
import {
  buildBuildingField, buildBuildingOutlines, buildTreeGeometry, buildingFieldIndex, buildingMassGeometry,
  createBuildingMaterial, createBuildingPulse,
} from '../lib/building-geometry';
import {
  campus, campusBounds, campusBuildings, campusFramePoints, campusGates, campusTrees, groundLayer,
  footprintRadius, seededRandom, terrainHeightAt, type CampusBuilding,
} from '../lib/campus';
import {
  clampPointToBounds, easeInOutCubic, exceedsDragThreshold, flyDistanceFor, hideOverlappingLabels,
  initialCameraPose, placeOverlayCard, stackPinColumns,
} from '../lib/interaction';
import type { EventItem, Venue } from '../lib/types';
import { useSatelliteGroundTexture, useStyledGroundTexture } from '../lib/use-ground-texture';
import { VenueCard, VenueSheet } from './VenueCard';
import '../map-3d.css';

type Props = {
  counts: Record<string, number>;
  selectedVenueId: string | null;
  onSelectVenue: (id: string) => void;
  /** Venue whose map card is open, or null when nothing was picked. */
  cardVenueId: string | null;
  /** Events of that venue in the current period and category, in panel order. */
  cardEvents: EventItem[];
  /** Venues with an event running right now; their pins and masses glow. */
  liveVenueIds: string[];
  /** Building picked in the search box, also when it is not a venue: the camera flies to it. */
  focusBuildingId?: string | null;
  onCloseCard: () => void;
  onOpenEvent: (event: EventItem) => void;
  onShowVenueEvents: () => void;
};

// ---------------------------------------------------------------- constants

const FOV = 40;
/** Opening/return tilt: steep enough to read as a 3D map, shallow enough to keep facades visible. */
const DESKTOP_TILT_DEG = 50;
/** Portrait canvases show more ground with a steeper camera, so phones tilt harder and sit closer. */
const MOBILE_TILT_DEG = 60;
/** The campus boundary should fill ~92% of the frame, not sit in an empty field. */
const FRAME_MARGIN = 0.08;
const FLIGHT_SECONDS = 0.8;
const PIN_GAP = 6;
const PIN_MAX_SHIFT = 150;
/** Used until the pin boxes have been measured off the DOM. */
const DEFAULT_PIN_SIZE = { width: 96, height: 58, badge: 40 };
const CAMERA_MIN_DISTANCE = 110;
const CAMERA_MAX_DISTANCE = 4600;
const CAMERA_MIN_POLAR = 10;
const CAMERA_MAX_POLAR = 72;
const FOG_COLOR = '#e6edee';
const SKY_TOP = '#8fb6d8';
const SKY_HORIZON = '#e6edee';
const BASE_GROUND = '#c9d4c6';
const SUN_POSITION: [number, number, number] = [-560, 820, 620];
const DEFAULT_FIT_DISTANCE = 2000;

// R3F re-runs its root configuration on every render and compares these props
// shallowly; fresh object literals would make it replace the camera (and with it
// the controls' target) mid-session. They must keep their identity.
const CANVAS_CAMERA = { fov: FOV, near: 1, far: 6000, position: [0, 1500, 1800] as [number, number, number] };
const CANVAS_GL = { antialias: true, powerPreference: 'high-performance' as const };
const CANVAS_DPR: [number, number] = [1, 1.75];

// ---------------------------------------------------------------- buildings

function BuildingHighlight({ building, selected }: { building: CampusBuilding; selected: boolean }) {
  const geometry = buildingMassGeometry(building);
  const color = useMemo(() => {
    const base = new THREE.Color(building.color);
    if (selected) return `#${new THREE.Color('#e9a15d').getHexString()}`;
    return `#${base.lerp(new THREE.Color('#ffffff'), 0.32).getHexString()}`;
  }, [building, selected]);
  return <group
    position={[building.center[0], building.groundElevation, building.center[1]]}
    scale={selected ? 1.014 : 1.008}
  >
    <mesh geometry={geometry} renderOrder={2}>
      <meshStandardMaterial color={color} roughness={0.8} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
    <Edges geometry={geometry} threshold={25} color={selected ? '#a4601c' : '#7d8a72'} />
  </group>;
}

function BuildingTag({ building }: { building: CampusBuilding }) {
  const name = building.name.trim();
  if (!name) return null;
  const [centerX, centerZ] = building.center;
  const height = Math.max(building.height, 3);
  return <Html
    position={[centerX, building.groundElevation + height + 7, centerZ]}
    center
    zIndexRange={[4, 0]}
    pointerEvents="none"
  >
    <span className="map-building-tag">{name}</span>
  </Html>;
}

// ---------------------------------------------------------------- scenery

/** Soft alpha ramp so the orthophoto blends into the base ground instead of ending on a hard seam. */
function edgeFadeMask(inset: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  const context = canvas.getContext('2d');
  if (!context) return texture;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'multiply';
  const horizontal = context.createLinearGradient(0, 0, size, 0);
  horizontal.addColorStop(0, '#000000');
  horizontal.addColorStop(inset, '#ffffff');
  horizontal.addColorStop(1 - inset, '#ffffff');
  horizontal.addColorStop(1, '#000000');
  const vertical = context.createLinearGradient(0, 0, 0, size);
  vertical.addColorStop(0, '#000000');
  vertical.addColorStop(inset, '#ffffff');
  vertical.addColorStop(1 - inset, '#ffffff');
  vertical.addColorStop(1, '#000000');
  context.fillStyle = horizontal;
  context.fillRect(0, 0, size, size);
  context.fillStyle = vertical;
  context.fillRect(0, 0, size, size);
  texture.needsUpdate = true;
  return texture;
}

function GroundSurface({ texture }: { texture: THREE.CanvasTexture | null }) {
  const { size } = groundLayer.grid;
  const { box } = groundLayer;

  const geometry = useMemo(() => {
    const width = box.maxX - box.minX;
    const depth = box.maxZ - box.minZ;
    const plane = new THREE.PlaneGeometry(width, depth, size - 1, size - 1);
    plane.rotateX(-Math.PI / 2);
    const position = plane.attributes.position as THREE.BufferAttribute;
    const centerX = (box.minX + box.maxX) / 2;
    const centerZ = (box.minZ + box.maxZ) / 2;
    for (let index = 0; index < position.count; index += 1) {
      // Plane vertices sit on the sampled grid nodes, so the shared sampler keeps
      // this surface and the building base heights on the same terrain.
      position.setY(index, terrainHeightAt([position.getX(index) + centerX, position.getZ(index) + centerZ]));
    }
    position.needsUpdate = true;
    plane.computeVertexNormals();
    return plane;
  }, [box, size]);

  const center = [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2] as const;
  const mask = useMemo(() => edgeFadeMask(0.1), []);

  // The material is created together with its map: assigning `map` to an already
  // compiled material does not rebuild its shader, which silently renders the
  // surface plain (the ground texture never appeared). depthWrite stays off so the
  // faded rim lets the base ground through instead of writing empty depth.
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    map: texture ?? null,
    alphaMap: mask,
    transparent: true,
    depthWrite: false,
    color: texture ? 0xffffff : 0xc3cabc,
    toneMapped: false,
  }), [texture, mask]);

  useEffect(() => () => material.dispose(), [material]);

  // The surface is unlit: the styled ground carries flat map colours and the
  // satellite layer carries its own sunlight. Buildings stay lit and drop their
  // shadows on it.
  return <mesh geometry={geometry} material={material} position={[center[0], 0, center[1]]} receiveShadow />;
}

/** Flat backdrop under the ground layer; the fog dissolves its far edge into the sky. */
function BaseGround() {
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.8, 0]}>
    <planeGeometry args={[16000, 16000]} />
    <meshBasicMaterial color={BASE_GROUND} toneMapped={false} />
  </mesh>;
}

/** Screen-filling gradient, kept on the camera so it never clips against the far plane. */
function SkyDome() {
  const camera = useThree((state) => state.camera);
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(SKY_TOP) },
      horizonColor: { value: new THREE.Color(SKY_HORIZON) },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vDirection;
      void main() {
        float height = smoothstep(-0.04, 0.42, vDirection.y);
        gl_FragColor = vec4(mix(horizonColor, topColor, height), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }), []);
  useFrame(() => {
    if (meshRef.current) meshRef.current.position.copy(camera.position);
  });
  return <mesh ref={meshRef} material={material} renderOrder={-1000} frustumCulled={false}>
    <sphereGeometry args={[2500, 32, 16]} />
  </mesh>;
}

function Trees() {
  const trees = useMemo(() => campusTrees(), []);
  const geometry = useMemo(() => buildTreeGeometry(), []);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    trees.forEach((tree, index) => {
      position.set(tree.x, terrainHeightAt([tree.x, tree.z]), tree.z);
      quaternion.setFromAxisAngle(up, seededRandom(index * 7919 + 13)() * Math.PI * 2);
      scale.setScalar(tree.scale);
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [trees]);

  return <instancedMesh ref={meshRef} args={[geometry, undefined, trees.length]} castShadow>
    <meshStandardMaterial vertexColors roughness={0.95} flatShading />
  </instancedMesh>;
}

function CampusOutline() {
  const line = useMemo(() => {
    const points = campus.boundary.map(([x, z]) => new THREE.Vector3(x, terrainHeightAt([x, z]) + 3, z));
    points.push(points[0].clone());
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: '#f4f7ef', transparent: true, opacity: 0.8 }),
    );
  }, []);
  return <primitive object={line} />;
}

// ---------------------------------------------------------------- interaction

/** Distinguishes a click from the tail of an orbit/pan drag. */
function useDragGuard(onDragStart: () => void) {
  const guard = useRef({ x: 0, y: 0, down: false, moved: false });
  const callback = useRef(onDragStart);
  callback.current = onDragStart;
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const element = gl.domElement;
    const onPointerDown = (event: PointerEvent) => {
      guard.current = { x: event.clientX, y: event.clientY, down: true, moved: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      const current = guard.current;
      if (!current.down || current.moved) return;
      if (exceedsDragThreshold([current.x, current.y], [event.clientX, event.clientY])) {
        current.moved = true;
        callback.current();
      }
    };
    const onPointerUp = () => { guard.current.down = false; };
    element.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [gl]);
  return guard;
}

function BuildingField({ hoveredId, meshRef, pulseIndices, reducedMotion, onHover, onPick }: {
  hoveredId: string | null;
  meshRef: RefObject<THREE.Mesh | null>;
  /** Indices of the buildings whose venue has an event running right now. */
  pulseIndices: number[];
  reducedMotion: boolean;
  onHover: (id: string | null) => void;
  onPick: (building: CampusBuilding) => void;
}) {
  const { geometry, faceOwner } = useMemo(() => buildBuildingField(), []);
  const outlines = useMemo(() => buildBuildingOutlines(), []);
  // One material for the whole field: the facade bands and the live pulse ride
  // on vertex data and uniforms, so the merge (and the single draw call behind
  // it) stays intact.
  const pulse = useMemo(() => createBuildingPulse(campusBuildings.length), []);
  const material = useMemo(() => createBuildingMaterial(pulse), [pulse]);
  useEffect(() => () => {
    material.dispose();
    pulse.dispose();
  }, [material, pulse]);
  useEffect(() => { pulse.setActive(pulseIndices); }, [pulse, pulseIndices]);
  useEffect(() => { pulse.setMotion(!reducedMotion); }, [pulse, reducedMotion]);
  useFrame((state) => pulse.tick(state.clock.elapsedTime));
  const buildings = useMemo(() => new Map(campusBuildings.map((building) => [building.id, building])), []);
  const selected = hoveredId ? buildings.get(hoveredId) : undefined;
  const guard = useDragGuard(() => onHover(null));

  const owner = (faceIndex: number | null | undefined) => (faceIndex == null
    ? undefined
    : buildings.get(faceOwner[faceIndex]));

  return <>
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      onPointerMove={(event) => {
        if (guard.current.moved) return;
        onHover(owner(event.faceIndex)?.id ?? null);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event) => {
        if (guard.current.moved) return;
        const building = owner(event.faceIndex);
        if (building) onPick(building);
      }}
    />
    {/* Roof and base rings: thin dark edges that keep neighbouring masses apart. */}
    <lineSegments geometry={outlines}>
      <lineBasicMaterial vertexColors transparent opacity={0.72} />
    </lineSegments>
    {selected && <BuildingHighlight building={selected} selected={false} />}
    {selected && <BuildingTag building={selected} />}
  </>;
}

function PinProjector({
  counts, selectedVenueId, isPhone, pinRefs, labelRefs, occluderRef, farDistance, cardRef, cardBox, cardVenueId,
}: {
  counts: Record<string, number>;
  selectedVenueId: string | null;
  isPhone: boolean;
  pinRefs: RefObject<Record<string, HTMLButtonElement | null>>;
  labelRefs: RefObject<Record<string, HTMLSpanElement | null>>;
  occluderRef: RefObject<THREE.Mesh | null>;
  farDistance: number;
  cardRef: RefObject<HTMLDivElement | null>;
  cardBox: RefObject<{ width: number; height: number }>;
  cardVenueId: string | null;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const cardAnchor = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const buildingById = useMemo(() => new Map(campusBuildings.map((building) => [building.id, building])), []);
  const cardVenue = cardVenueId ? venuesById.get(cardVenueId) : undefined;
  const occluded = useRef<Record<string, boolean>>({});
  const nextOcclusionCheck = useRef(0);
  const sizes = useRef<Record<string, { width: number; height: number; badge: number }>>({});
  const heaviest = Math.max(1, ...Object.values(counts));

  // Pins and landmark labels hang over the roof; a venue without a building
  // (node-only place) pins at a fixed height above the ground.
  const roofHeight = (venue: Venue) => {
    const building = venue.osmId ? buildingById.get(venue.osmId) : undefined;
    return building ? building.groundElevation + Math.max(building.height, 3) + 12 : 14;
  };
  const pinHeight = (venueId: string) => (sizes.current[venueId] ?? DEFAULT_PIN_SIZE).height;

  // The boxes are measured off the DOM (badge plus name label) so the separation
  // below matches what the visitor sees. Measured when the pin set or the canvas
  // changes, never per frame: reading offsetWidth forces layout.
  useEffect(() => {
    const measured: Record<string, { width: number; height: number; badge: number }> = {};
    for (const venue of venues) {
      const element = pinRefs.current[venue.id];
      if (!element) continue;
      const badge = element.firstElementChild as HTMLElement | null;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      // A zero box means the pin is not laid out yet; the default keeps the
      // first frames sane instead of collapsing every hit box to a point.
      measured[venue.id] = width > 0 && height > 0
        ? { width, height, badge: badge?.offsetHeight ?? height }
        : DEFAULT_PIN_SIZE;
    }
    sizes.current = measured;
  }, [counts, selectedVenueId, isPhone, size.width, size.height, pinRefs]);

  useFrame((state) => {
    camera.updateMatrixWorld();
    const projected: { id: string; x: number; y: number; anchor: THREE.Vector3; distance: number }[] = [];
    for (const venue of venues) {
      const element = pinRefs.current[venue.id];
      if (!element || !venue.pinAnchor) continue;
      anchor.set(venue.pinAnchor[0], roofHeight(venue), venue.pinAnchor[1]);
      point.copy(anchor).project(camera);
      const onScreen = point.z >= -1 && point.z <= 1
        && Math.abs(point.x) <= 1.12 && Math.abs(point.y) <= 1.12;
      if (!onScreen) {
        element.style.visibility = 'hidden';
        continue;
      }
      projected.push({
        id: venue.id,
        x: (point.x * 0.5 + 0.5) * size.width,
        y: (-point.y * 0.5 + 0.5) * size.height,
        anchor: anchor.clone(),
        distance: camera.position.distanceTo(anchor),
      });
    }

    const weightOf = (id: string) => (counts[id] ?? 0) / heaviest * 0.45 + (id === selectedVenueId ? 1 : 0);
    // The whole pin (badge plus name) counts as its box, so a name only has to
    // be dropped when the shift cap leaves the pins on top of each other.
    const offsets = stackPinColumns(projected.map((entry) => {
      const measured = sizes.current[entry.id] ?? DEFAULT_PIN_SIZE;
      return {
        id: entry.id,
        x: entry.x,
        y: entry.y,
        width: measured.width,
        height: measured.height,
        weight: weightOf(entry.id),
      };
    }), { gap: PIN_GAP, maxShift: PIN_MAX_SHIFT });

    const placed = projected.map((entry, index) => {
      const measured = sizes.current[entry.id] ?? DEFAULT_PIN_SIZE;
      // Keep the badge inside the canvas: a pin pushed against the frame edge
      // would otherwise be clipped instead of read.
      const minX = Math.min(measured.width, size.width) / 2;
      const minY = measured.badge / 2 + 4;
      const maxY = size.height - measured.badge / 2 - 4;
      return {
        entry,
        x: Math.min(Math.max(entry.x + offsets[index].dx, minX), Math.max(minX, size.width - minX)),
        y: Math.min(Math.max(entry.y + offsets[index].dy, minY), Math.max(minY, maxY)),
        measured,
      };
    });

    // Labels that would sit on a badge or on another label are dropped; the
    // badges themselves never move out of the way.
    const hiddenLabels = hideOverlappingLabels(placed.map(({ entry, x, y, measured }) => ({
      id: entry.id,
      priority: weightOf(entry.id),
      box: { x, y, width: measured.width, height: measured.height },
      badge: {
        x,
        y: y - measured.height / 2 + measured.badge / 2,
        width: measured.badge,
        height: measured.badge,
      },
    })));

    for (const { entry, x, y } of placed) {
      const element = pinRefs.current[entry.id];
      if (!element) continue;
      element.style.visibility = 'visible';
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.classList.toggle('is-far', entry.distance > farDistance);
      element.classList.toggle('is-tight', hiddenLabels.has(entry.id));
      element.classList.toggle('is-occluded', occluded.current[entry.id] ?? false);
    }

    for (const venue of venues) {
      const element = labelRefs.current[venue.id];
      if (!element || !venue.pinAnchor) continue;
      // Landmark labels sit under the pin: on the roof when the venue has a
      // building, at pin height when it does not.
      anchor.set(venue.pinAnchor[0], roofHeight(venue) - 8, venue.pinAnchor[1]);
      point.copy(anchor).project(camera);
      const visible = point.z >= -1 && point.z <= 1
        && Math.abs(point.x) <= 1.12 && Math.abs(point.y) <= 1.12;
      element.style.display = visible ? 'flex' : 'none';
      if (visible) {
        element.style.left = `${(point.x * 0.5 + 0.5) * size.width}px`;
        element.style.top = `${(-point.y * 0.5 + 0.5) * size.height}px`;
      }
    }

    // The map card hangs off its pin and follows it through camera moves. A pin
    // that is off screen (or a venue with no pin in this period) still projects
    // the same rooftop point, so the card stays reachable instead of vanishing.
    const card = cardRef.current;
    if (card && !isPhone) {
      const pinned = cardVenueId ? placed.find((item) => item.entry.id === cardVenueId) : undefined;
      let spot: { x: number; y: number; height: number } | null = pinned
        ? { x: pinned.x, y: pinned.y, height: pinned.measured.height }
        : null;
      if (!spot && cardVenue?.pinAnchor) {
        cardAnchor.set(cardVenue.pinAnchor[0], roofHeight(cardVenue), cardVenue.pinAnchor[1]);
        point.copy(cardAnchor).project(camera);
        const visible = point.z >= -1 && point.z <= 1
          && Math.abs(point.x) <= 1.12 && Math.abs(point.y) <= 1.12;
        if (visible) {
          spot = {
            x: (point.x * 0.5 + 0.5) * size.width,
            y: (-point.y * 0.5 + 0.5) * size.height,
            height: pinHeight(cardVenue.id),
          };
        }
      }
      if (!spot) {
        card.style.visibility = 'hidden';
      } else {
        const placement = placeOverlayCard(spot, cardBox.current, { width: size.width, height: size.height });
        card.style.visibility = 'visible';
        card.style.left = `${placement.x}px`;
        card.style.top = `${placement.y}px`;
        if (card.dataset.side !== placement.side) card.dataset.side = placement.side;
      }
    }

    // Occlusion is a raycast per pin, so it runs a few times a second instead of
    // every frame; the fade catches up while the camera settles.
    const now = state.clock.elapsedTime;
    if (now < nextOcclusionCheck.current || !occluderRef.current) return;
    nextOcclusionCheck.current = now + 0.2;
    for (const entry of projected) {
      direction.copy(entry.anchor).sub(camera.position);
      const distance = direction.length();
      raycaster.set(camera.position, direction.normalize());
      raycaster.far = distance - 10;
      occluded.current[entry.id] = raycaster.intersectObject(occluderRef.current, false).length > 0;
      const element = pinRefs.current[entry.id];
      if (element) element.classList.toggle('is-occluded', occluded.current[entry.id]);
    }
  });
  return null;
}

// ---------------------------------------------------------------- camera

function CameraRig({ focusBuildingId, isPhone, reducedMotion, onFitDistance }: {
  focusBuildingId: string | null;
  isPhone: boolean;
  reducedMotion: boolean;
  onFitDistance: (distance: number) => void;
}) {
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const tiltDeg = isPhone ? MOBILE_TILT_DEG : DESKTOP_TILT_DEG;
  const engaged = useRef(false);
  const flight = useRef<{
    fromPosition: THREE.Vector3; fromTarget: THREE.Vector3;
    toPosition: THREE.Vector3; toTarget: THREE.Vector3; startedAt: number;
  } | null>(null);
  const scratch = useMemo(() => ({
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    framePosition: new THREE.Vector3(),
    frameTarget: new THREE.Vector3(),
  }), []);

  // Actions: left drag pans, right drag rotates/tilts, wheel and pinch dolly.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { ACTION } = CameraControlsImpl;
    controls.minDistance = CAMERA_MIN_DISTANCE;
    controls.maxDistance = CAMERA_MAX_DISTANCE;
    controls.minPolarAngle = (CAMERA_MIN_POLAR * Math.PI) / 180;
    controls.maxPolarAngle = (CAMERA_MAX_POLAR * Math.PI) / 180;
    controls.smoothTime = 0.45;
    controls.draggingSmoothTime = 0.16;
    controls.dollyToCursor = true;
    controls.boundaryFriction = 0.2;
    controls.mouseButtons = {
      left: ACTION.TRUCK,
      middle: ACTION.DOLLY,
      right: ACTION.ROTATE,
      wheel: ACTION.DOLLY,
    };
    controls.setBoundary(new THREE.Box3(
      new THREE.Vector3(campusBounds.minX, -40, campusBounds.minZ),
      new THREE.Vector3(campusBounds.maxX, 260, campusBounds.maxZ),
    ));
    const stopFlight = () => { flight.current = null; engaged.current = true; };
    controls.addEventListener('controlstart', stopFlight);
    return () => controls.removeEventListener('controlstart', stopFlight);
  }, []);

  // On phones one finger belongs to the page (Google Maps embed behaviour), so
  // navigation moves to two fingers: pinch+twist, three fingers to pan.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { ACTION } = CameraControlsImpl;
    controls.touches = {
      ...controls.touches,
      one: isPhone ? ACTION.NONE : ACTION.TOUCH_TRUCK,
      two: ACTION.TOUCH_DOLLY_ROTATE,
      three: ACTION.TOUCH_TRUCK,
    };
  }, [isPhone]);

  // Opening pose: the campus boundary, tilted, north up. Refit on resize until
  // the visitor takes over, then leave their view alone.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || engaged.current) return;
    const aspect = size.width / Math.max(size.height, 1);
    const pose = initialCameraPose(campusFramePoints, aspect, FOV, tiltDeg, FRAME_MARGIN);
    controls.setLookAt(
      pose.position[0], pose.position[1], pose.position[2],
      pose.target[0], pose.target[1], pose.target[2], false,
    );
    onFitDistance(pose.distance);
  }, [size.width, size.height, isPhone, tiltDeg, onFitDistance]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !focusBuildingId) return;
    const building = campusBuildings.find((item) => item.id === focusBuildingId);
    if (!building) return;
    engaged.current = true;
    const perspective = camera as THREE.PerspectiveCamera;
    const aspect = perspective.isPerspectiveCamera ? perspective.aspect : 1.6;
    const height = Math.max(building.height, 3);
    const distance = flyDistanceFor(footprintRadius(building.points), FOV, aspect, 1.7);
    const [targetX, targetZ] = clampPointToBounds(building.center, campusBounds);
    const toTarget = new THREE.Vector3(targetX, building.groundElevation + height * 0.45, targetZ);
    const tilt = (tiltDeg * Math.PI) / 180;
    const currentTarget = controls.getTarget(scratch.target).clone();
    const currentPosition = controls.getPosition(scratch.position).clone();
    scratch.offset.copy(currentPosition).sub(currentTarget);
    // Keep the visitor's compass heading, but land on the standard map tilt.
    const azimuth = Math.atan2(scratch.offset.x, scratch.offset.z);
    const toPosition = new THREE.Vector3(
      toTarget.x + Math.sin(azimuth) * Math.cos(tilt) * distance,
      toTarget.y + Math.sin(tilt) * distance,
      toTarget.z + Math.cos(azimuth) * Math.cos(tilt) * distance,
    );
    if (reducedMotion) {
      controls.setLookAt(toPosition.x, toPosition.y, toPosition.z, toTarget.x, toTarget.y, toTarget.z, false);
      return;
    }
    flight.current = {
      fromPosition: currentPosition,
      fromTarget: currentTarget,
      toPosition,
      toTarget,
      startedAt: performance.now(),
    };
  }, [focusBuildingId, reducedMotion, camera, tiltDeg, scratch]);

  useFrame(() => {
    const active = flight.current;
    const controls = controlsRef.current;
    if (!active || !controls) return;
    const progress = Math.min(1, (performance.now() - active.startedAt) / (FLIGHT_SECONDS * 1000));
    const eased = easeInOutCubic(progress);
    scratch.framePosition.lerpVectors(active.fromPosition, active.toPosition, eased);
    scratch.frameTarget.lerpVectors(active.fromTarget, active.toTarget, eased);
    controls.setLookAt(
      scratch.framePosition.x, scratch.framePosition.y, scratch.framePosition.z,
      scratch.frameTarget.x, scratch.frameTarget.y, scratch.frameTarget.z, false,
    );
    if (progress >= 1) flight.current = null;
  });

  return <CameraControls ref={controlsRef} />;
}

/**
 * camera-controls pins `touch-action: none` on connect; on phones the page must
 * keep its vertical scroll, so the canvas is relaxed again after connect (and
 * once more on the next frame, whatever the mount order turns out to be).
 */
function TouchActionSettings({ isPhone }: { isPhone: boolean }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const element = gl.domElement;
    const apply = () => { element.style.touchAction = isPhone ? 'pan-y' : 'none'; };
    apply();
    const frame = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(frame);
      element.style.touchAction = '';
    };
  }, [gl, isPhone]);
  return null;
}

// ---------------------------------------------------------------- scene

function SceneContent(props: Props & {
  pinRefs: RefObject<Record<string, HTMLButtonElement | null>>;
  labelRefs: RefObject<Record<string, HTMLSpanElement | null>>;
  cardRef: RefObject<HTMLDivElement | null>;
  cardBox: RefObject<{ width: number; height: number }>;
  groundTexture: THREE.CanvasTexture | null;
  isPhone: boolean;
  reducedMotion: boolean;
  fitDistance: number;
  onFitDistance: (distance: number) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusBuildingId, setFocusBuildingId] = useState<string | null>(null);
  const buildingsRef = useRef<THREE.Mesh | null>(null);
  const gl = useThree((state) => state.gl);
  useCursor(hoveredId !== null, 'pointer', 'grab', gl.domElement);

  const pulseIndices = useMemo(() => props.liveVenueIds
    .map((id) => venuesById.get(id)?.osmId)
    .map((osmId) => (osmId ? buildingFieldIndex.get(osmId) : undefined))
    .filter((index): index is number => index !== undefined), [props.liveVenueIds]);

  // A pin click (and the shared event URL) selects a venue; a building click
  // selects the building itself. Both funnel into one camera focus, and a search
  // pick can point at any labelled building, venue or not.
  useEffect(() => {
    if (props.focusBuildingId) {
      setFocusBuildingId(props.focusBuildingId);
      return;
    }
    const next = props.selectedVenueId
      ? venues.find((item) => item.id === props.selectedVenueId)?.osmId ?? null
      : null;
    setFocusBuildingId(next);
  }, [props.selectedVenueId, props.focusBuildingId]);

  const pick = (building: CampusBuilding) => {
    setFocusBuildingId(building.id);
    const venue = venueByOsmId.get(building.id);
    if (venue) props.onSelectVenue(venue.id);
  };

  const selectedBuilding = focusBuildingId
    ? campusBuildings.find((building) => building.id === focusBuildingId)
    : undefined;

  return <>
    <color attach="background" args={[SKY_HORIZON]} />
    {/* Fog starts beyond the framed campus so the opening view is never washed out. */}
    <fog
      attach="fog"
      args={[FOG_COLOR, props.fitDistance * 1.35, props.fitDistance * 1.35 + 2400]}
    />
    <SkyDome />
    <BaseGround />
    <ambientLight intensity={0.42} />
    <hemisphereLight args={['#dce9f3', '#93a184', 0.7]} />
    <directionalLight
      castShadow
      position={SUN_POSITION}
      intensity={1.85}
      color="#fff2df"
      shadow-mapSize={[props.isPhone ? 1024 : 2048, props.isPhone ? 1024 : 2048]}
      shadow-camera-left={-1120} shadow-camera-right={1120}
      shadow-camera-top={880} shadow-camera-bottom={-880}
      shadow-camera-near={200} shadow-camera-far={2900}
      shadow-bias={-0.0004}
      shadow-normalBias={0.7}
    />
    <GroundSurface texture={props.groundTexture} />
    <CampusOutline />
    <BuildingField
      hoveredId={hoveredId}
      meshRef={buildingsRef}
      pulseIndices={pulseIndices}
      reducedMotion={props.reducedMotion}
      onHover={setHoveredId}
      onPick={pick}
    />
    {selectedBuilding && selectedBuilding.id !== hoveredId && <BuildingHighlight building={selectedBuilding} selected />}
    {campusGates.filter((gate) => gate.onBoundary).map((gate) => (
      <mesh key={gate.id} position={[gate.point[0], 6, gate.point[1]]}>
        <sphereGeometry args={[7, 12, 10]} />
        <meshStandardMaterial color="#f2f7ee" />
      </mesh>
    ))}
    <Trees />
    <PinProjector
      counts={props.counts}
      selectedVenueId={props.selectedVenueId}
      isPhone={props.isPhone}
      pinRefs={props.pinRefs}
      labelRefs={props.labelRefs}
      occluderRef={buildingsRef}
      farDistance={Math.max(props.fitDistance * 1.35, 1200)}
      cardRef={props.cardRef}
      cardBox={props.cardBox}
      cardVenueId={props.cardVenueId}
    />
    <CameraRig
      focusBuildingId={focusBuildingId}
      isPhone={props.isPhone}
      reducedMotion={props.reducedMotion}
      onFitDistance={props.onFitDistance}
    />
    <TouchActionSettings isPhone={props.isPhone} />
  </>;
}

// ---------------------------------------------------------------- hooks

/** Phone breakpoint, the same one the map styles use for the sheet layout. */
const PHONE_WIDTH = 760;

/** True on phone-width viewports; the touch contract differs, the canvas must not remount. */
function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth <= PHONE_WIDTH);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${PHONE_WIDTH}px)`);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return isPhone;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * The satellite layer is opt-in and remembered. It is the only part of the scene
 * that talks to a tile server, and those terms do not allow shipping the imagery,
 * so it is always fetched live from the provider.
 */
const SATELLITE_KEY = 'kampuste:uydu';

function readSatellitePreference(): boolean {
  try {
    return window.localStorage.getItem(SATELLITE_KEY) === '1';
  } catch {
    return false; // private mode or a blocked storage: stay on the styled ground
  }
}

function saveSatellitePreference(value: boolean) {
  try {
    window.localStorage.setItem(SATELLITE_KEY, value ? '1' : '0');
  } catch {
    /* The layer still works for this visit. */
  }
}

export default function CampusScene(props: Props) {
  const pinRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const labelRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardBox = useRef({ width: 0, height: 0 });
  const [fitDistance, setFitDistance] = useState(DEFAULT_FIT_DISTANCE);
  const [satellite, setSatellite] = useState(readSatellitePreference);
  const showLandmarks = !Object.values(props.counts).some((count) => count > 0);
  const isPhone = useIsPhone();
  const reducedMotion = usePrefersReducedMotion();

  // The styled ground is always there; the satellite texture replaces it only
  // once the tiles have arrived, so turning the layer on never shows a blank map.
  const styledTexture = useStyledGroundTexture();
  const satelliteState = useSatelliteGroundTexture(satellite);
  const showingSatellite = satellite && satelliteState.status === 'ready';
  const toggleSatellite = () => {
    const next = !satellite;
    saveSatellitePreference(next);
    setSatellite(next);
  };
  const cardVenue = props.cardVenueId ? venuesById.get(props.cardVenueId) ?? null : null;
  const liveVenueIds = useMemo(() => new Set(props.liveVenueIds), [props.liveVenueIds]);

  // The card's box is read off the DOM so the frame loop can keep it inside the
  // canvas without measuring layout per frame; a resize (new events, a wider
  // poster) re-measures on its own.
  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const measure = () => {
      cardBox.current = { width: element.offsetWidth, height: element.offsetHeight };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cardVenue?.id, isPhone]);

  // A two-finger gesture belongs to the map, so the page must not scroll while
  // it is in progress; one finger keeps the browser's native scroll.
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => element.removeEventListener('touchmove', onTouchMove);
  }, []);

  return <div className="map-3d" ref={wrapperRef}>
    <Canvas
      shadows="percentage"
      dpr={CANVAS_DPR}
      gl={CANVAS_GL}
      camera={CANVAS_CAMERA}
      role="img"
      aria-label="Yunus Emre Kampüsü üç boyutlu haritası. Bir binanın etkinliklerini görmek için üzerine tıkla."
    >
      <SceneContent
        {...props}
        pinRefs={pinRefs}
        labelRefs={labelRefs}
        cardRef={cardRef}
        cardBox={cardBox}
        groundTexture={satelliteState.texture ?? styledTexture}
        isPhone={isPhone}
        reducedMotion={reducedMotion}
        fitDistance={fitDistance}
        onFitDistance={setFitDistance}
      />
    </Canvas>
    <div className="map-pin-layer">
      {venues.filter((venue) => venue.pinAnchor && props.counts[venue.id] > 0).map((venue) => <button
        key={venue.id}
        ref={(element) => { pinRefs.current[venue.id] = element; }}
        type="button"
        className={`map-pin map-pin-3d ${props.selectedVenueId === venue.id ? 'is-selected' : ''}${liveVenueIds.has(venue.id) ? ' is-live' : ''}`}
        onClick={() => props.onSelectVenue(venue.id)}
        aria-label={`${venue.name}: ${props.counts[venue.id]} etkinlik${liveVenueIds.has(venue.id) ? ', şu an etkinlik sürüyor' : ''}`}
      >
        <span className="map-pin-count">{props.counts[venue.id]}</span>
        <span className="map-pin-label">{venue.shortName}</span>
      </button>)}
      {showLandmarks && venues.filter((venue) => ['akm', 'ogrenci-merkezi', 'sinema', 'kutuphane'].includes(venue.id)).map((venue) => <span
        key={venue.id} ref={(element) => { labelRefs.current[venue.id] = element; }}
        className="map-building-label map-building-label-3d"
      >{venue.shortName}</span>)}
    </div>
    {cardVenue && (isPhone
      ? <VenueSheet
        key={cardVenue.id}
        venue={cardVenue}
        events={props.cardEvents}
        onClose={props.onCloseCard}
        onOpenEvent={props.onOpenEvent}
        onShowAll={props.onShowVenueEvents}
      />
      : <div className="venue-card-layer">
        <VenueCard
          key={cardVenue.id}
          venue={cardVenue}
          events={props.cardEvents}
          containerRef={cardRef}
          onClose={props.onCloseCard}
          onOpenEvent={props.onOpenEvent}
          onShowAll={props.onShowVenueEvents}
        />
      </div>)}
    <div className="map-satellite">
      <button
        type="button"
        className={`map-satellite-toggle${satellite ? ' is-on' : ''}`}
        onClick={toggleSatellite}
        aria-pressed={satellite}
      ><GlobeHemisphereWest size={14} weight="regular" aria-hidden="true" /> Uydu</button>
      {satellite && satelliteState.status === 'loading' && <span className="map-satellite-note" role="status">
        Uydu görüntüsü yükleniyor…
      </span>}
      {satellite && satelliteState.status === 'error' && <span className="map-satellite-note" role="status">
        Uydu görüntüsü yüklenemedi; stilize zemin gösteriliyor.
      </span>}
    </div>
    <span className="map-credits">
      {groundLayer.attribution.map((entry) => (
        <a key={entry.text} href={entry.url} target="_blank" rel="noopener noreferrer">{entry.text}</a>
      ))}
      <span>·</span>
      <a href={campus.attribution.url} target="_blank" rel="noopener noreferrer">{campus.attribution.text}</a>
      {showingSatellite && <>
        <span>·</span>
        <span>{groundLayer.image.credit}</span>
      </>}
    </span>
    <span className="map-touch-hint" aria-hidden="true">İki parmakla gezin · Tek parmakla sayfayı kaydır</span>
  </div>;
}
