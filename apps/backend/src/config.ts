import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { voiceConfigSchema, voiceCredentialsSchema } from '@virtual-workspace/shared';

export const config = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  DATABASE_PATH: z.string().default(fileURLToPath(new URL('../../../data/world.sqlite', import.meta.url))),
  MAP_REGISTRY_PATH: z.string().default(fileURLToPath(new URL('../../../assets/maps/registry.json', import.meta.url))),
  SPACE_MAX_CLIENTS: z.coerce.number().int().min(1).max(65535).default(32),
  FRONTEND_DIST_PATH: z.string().optional(),
  EXTERNAL_TOOLS: z.string().default('{}'),
  IDENTITY_SECRET: z.string().min(32).default('development-only-identity-secret-change-before-production'),
  IDENTITY_BASE_URL: z.url().default('http://localhost:5173'),
  IDENTITY_TRUSTED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:2567,http://127.0.0.1:2567,http://127.0.0.1:2568'),
  REGISTRATION_MODE: z.enum(['open', 'code', 'admin']).default('open'),
  REGISTRATION_CODE: z.string().optional(),
  VOICE_ICE_SERVERS: z.string().default('[{"urls":"stun:stun.l.google.com:19302"}]'),
  VOICE_TURN_URLS: z.string().optional(),
  VOICE_TURN_SHARED_SECRET: z.string().min(32).optional(),
  VOICE_TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  VOICE_CONNECT_RADIUS: z.coerce.number().positive().default(160),
  VOICE_DISCONNECT_RADIUS: z.coerce.number().positive().default(192),
  VOICE_MAX_PEERS: z.coerce.number().int().min(1).max(32).default(6),
  VOICE_SCAN_INTERVAL_MS: z.coerce.number().int().min(250).max(5000).default(1000),
}).parse(process.env);

const turnUrls = config.VOICE_TURN_URLS?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
if (Boolean(turnUrls.length) !== Boolean(config.VOICE_TURN_SHARED_SECRET)) {
  throw new Error('VOICE_TURN_URLS and VOICE_TURN_SHARED_SECRET must be configured together');
}
export const voiceTurnUrls = turnUrls;
voiceCredentialsSchema.parse({ iceServers: turnUrls.map(urls => ({ urls })), expiresAt: 0 });

if (config.REGISTRATION_MODE === 'code' && !config.REGISTRATION_CODE?.trim()) {
  throw new Error('REGISTRATION_CODE is required in code registration mode');
}

export const voiceConfig = voiceConfigSchema.parse({
  iceServers: JSON.parse(config.VOICE_ICE_SERVERS) as unknown,
  connectRadius: config.VOICE_CONNECT_RADIUS,
  disconnectRadius: config.VOICE_DISCONNECT_RADIUS,
  maxPeers: config.VOICE_MAX_PEERS,
  scanIntervalMs: config.VOICE_SCAN_INTERVAL_MS,
});

if (process.env.NODE_ENV === 'production' && (!process.env.IDENTITY_SECRET || !process.env.IDENTITY_BASE_URL ||
  !process.env.IDENTITY_TRUSTED_ORIGINS || config.IDENTITY_SECRET === 'development-only-identity-secret-change-before-production')) {
  throw new Error('Production requires a private IDENTITY_SECRET, IDENTITY_BASE_URL and IDENTITY_TRUSTED_ORIGINS');
}
