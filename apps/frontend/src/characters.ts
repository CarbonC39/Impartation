import { APPEARANCE_ASSETS, appearanceSchema, FACINGS, type Facing, type Motion } from '@virtual-workspace/shared';

export const layerAssets = {
  base: '/characters/walk.png', eyes: '/characters/eyes.png',
  hair1: '/characters/hair1.png', hair2: '/characters/hair2.png',
  hair3: '/characters/hair3.png', hair4: '/characters/hair4.png',
  hair6: '/characters/hair6.png', hair7: '/characters/hair7.png',
  shirt: '/characters/shirt.png', 't-shirt': '/characters/t-shirt.png',
  school_uniform: '/characters/school_uniform.png', suit: '/characters/suit.png',
  pants: '/characters/pants.png', skirt: '/characters/skirt.png', shoes: '/characters/shoes.png',
} as const;
export type LayerAssetId = keyof typeof layerAssets;
export const layerAssetIds = Object.values(APPEARANCE_ASSETS).flat() as LayerAssetId[];

// Source frame dimensions belong to the character, independently of map tile dimensions.
// Four columns per row, in down/left/right/up direction order.
const character = {
  frameWidth: 16, frameHeight: 24,
  // Frame-local foot point; transparent padding does not define the ground anchor.
  groundAnchor: { x: 8, y: 23 },
  walk: { down: [0, 1, 2, 3], left: [4, 5, 6, 7], right: [8, 9, 10, 11], up: [12, 13, 14, 15] },
  idle: { down: 0, left: 4, right: 8, up: 12 },
  // Action rows follow the four walking rows; column zero is the static pose.
  actions: { sit: { down: 16, left: 20, right: 24, up: 28 } },
  frameMs: 120,
} as const;
export const avatars = {
  mint: character, amber: character, violet: character,
} as const;
export function avatarDefinition(id: string) {
  return avatars[id as keyof typeof avatars] ?? avatars.mint;
}
function defaultAppearance() { return appearanceSchema.parse({}); }
const appearanceCache = new Map<string, ReturnType<typeof defaultAppearance>>();
export function characterAppearance(serialized: string) {
  const cached = appearanceCache.get(serialized);
  if (cached) return cached;
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { parsed = {}; }
  const appearance = appearanceSchema.safeParse(parsed);
  const value = appearance.success ? appearance.data : defaultAppearance();
  appearanceCache.set(serialized, value);
  return value;
}
export function tintNumber(color: string): number { return Number.parseInt(color.slice(1), 16); }

/** Local time selects walk or configured action frames; unconfigured actions fall back to directional idle. */
export function characterFrame(avatarId: string, facing: Facing, motion: Motion, action: string,
  actionAnimated: boolean, elapsedMs: number): number {
  const avatar = avatarDefinition(avatarId);
  if (action !== 'none') {
    const rows = avatar.actions[action as keyof typeof avatar.actions];
    const row = rows?.[facing];
    if (row === undefined) return avatar.idle[facing];
    if (!actionAnimated) return row;
    return row + 1 + Math.floor(Math.max(0, elapsedMs) / avatar.frameMs) % 3;
  }
  if (motion === 'idle') return avatar.idle[facing];
  const frames = avatar.walk[facing];
  return frames[Math.floor(Math.max(0, elapsedMs) / avatar.frameMs) % frames.length];
}

export function characterFacing(value: string): Facing {
  return FACINGS.find(facing => facing === value) ?? 'down';
}
