import { z } from 'zod';

export const occupancyResponseSchema = z.object({
  spaces: z.array(z.object({
    spaceId: z.string(), online: z.number().int().nonnegative(), capacity: z.number().int().positive(),
    maps: z.array(z.object({ mapId: z.string(), online: z.number().int().nonnegative() })),
  })),
});
export type OccupancyResponse = z.infer<typeof occupancyResponseSchema>;
