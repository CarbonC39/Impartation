import { z } from 'zod';
import { InteractionRegistry } from './interactions.js';
import type { MovementInput } from './index.js';
import { facingSchema, type Facing } from './character.js';

export const TILE_SIZE = 16;
export const PLAYER_RADIUS = 10;
export const PLAYER_SPEED = 150;
export const TICK_MS = 50;
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type Zone = Rect & {
  id: string; kind: string; resourceId: string;
  properties: Record<string, unknown>;
};
export type Seat = Point & { id: string; kind: 'seat'; facing: Facing };
export type WorldMap = {
  width: number; height: number;
  spawns: Record<string, Point>;
  collisions: Rect[]; zones: Zone[];
  seats: Seat[];
};

// Only project semantic objects are constrained. Decorative objects stay opaque.
const objectSchema = z.object({
  name: z.string().default(''), x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative().default(0), height: z.number().finite().nonnegative().default(0),
  type: z.string().default(''), class: z.string().optional(), rotation: z.literal(0).default(0),
  point: z.boolean().optional(),
  properties: z.array(z.object({ name: z.string(), value: z.unknown() })).default([]),
}).passthrough().superRefine((obj, ctx) => {
  for (const key of ['ellipse', 'polygon', 'polyline', 'gid', 'template']) {
    if (obj[key] !== undefined && obj[key] !== false) ctx.addIssue({ code: 'custom', message: `Project semantic object requires a point or axis-aligned rectangle: ${key}` });
  }
});
const layerSchema = z.object({
  name: z.string().default(''), type: z.string(),
  offsetx: z.number().finite().default(0), offsety: z.number().finite().default(0),
  x: z.number().finite().default(0), y: z.number().finite().default(0),
  layers: z.array(z.unknown()).optional(), objects: z.array(z.unknown()).optional(),
}).passthrough();
const tiledSemanticsSchema = z.object({
  orientation: z.literal('orthogonal'), infinite: z.literal(false),
  width: z.number().int().positive(), height: z.number().int().positive(),
  tilewidth: z.literal(TILE_SIZE), tileheight: z.literal(TILE_SIZE),
  layers: z.array(z.unknown()),
}).passthrough();
const identifier = z.string().trim().min(1).max(128);
export type InteractionDefinition = { validate(zone: Zone): void };
export const interactionDefinitions = new InteractionRegistry<InteractionDefinition>();
for (const kind of ['board', 'pomodoro', 'web']) {
  interactionDefinitions.register(kind, { validate: zone => { identifier.parse(zone.resourceId); } });
}
export const portalPropertiesSchema = z.object({ targetMap: identifier, targetSpawn: identifier });
interactionDefinitions.register('Portal', { validate: zone => { portalPropertiesSchema.parse(zone.properties); } });

