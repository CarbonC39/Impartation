import { schema, t, type SchemaType } from '@colyseus/schema';
import { z } from 'zod';

export const ROOM_NAME = 'space';
export const AVATARS = ['mint', 'amber', 'violet'] as const;
export const avatarSchema = z.enum(AVATARS);
export const joinSchema = z.object({
  name: z.string().trim().min(1).max(24),
  avatar: avatarSchema.default('mint'),
});
export const inputSchema = z.object({
  x: z.number().int().min(-1).max(1),
  y: z.number().int().min(-1).max(1),
});
export const chatSchema = z.object({ text: z.string().trim().min(1).max(500) });
export type MovementInput = z.infer<typeof inputSchema>;
export type JoinOptions = z.infer<typeof joinSchema>;
export type ChatMessage = { id: string; name: string; text: string; sentAt: number };

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
export type FeatureResult = { ok: boolean; message: string };
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
  name: t.string(), avatar: t.string(), x: t.number(), y: t.number(),
  userId: t.string(), role: t.string().default('member'),
  mapId: t.string(), connected: t.boolean().default(true), zoneId: t.string().default(''),
}, 'Player');
export type Player = SchemaType<typeof Player>;
export const SpaceState = schema({
  players: t.map(Player), notes: t.map(BoardNote), pomodoros: t.map(Pomodoro), serverTime: t.number(),
}, 'SpaceState');
export type SpaceState = SchemaType<typeof SpaceState>;

export const externalToolKindSchema = z.enum(['media', 'whiteboard', 'drawing', 'document']);
export const externalToolUrlSchema = z.url().refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'Tool URLs must use HTTP(S) without embedded credentials');
export const presentationModeSchema = z.enum(['native', 'embed', 'external']);
export type PresentationMode = z.infer<typeof presentationModeSchema>;
export const externalToolConfigSchema = z.object({
  kind: externalToolKindSchema,
  mode: presentationModeSchema.optional(),
  url: externalToolUrlSchema.optional(),
  fallback: z.literal('external').optional(),
}).strict().superRefine((entry, ctx) => {
  const mode = entry.mode ?? 'external';
  if ((mode === 'external' || mode === 'embed' || entry.fallback === 'external') && !entry.url) {
    ctx.addIssue({ code: 'custom', message: 'This presentation requires a URL', path: ['url'] });
  }
});
export const externalToolsConfigSchema = z.record(resourceIdSchema, externalToolConfigSchema);
export const externalToolSchema = externalToolConfigSchema.safeExtend({ resourceId: resourceIdSchema });
export const externalToolsSchema = z.array(externalToolSchema);
export type ExternalTool = z.infer<typeof externalToolSchema>;

export * from './world.js';
export * from './interactions.js';
export type { SpaceProtocol } from './protocol.js';
