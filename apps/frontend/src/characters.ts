import { FACINGS, type Facing, type Motion, type CharacterAction } from '@virtual-workspace/shared';

// Source frame dimensions belong to the character, independently of map tile dimensions.
// Four columns per direction, in down/left/right/up row order.
const character = {
  texture: 'character-walk', url: '/characters/walk.png',
  frameWidth: 16, frameHeight: 24,
  anchor: { x: 0.5, y: 1 },
  walk: { down: [0, 1, 2, 3], left: [4, 5, 6, 7], right: [8, 9, 10, 11], up: [12, 13, 14, 15] },
  idle: { down: 0, left: 4, right: 8, up: 12 },
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

/** Local time selects frames; sitting uses a directional idle pose until sit art is supplied. */
export function characterFrame(avatarId: string, facing: Facing, motion: Motion, action: CharacterAction, elapsedMs: number): number {
  const avatar = avatarDefinition(avatarId);
  if (action === 'sit' || motion === 'idle') return avatar.idle[facing];
  const frames = avatar.walk[facing];
  return frames[Math.floor(Math.max(0, elapsedMs) / avatar.frameMs) % frames.length];
}

export function characterFacing(value: string): Facing {
  return FACINGS.find(facing => facing === value) ?? 'down';
}