/** Extract authoritative semantics without imposing renderer-specific Tiled restrictions. */
export function parseWorldMap(raw: unknown, definitions = interactionDefinitions): WorldMap {
  const map = tiledSemanticsSchema.parse(raw);
  const semanticLayers = new Map<string, { objects: unknown[]; x: number; y: number }>();
  const visit = (rawLayers: unknown[], parent: Point) => {
    for (const rawLayer of rawLayers) {
      const layer = layerSchema.parse(rawLayer);
      const position = { x: parent.x + layer.offsetx + layer.x * (layer.type === 'tilelayer' ? TILE_SIZE : 1),
        y: parent.y + layer.offsety + layer.y * (layer.type === 'tilelayer' ? TILE_SIZE : 1) };
      if (layer.type === 'group') visit(layer.layers ?? [], position);
      if (['spawns', 'collisions', 'interactions'].includes(layer.name)) {
        if (layer.type !== 'objectgroup' || semanticLayers.has(layer.name)) throw new Error(`Expected one semantic object layer: ${layer.name}`);
        semanticLayers.set(layer.name, { objects: layer.objects ?? [], ...position });
      }
    }
  };
  visit(map.layers, { x: 0, y: 0 });
  const objects = (name: string) => {
    const layer = semanticLayers.get(name);
    if (!layer) throw new Error(`Missing Tiled object layer: ${name}`);
    return layer.objects.map(rawObject => {
      const obj = objectSchema.parse(rawObject);
      return { ...obj, x: obj.x + layer.x, y: obj.y + layer.y };
    });
  };
  const spawns: Record<string, Point> = Object.create(null) as Record<string, Point>;
  for (const obj of objects('spawns')) {
    const name = identifier.parse(obj.name);
    if (!obj.point || obj.width || obj.height || Object.hasOwn(spawns, name)) throw new Error('Spawns must be uniquely named points');
    spawns[name] = { x: obj.x, y: obj.y };
  }
  if (!Object.keys(spawns).length) throw new Error('At least one named spawn is required');
  const collisions = objects('collisions').map(obj => {
    if (obj.point) throw new Error('Collision must be a rectangle');
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  });
  const ids = new Set<string>();
  const zones: Zone[] = [];
  const seats: Seat[] = [];
  for (const obj of objects('interactions')) {
    const id = identifier.parse(obj.name);
    const kind = identifier.parse(obj.class || obj.type);
    if (ids.has(id)) throw new Error('Interactions must have unique authored IDs');
    ids.add(id);
    const properties = Object.fromEntries(obj.properties.map(prop => [prop.name, prop.value]));
    if (kind === 'seat') {
      if (!obj.point || obj.width || obj.height) throw new Error('Seats must be named points');
      seats.push({ id, kind, x: obj.x, y: obj.y, facing: facingSchema.parse(properties.facing) });
      continue;
    }
    if (obj.point) throw new Error('Zone interactions must be rectangles');
    const zone: Zone = { id, kind, resourceId: typeof properties.resourceId === 'string' ? properties.resourceId.trim() : '',
      properties, x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    definitions.get(kind)?.validate(zone);
    zones.push(zone);
  }
  const world: WorldMap = { width: map.width * TILE_SIZE, height: map.height * TILE_SIZE, spawns, collisions, zones, seats };
  for (const obj of [...collisions, ...zones]) {
    if (obj.width <= 0 || obj.height <= 0 || obj.x < 0 || obj.y < 0 ||
      obj.x + obj.width > world.width || obj.y + obj.height > world.height) throw new Error('Semantic rectangle must have positive size and stay inside map bounds');
  }
  for (const spawn of Object.values(spawns)) if (!canStand(world, spawn.x, spawn.y)) throw new Error('Spawn is outside walkable area');
  const seatTiles = new Set<string>();
  for (const seat of seats) {
    if (!canStand(world, seat.x, seat.y)) throw new Error('Seat anchor is outside walkable area');
    const tile = `${Math.floor(seat.x / TILE_SIZE)},${Math.floor(seat.y / TILE_SIZE)}`;
    if (seatTiles.has(tile)) throw new Error('Only one seat anchor per grid tile is supported');
    seatTiles.add(tile);
  }
  return world;
}

export const mapRegistrySchema = z.object({
  initialMap: identifier,
  maps: z.array(z.object({ id: identifier, file: z.string().min(1), defaultSpawn: identifier })).min(1),
});
export type MapRegistryConfig = z.infer<typeof mapRegistrySchema>;
export type RegisteredMap = { id: string; url: string; defaultSpawn: string; world: WorldMap };
export type WorldRegistry = { initialMap: string; maps: RegisteredMap[] };

export function validateMapRegistry(registry: WorldRegistry): WorldRegistry {
  const maps = new Map(registry.maps.map(map => [map.id, map]));
  if (maps.size !== registry.maps.length || !maps.has(registry.initialMap)) throw new Error('Map IDs must be unique and initialMap must exist');
  for (const map of maps.values()) {
    if (!Object.hasOwn(map.world.spawns, map.defaultSpawn)) throw new Error(`Unknown default spawn in ${map.id}: ${map.defaultSpawn}`);
    for (const zone of map.world.zones) if (zone.kind === 'Portal') {
      const target = portalPropertiesSchema.parse(zone.properties);
      const destination = maps.get(target.targetMap);
      if (!destination || !Object.hasOwn(destination.world.spawns, target.targetSpawn)) throw new Error(`Invalid Portal destination: ${map.id}/${zone.id}`);
    }
  }
  return registry;
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
/** Positional activation uses the foot's grid tile, never a surrounding radius. */
export function standsOnSeat(seat: Seat, position: Point): boolean {
  return Math.floor(seat.x / TILE_SIZE) === Math.floor(position.x / TILE_SIZE) &&
    Math.floor(seat.y / TILE_SIZE) === Math.floor(position.y / TILE_SIZE);
}
export function canStand(map: WorldMap, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return x >= r && y >= r && x <= map.width - r && y <= map.height - r &&
    !map.collisions.some(rect => x + r > rect.x && x - r < rect.x + rect.width &&
      y + r > rect.y && y - r < rect.y + rect.height);
}
export function stepMovement(map: WorldMap, position: Point, input: MovementInput, deltaMs: number): Point {
  const length = Math.hypot(input.x, input.y) || 1;
  const distance = PLAYER_SPEED * Math.min(Math.max(deltaMs, 0), TICK_MS) / 1000;
  const next = { x: position.x, y: position.y };
  const x = next.x + input.x / length * distance;
  if (canStand(map, x, next.y)) next.x = x;
  const y = next.y + input.y / length * distance;
  if (canStand(map, next.x, y)) next.y = y;
  return next;
}

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const rectSchema = pointSchema.extend({ width: z.number().positive(), height: z.number().positive() });
export const worldRegistryResponseSchema = z.object({
  initialMap: identifier,
  maps: z.array(z.object({
    id: identifier, url: z.string().min(1), defaultSpawn: identifier,
    world: z.object({
      width: z.number().positive(), height: z.number().positive(), spawns: z.record(identifier, pointSchema),
      collisions: z.array(rectSchema),
      zones: z.array(rectSchema.extend({ id: identifier, kind: identifier, resourceId: z.string(), properties: z.record(z.string(), z.unknown()) })),
      seats: z.array(pointSchema.extend({ id: identifier, kind: z.literal('seat'), facing: facingSchema })),
    }),
  })).min(1),
});
