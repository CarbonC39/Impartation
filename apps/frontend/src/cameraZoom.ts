import { readPreference, writePreference } from './preferences';

const ZOOM_KEY = 'virtual-workspace-camera-zoom';
export const MIN_CAMERA_ZOOM = 1;
export const MAX_CAMERA_ZOOM = 6;
const TARGET_TILE_PIXELS = 48;

export function automaticCameraZoom(tileWidth: number, tileHeight: number): number {
  const size = Math.max(tileWidth, tileHeight);
  if (!Number.isFinite(size) || size <= 0) return MIN_CAMERA_ZOOM;
  return Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, Math.round(TARGET_TILE_PIXELS / size)));
}

export function cameraZoomPreference(): number | null {
  const raw = readPreference(ZOOM_KEY);
  const value = Number(raw);
  return raw !== null && raw !== '' && Number.isInteger(value) && value >= MIN_CAMERA_ZOOM && value <= MAX_CAMERA_ZOOM
    ? value : null;
}

export function setCameraZoomPreference(value: number | null) {
  if (value !== null && (!Number.isInteger(value) || value < MIN_CAMERA_ZOOM || value > MAX_CAMERA_ZOOM)) return;
  writePreference(ZOOM_KEY, value === null ? '' : String(value));
}

export function cameraZoom(tileWidth: number, tileHeight: number): number {
  return cameraZoomPreference() ?? automaticCameraZoom(tileWidth, tileHeight);
}
