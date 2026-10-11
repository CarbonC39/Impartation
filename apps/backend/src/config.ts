import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const config = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  DATABASE_PATH: z.string().default(fileURLToPath(new URL('../../../data/world.sqlite', import.meta.url))),
  MAP_PATH: z.string().default(fileURLToPath(new URL('../../../assets/maps/lobby.tmj', import.meta.url))),
  EXTERNAL_TOOLS: z.string().default('{}'),
  IDENTITY_SECRET: z.string().min(32).default('development-only-identity-secret-change-before-production'),
  IDENTITY_BASE_URL: z.url().default('http://localhost:5173'),
  IDENTITY_TRUSTED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:2567,http://127.0.0.1:2567,http://127.0.0.1:2568'),
}).parse(process.env);

if (process.env.NODE_ENV === 'production' && (!process.env.IDENTITY_SECRET || !process.env.IDENTITY_BASE_URL ||
  !process.env.IDENTITY_TRUSTED_ORIGINS || config.IDENTITY_SECRET === 'development-only-identity-secret-change-before-production')) {
  throw new Error('Production requires a private IDENTITY_SECRET, IDENTITY_BASE_URL and IDENTITY_TRUSTED_ORIGINS');
}
