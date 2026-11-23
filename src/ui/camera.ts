// Pan & zoom for the map. Offsets are in screen pixels, zoom multiplies the fitted hex size.

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 8;

export const DEFAULT_ZOOM = 1.8;
export const newCamera = (zoom = DEFAULT_ZOOM): Camera => ({ x: 0, y: 0, zoom });

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Keep at least part of the map on screen. `mapRadiusPx` is the map's radius at zoom 1. */
export function clampCamera(cam: Camera, mapRadiusPx: number): void {
  const lim = mapRadiusPx * cam.zoom;
  cam.x = Math.max(-lim, Math.min(lim, cam.x));
  cam.y = Math.max(-lim, Math.min(lim, cam.y));
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(cam: Camera, factor: number, px: number, py: number, w: number, h: number): void {
  const z2 = clampZoom(cam.zoom * factor);
  const k = z2 / cam.zoom;
  const cx = w / 2 + cam.x;
  const cy = h / 2 + cam.y;
  cam.x = px - (px - cx) * k - w / 2;
  cam.y = py - (py - cy) * k - h / 2;
  cam.zoom = z2;
}

export function resetCamera(cam: Camera): void {
  cam.x = 0;
  cam.y = 0;
  cam.zoom = DEFAULT_ZOOM;
}
