import { schema, t, type SchemaType } from '@colyseus/schema';
import { z } from 'zod';

export const ROOM_NAME = 'space';
export const AVATARS = ['mint', 'amber', 'violet'] as const;
export const avatarSchema = z.enum(AVATARS);
import { APPEARANCE_ASSETS } from './appearanceAssets.generated.js';
export { APPEARANCE_ASSETS, APPEARANCE_ASSET_PATHS } from './appearanceAssets.generated.js';
export const APPEARANCE_LAYERS = ['body', 'face', 'bottom', 'shoes', 'top', 'hair', 'accessories'] as const;
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit RGB hex color');
const part = <T extends readonly [string, ...string[]]>(assets: T, assetId: T[number], color: string) =>
  z.object({ assetId: z.enum(assets).default(assetId), color: colorSchema.default(color) }).strict();
export const appearanceSchema = z.object({
  body: part(APPEARANCE_ASSETS.body, 'walk', '#ffffff').default({ assetId: 'walk', color: '#ffffff' }),
  face: part(APPEARANCE_ASSETS.face, 'eyes', '#000000').default({ assetId: 'eyes', color: '#000000' }),
  hair: part(APPEARANCE_ASSETS.hair, 'hair1', '#704b3c').default({ assetId: 'hair1', color: '#704b3c' }),
  top: part(APPEARANCE_ASSETS.top, 't-shirt', '#64a9df').default({ assetId: 't-shirt', color: '#64a9df' }),
  bottom: part(APPEARANCE_ASSETS.bottom, 'pants', '#587eaa').default({ assetId: 'pants', color: '#587eaa' }),
  shoes: part(APPEARANCE_ASSETS.shoes, 'shoes', '#6a554e').default({ assetId: 'shoes', color: '#6a554e' }),
  accessories: part(APPEARANCE_ASSETS.accessories, 'none', '#ffffff').default({ assetId: 'none', color: '#ffffff' }),
}).strict();
export const DEFAULT_APPEARANCE = appearanceSchema.parse({});
export const joinSchema = z.object({
  name: z.string().trim().min(1).max(24),
  avatar: avatarSchema.default('mint'),
  appearance: appearanceSchema.default(DEFAULT_APPEARANCE),
});
export const inputSchema = z.object({
  x: z.number().int().min(-1).max(1),
  y: z.number().int().min(-1).max(1),
});
export const chatSchema = z.object({ text: z.string().trim().min(1).max(500) });
export type MovementInput = z.infer<typeof inputSchema>;
export type JoinOptions = z.infer<typeof joinSchema>;
/** `sessionId` is set by the server from the sending connection. */
export type ChatMessage = { id: string; sessionId: string; name: string; text: string; sentAt: number };

const resourceIdSchema = z.string().trim().min(1).max(128);
export const boardPostSchema = z.object({ resourceId: resourceIdSchema, text: chatSchema.shape.text });
export const boardDeleteSchema = z.object({ resourceId: resourceIdSchema, id: z.uuid() });
export const pomodoroModeSchema = z.enum(['focus', 'break']);
export const pomodoroActionSchema = z.discriminatedUnion('action', [
  z.object({ resourceId: resourceIdSchema, action: z.literal('start'), mode: pomodoroModeSchema }),
  z.object({ resourceId: resourceIdSchema, action: z.literal('pause') }),
  z.object({ resourceId: resourceIdSchema, action: z.literal('resume') }),
  z.object({ resourceId: resourceIdSchema, action: z.literal('reset'), mode: pomodoroModeSchema }),
]);
export type BoardPostInput = z.infer<typeof boardPostSchema>;
export type BoardDeleteInput = z.infer<typeof boardDeleteSchema>;
export type PomodoroActionInput = z.infer<typeof pomodoroActionSchema>;
export type InteractionResult = { ok: boolean; message: string };
export const BOARD_LIMIT = 100;
export const POMODORO_DURATIONS = { focus: 25 * 60_000, break: 5 * 60_000 } as const;
export const BoardNote = schema({
  resourceId: t.string(), authorSessionId: t.string(), authorUserId: t.string(), name: t.string(), text: t.string(), createdAt: t.number(),
}, 'BoardNote');
export type BoardNote = SchemaType<typeof BoardNote>;
export const Pomodoro = schema({
  mode: t.string().default('focus'), status: t.string().default('idle'),
  remainingMs: t.number().default(POMODORO_DURATIONS.focus), endsAt: t.number().default(0),
}, 'Pomodoro');
export type Pomodoro = SchemaType<typeof Pomodoro>;

export const Player = schema({
  name: t.string(), avatar: t.string(), appearance: t.string().default('{}'), x: t.number(), y: t.number(),
  userId: t.string(), role: t.string().default('member'),
  mapId: t.string(), connected: t.boolean().default(true), voiceEnabled: t.boolean().default(false), zoneId: t.string().default(''),
  facing: t.string().default('down'), motion: t.string().default('idle'),
  action: t.string().default('none'), actionAnimated: t.boolean().default(false), actionTargetId: t.string().default(''),
}, 'Player');
export type Player = SchemaType<typeof Player>;
// Authored object IDs are scoped by map. Visual variants contain no tile indices.
export const WorldObjectState = schema({
  variant: t.string().default(''), occupiedBy: t.string().default(''),
}, 'WorldObjectState');
export type WorldObjectState = SchemaType<typeof WorldObjectState>;
export const MapObjectState = schema({ objects: t.map(WorldObjectState) }, 'MapObjectState');
export type MapObjectState = SchemaType<typeof MapObjectState>;
export const SpaceState = schema({
  players: t.map(Player), notes: t.map(BoardNote), pomodoros: t.map(Pomodoro), serverTime: t.number(),
  worldObjects: t.map(MapObjectState),
}, 'SpaceState');
export type SpaceState = SchemaType<typeof SpaceState>;

export const webToolUrlSchema = z.url().refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'Tool URLs must use HTTP(S) without embedded credentials');
export const presentationModeSchema = z.enum(['embed', 'external']);
export type PresentationMode = z.infer<typeof presentationModeSchema>;
export const webToolConfigSchema = z.object({
  mode: presentationModeSchema.optional(),
  url: webToolUrlSchema,
  allowSameOrigin: z.boolean().optional(),
  manualExternalOpen: z.boolean().optional(),
  // Legacy alias for manualExternalOpen; this never detects iframe failure.
  fallback: z.literal('external').optional(),
}).strict();
export const webToolsConfigSchema = z.record(resourceIdSchema, webToolConfigSchema);
export const webToolSchema = webToolConfigSchema.safeExtend({ resourceId: resourceIdSchema });
export const webToolsSchema = z.array(webToolSchema);
export type WebTool = z.infer<typeof webToolSchema>;

export * from './world.js';
export * from './interactions.js';
export * from './character.js';
export * from './color.js';
export * from './voice.js';
export type { SpaceProtocol } from './protocol.js';
