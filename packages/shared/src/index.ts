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
  connected: t.boolean().default(true), zoneId: t.string().default(''),
}, 'Player');
export type Player = SchemaType<typeof Player>;
export const SpaceState = schema({
  players: t.map(Player), notes: t.map(BoardNote), pomodoros: t.map(Pomodoro), serverTime: t.number(),
}, 'SpaceState');
export type SpaceState = SchemaType<typeof SpaceState>;

export const PLAYER_RADIUS = 10;
export const PLAYER_SPEED = 150;
export const TICK_MS = 50;

const rectangle = z.object({
  id: z.number().int().positive(), name: z.string().default(''),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().nonnegative().default(0), height: z.number().nonnegative().default(0),
  type: z.string().default(''), class: z.string().optional(),
  rotation: z.literal(0).default(0), point: z.boolean().optional(),
  properties: z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) })).default([]),
}).passthrough().superRefine((obj, ctx) => {
  for (const key of ['ellipse', 'polygon', 'polyline', 'gid', 'template']) {
    if (obj[key] !== undefined) ctx.addIssue({ code: 'custom', message: `Unsupported Tiled object: ${key}` });
  }
});
const tiledSchema = z.object({
  orientation: z.literal('orthogonal'), infinite: z.literal(false),
  width: z.number().int().positive(), height: z.number().int().positive(),
  tilewidth: z.number().int().positive(), tileheight: z.number().int().positive(),
  tilesets: z.array(z.object({
    name: z.string().min(1), image: z.string().min(1), source: z.never().optional(),
    firstgid: z.number().int().positive(), tilecount: z.number().int().positive(),
    columns: z.number().int().positive(),
    tilewidth: z.number().int().positive(), tileheight: z.number().int().positive(),
  })).length(1),
  layers: z.array(z.object({
    name: z.string(), type: z.enum(['tilelayer', 'objectgroup']),
    offsetx: z.literal(0).default(0), offsety: z.literal(0).default(0),
    x: z.literal(0).default(0), y: z.literal(0).default(0),
    objects: z.array(rectangle).optional(),
  }).passthrough()),
});
const groundSchema = z.object({
  type: z.literal('tilelayer'), width: z.number().int().positive(), height: z.number().int().positive(),
  data: z.array(z.number().int().min(0).max(0xffffffff)),
});
export type Rect = { x: number; y: number; width: number; height: number };
export const externalToolKindSchema = z.enum(['media', 'whiteboard', 'drawing', 'document']);
export const externalToolUrlSchema = z.url().refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'Tool URLs must use HTTP(S) without embedded credentials');
export const externalToolConfigSchema = z.object({ kind: externalToolKindSchema, url: externalToolUrlSchema }).strict();
export const externalToolsConfigSchema = z.record(resourceIdSchema, externalToolConfigSchema);
export const externalToolSchema = externalToolConfigSchema.extend({ resourceId: resourceIdSchema });
export const externalToolsSchema = z.array(externalToolSchema);
export type ExternalTool = z.infer<typeof externalToolSchema>;
export const zoneKindSchema = z.enum(['media', 'whiteboard', 'drawing', 'document', 'board', 'pomodoro']);
export type Zone = Rect & { id: string; kind: z.infer<typeof zoneKindSchema>; resourceId: string };
export type WorldMap = {
  width: number; height: number; spawn: { x: number; y: number };
  tileset: { name: string; image: string };
  collisions: Rect[]; zones: Zone[];
};

/** One explicit map contract, rejecting unsupported geometry at startup. */
export function parseWorldMap(raw: unknown): WorldMap {
  const map = tiledSchema.parse(raw);
  const layers = new Map(map.layers.map(layer => [layer.name, layer]));
  if (layers.size !== map.layers.length) throw new Error('Tiled layer names must be unique');
  const ground = groundSchema.parse(layers.get('ground'));
  const tileset = map.tilesets[0];
  if (ground.width !== map.width || ground.height !== map.height || ground.data.length !== map.width * map.height) {
    throw new Error('Ground dimensions must match the map');
  }
  if (ground.data.some(gid => {
    const tile = gid & 0x0fffffff;
    return tile !== 0 && (tile < tileset.firstgid || tile >= tileset.firstgid + tileset.tilecount);
  })) throw new Error('Ground contains a tile outside its tileset');
  for (const name of ['spawns', 'collisions', 'interactions']) {
    if (layers.get(name)?.type !== 'objectgroup') throw new Error(`Missing Tiled object layer: ${name}`);
  }
  const spawn = layers.get('spawns')!.objects?.find(obj => obj.name === 'default' && obj.point);
  if (!spawn) throw new Error('Missing default point spawn');
  const collisions = layers.get('collisions')!.objects ?? [];
  const ids = new Set<string>();
  const zones = (layers.get('interactions')!.objects ?? []).map(obj => {
    const kind = zoneKindSchema.parse(obj.class || obj.type);
    const resourceId = z.string().min(1).parse(obj.properties.find(prop => prop.name === 'resourceId')?.value);
    const id = obj.name;
    if (!id || ids.has(id)) throw new Error('Interaction names must be nonempty and unique');
    ids.add(id);
    return { id, kind, resourceId, x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  });
  const world = { width: map.width * map.tilewidth, height: map.height * map.tileheight,
    spawn: { x: spawn.x, y: spawn.y }, tileset: { name: tileset.name, image: tileset.image }, collisions, zones };
  for (const obj of [...collisions, ...zones]) {
    if (obj.width <= 0 || obj.height <= 0 || obj.x < 0 || obj.y < 0 ||
      obj.x + obj.width > world.width || obj.y + obj.height > world.height) {
      throw new Error('Rectangle must have positive size and stay inside map bounds');
    }
  }
  if (!canStand(world, spawn.x, spawn.y)) throw new Error('Spawn is outside walkable area');
  return world;
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
export function canStand(map: WorldMap, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return x >= r && y >= r && x <= map.width - r && y <= map.height - r &&
    !map.collisions.some(rect => x + r > rect.x && x - r < rect.x + rect.width &&
      y + r > rect.y && y - r < rect.y + rect.height);
}
export function stepMovement(map: WorldMap, position: { x: number; y: number }, input: MovementInput, deltaMs: number) {
  const length = Math.hypot(input.x, input.y) || 1;
  const distance = PLAYER_SPEED * Math.min(Math.max(deltaMs, 0), TICK_MS) / 1000;
  const next = { x: position.x, y: position.y };
  const x = next.x + input.x / length * distance;
  if (canStand(map, x, next.y)) next.x = x;
  const y = next.y + input.y / length * distance;
  if (canStand(map, next.x, y)) next.y = y;
  return next;
}
