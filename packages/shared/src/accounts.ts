import { z } from 'zod';
import { appearanceSchema } from './index.js';

export const savedOutfitSchema = z.object({
  name: z.string().trim().min(1).max(12),
  appearance: z.lazy(() => appearanceSchema),
}).strict();

export const savedOutfitsSchema = z.array(savedOutfitSchema.nullable()).length(3);
export type SavedOutfits = z.infer<typeof savedOutfitsSchema>;
