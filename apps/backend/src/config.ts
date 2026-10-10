import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const config = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  DATABASE_PATH: z.string().default(fileURLToPath(new URL('../../../data/world.sqlite', import.meta.url))),
  MAP_PATH: z.string().default(fileURLToPath(new URL('../../../assets/maps/lobby.tmj', import.meta.url))),
}).parse(process.env);
