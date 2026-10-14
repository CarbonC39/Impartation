import { appearanceSchema, FACINGS, type Facing, type Motion } from '@virtual-workspace/shared';

// Source frame dimensions belong to the character, independently of map tile dimensions.
// Four columns per direction, in down/left/right/up row order.
const character = {
  texture: 'character-walk', url: '/characters/walk.png',
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
  mint: { ...character, tint: 0x88dbb4 },
  amber: { ...character, tint: 0xefbd65 },
  violet: { ...character, tint: 0xbb9de8 },
} as const;
export function avatarDefinition(id: string) {
  return avatars[id as keyof typeof avatars] ?? avatars.mint;
}
const appearanceTints = { coral:0xf07872, sunshine:0xf2c552, sky:0x64a9df, leaf:0x67ae80, lilac:0xaa82cf } as const;
const tintCache = new Map<string, number>();
export function appearanceTint(avatarId: string, serializedAppearance: string): number {
  const cached = tintCache.get(serializedAppearance);
  if (cached !== undefined) return cached;
  try {
    const appearance = appearanceSchema.parse(JSON.parse(serializedAppearance));
    const tint = appearanceTints[appearance.topColor];
    tintCache.set(serializedAppearance, tint);
    return tint;
  } catch { return avatarDefinition(avatarId).tint; }
}

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
