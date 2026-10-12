import { z } from 'zod';
import type { MovementInput } from './index.js';

export const FACINGS = ['down', 'left', 'right', 'up'] as const;
export const facingSchema = z.enum(FACINGS);
export type Facing = z.infer<typeof facingSchema>;
export type Motion = 'idle' | 'walk';
export type CharacterAction = 'none' | 'sit';

/** Vertical input wins on diagonals; zero input preserves the last facing. */
export function movementFacing(input: MovementInput, previous: Facing): Facing {
  if (input.y) return input.y > 0 ? 'down' : 'up';
  if (input.x) return input.x > 0 ? 'right' : 'left';
  return previous;
}

export const activateSchema = z.object({ objectId: z.string().trim().min(1).max(128) });
export type ActivateInput = z.infer<typeof activateSchema>;
