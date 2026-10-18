import { APPEARANCE_ASSET_PATHS, APPEARANCE_LAYERS, appearanceSchema, FACINGS, type Facing, type Motion } from '@virtual-workspace/shared';

export const layerAssets: Record<string, string> = APPEARANCE_ASSET_PATHS;
export const layerAssetIds = Object.keys(APPEARANCE_ASSET_PATHS);

// Source frame dimensions belong to the character, independently of map tile dimensions.
// Four columns per row, in down/left/right/up direction order.
// Column zero is the standing pose; columns 1-3 are step / passing / opposite step, so a walk
// starts on the first step and ping-pongs through the passing pose instead of revisiting the idle frame.
const character = {
  frameWidth: 16, frameHeight: 24,
  // Frame-local foot point; transparent padding does not define the ground anchor.
  groundAnchor: { x: 8, y: 23 },
  walk: { down: [1, 2, 3, 2], left: [5, 6, 7, 6], right: [9, 10, 11, 10], up: [13, 14, 15, 14] },
  idle: { down: 0, left: 4, right: 8, up: 12 },
  // Action rows follow the four walking rows; column zero is the static pose.
  actions: { sit: { down: 16, left: 20, right: 24, up: 28 } },
  frameMs: 120,
  // Stride timing tuned to PLAYER_SPEED so feet do not visibly slide.
  walkFrameMs: 100,
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
  return frames[Math.floor(Math.max(0, elapsedMs) / avatar.walkFrameMs) % frames.length];
}

export function characterFacing(value: string): Facing {
  return FACINGS.find(facing => facing === value) ?? 'down';
}
