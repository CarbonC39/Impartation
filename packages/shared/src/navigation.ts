import { z } from 'zod';
import { spaceIdSchema } from './world.js';

const mapIdSchema = z.string().trim().min(1).max(128);
export const quickTravelSchema = z.object({ mapId: mapIdSchema });
export type QuickTravelInput = z.infer<typeof quickTravelSchema>;

/** Online counts exclude disconnected players retained in the reconnection window. */
export const occupancySchema = z.object({
  spaces: z.array(z.object({
    id: spaceIdSchema,
    online: z.number().int().nonnegative(),
    capacity: z.number().int().positive(),
    maps: z.array(z.object({ id: mapIdSchema, online: z.number().int().nonnegative() })),
  })),
});
export type Occupancy = z.infer<typeof occupancySchema>;
