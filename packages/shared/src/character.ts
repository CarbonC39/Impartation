import { z } from 'zod';
import type { MovementInput } from './index.js';

export const FACINGS = ['down', 'left', 'right', 'up'] as const;
export const facingSchema = z.enum(FACINGS);
export type Facing = z.infer<typeof facingSchema>;
export type Motion = 'idle' | 'walk';
export type CharacterAction = string;
// Action names describe character abilities, independently of map objects.
export const actionNameSchema = z.string().trim().min(1).max(32)
  .regex(/^[a-z][a-z0-9_-]*$/).refine(value => value !== 'none', 'none is the inactive state');

/** Vertical input wins on diagonals; zero input preserves the last facing. */
export function movementFacing(input: MovementInput, previous: Facing): Facing {
  if (input.y) return input.y > 0 ? 'down' : 'up';
  if (input.x) return input.x > 0 ? 'right' : 'left';
  return previous;
}

/** Actions the server accepts and the client offers; each entry needs matching character sprite rows. */
export const CHARACTER_ACTIONS = {
  sit: { label: '坐下', activeLabel: '已坐下', animated: true },
} as const satisfies Record<string, { label: string; activeLabel: string; animated: boolean }>;
export type CharacterActionName = keyof typeof CHARACTER_ACTIONS;
export const CHARACTER_ACTION_NAMES = Object.keys(CHARACTER_ACTIONS) as [CharacterActionName, ...CharacterActionName[]];
export const characterActionSchema = z.enum(CHARACTER_ACTION_NAMES);
export function isCharacterAction(value: string): value is CharacterActionName {
  return Object.hasOwn(CHARACTER_ACTIONS, value);
}
export const activateActionSchema = z.object({
  action: z.string().trim().pipe(characterActionSchema), animated: z.boolean().default(false),
});
export type ActivateActionInput = z.input<typeof activateActionSchema>;
export type ActivateAction = z.output<typeof activateActionSchema>;
