/** Six-digit RGB colors and the soft (low-saturation, high-value) range that suits the candy pixel art. */
export type Hsv = { h: number; s: number; v: number };

/** HSV bounds of the soft range; the picker draws it as the top-left box of its saturation/value field. */
export const SOFT_COLOR_ZONE = { minSaturation: 0.1, maxSaturation: 0.5, minValue: 0.8, maxValue: 1 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(channel => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map(channel => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) h = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: h * 60, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return rgbToHex(channel(5), channel(3), channel(1));
}

/** Small tolerance so that colors produced by clamping and hex rounding still count as inside. */
export function isSoftColor(hex: string): boolean {
  const { s, v } = hexToHsv(hex);
  const zone = SOFT_COLOR_ZONE;
  return s >= zone.minSaturation - 0.01 && s <= zone.maxSaturation + 0.01 && v >= zone.minValue - 0.01;
}

/** Keeps the hue and moves saturation/value onto the nearest edge of the soft range. */
export function clampSoftHsv({ h, s, v }: Hsv): Hsv {
  const zone = SOFT_COLOR_ZONE;
  return { h, s: clamp(s, zone.minSaturation, zone.maxSaturation), v: clamp(v, zone.minValue, zone.maxValue) };
}

export function clampSoftColor(hex: string): string {
  return hsvToHex(clampSoftHsv(hexToHsv(hex)));
}
