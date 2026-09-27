// The two ground textures of the 3D scene:
//
//   styled    — the OSM campus geometry drawn into a canvas (the default)
//   satellite — Esri World Imagery tiles, fetched at run time and only when the
//               visitor asks for them
//
// Nothing is bundled either way: the styled canvas is generated from the campus
// data, and the satellite tiles come straight from the provider. The build ships
// no imagery, which is what the provider's terms require.
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { groundLayer } from './campus';
import { drawStyledGround } from './ground-style';

export type SatelliteStatus = 'off' | 'loading' | 'ready' | 'error';

type Signal = { cancelled: boolean };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error(`görüntü yüklenemedi: ${url}`)));
    image.src = url;
  });
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Mipmaps plus anisotropic filtering, so the ground stays crisp at a glancing
  // angle without turning into a shimmering mess in the distance.
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  (window as unknown as { __groundCanvas?: HTMLCanvasElement }).__groundCanvas = canvas;
  return texture;
}

/** Tiles of the ground window, drawn into one canvas mosaic and cropped to the local metre box. */
async function buildSatelliteTexture(signal: Signal): Promise<THREE.CanvasTexture | null> {
  const { tileRange, tileSize, mosaicWidth, mosaicHeight, crop, urlTemplate } = groundLayer.image;
  const canvas = document.createElement('canvas');
  canvas.width = mosaicWidth;
  canvas.height = mosaicHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#c8cfc2';
  context.fillRect(0, 0, mosaicWidth, mosaicHeight);

  let loaded = 0;
  const jobs: Promise<void>[] = [];
  for (let x = tileRange.left; x <= tileRange.right; x += 1) {
    for (let y = tileRange.top; y <= tileRange.bottom; y += 1) {
      const url = urlTemplate.replace('{x}', String(x)).replace('{y}', String(y));
      jobs.push(loadImage(url).then((image) => {
        if (signal.cancelled) return;
        loaded += 1;
        context.drawImage(image, (x - tileRange.left) * tileSize, (y - tileRange.top) * tileSize, tileSize, tileSize);
      }).catch(() => { /* A missing tile keeps the plain canvas colour. */ }));
    }
  }
  await Promise.all(jobs);
  // No tile at all means the provider is unreachable; the caller keeps the
  // styled ground instead of showing an empty mosaic.
  if (signal.cancelled || loaded === 0) return null;

  // The crop that matches the local metre box is drawn straight into the final
  // canvas, so the plane needs no offset/repeat tricks (those are shared by every
  // user of the texture and silently sample the wrong pixels).
  const cropped = document.createElement('canvas');
  cropped.width = Math.round(crop.width);
  cropped.height = Math.round(crop.height);
  const croppedContext = cropped.getContext('2d');
  if (!croppedContext) return null;
  croppedContext.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, cropped.width, cropped.height);
  return canvasTexture(cropped);
}

/** The styled ground: generated once per session, no network involved. */
export function useStyledGroundTexture(): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let created: THREE.CanvasTexture | null = null;
    try {
      const canvas = drawStyledGround();
      if (!canvas) throw new Error('tuval bağlamı yok');
      created = canvasTexture(canvas);
      setTexture(created);
    } catch (error: unknown) {
      console.warn(`Stilize zemin kurulamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
    return () => {
      if (created) created.dispose();
    };
  }, []);
  return texture;
}

// One satellite mosaic per session: toggling the layer off and on again must not
// download the tiles a second time.
let satelliteCache: THREE.CanvasTexture | null = null;

/**
 * Satellite ground, loaded only while `enabled`. The styled ground stays visible
 * until the tiles arrive; a failure leaves the status at `error` and the caller
 * shows the styled ground.
 */
export function useSatelliteGroundTexture(enabled: boolean): { texture: THREE.CanvasTexture | null; status: SatelliteStatus } {
  const [state, setState] = useState<{ texture: THREE.CanvasTexture | null; status: SatelliteStatus }>(
    () => ({ texture: satelliteCache, status: satelliteCache ? 'ready' : 'off' }),
  );

  useEffect(() => {
    if (!enabled) {
      setState({ texture: satelliteCache, status: satelliteCache ? 'ready' : 'off' });
      return;
    }
    if (satelliteCache) {
      setState({ texture: satelliteCache, status: 'ready' });
      return;
    }
    const signal: Signal = { cancelled: false };
    setState({ texture: null, status: 'loading' });
    buildSatelliteTexture(signal).then((texture) => {
      if (signal.cancelled) {
        texture?.dispose();
        return;
      }
      if (!texture) {
        setState({ texture: null, status: 'error' });
        return;
      }
      satelliteCache = texture;
      setState({ texture, status: 'ready' });
    }).catch((error: unknown) => {
      if (signal.cancelled) return;
      console.warn(`Uydu zemini kurulamadı: ${error instanceof Error ? error.message : String(error)}`);
      setState({ texture: null, status: 'error' });
    });
    return () => { signal.cancelled = true; };
  }, [enabled]);

  return state;
}
