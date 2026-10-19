import { z } from 'zod';
import { InteractionRegistry } from './interactions.js';
import type { MovementInput } from './index.js';
import { actionNameSchema, characterActionSchema, facingSchema, isCharacterAction, type Facing } from './character.js';

export const TILE_SIZE = 16;
// Ground footprint ends at the foot anchor; sprite dimensions never affect physics.
export const PLAYER_FOOTPRINT = { width: 12, height: 8 } as const;
export const PLAYER_SPEED = 150;
export const TICK_MS = 50;
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type Zone = Rect & {
  id: string; kind: string; resourceId: string;
  properties: Record<string, unknown>;
};
export type ActionObject = Point & {
  id: string; kind: 'action'; action: string; facing?: Facing;
  offsetX: number; offsetY: number; linkedObjectId?: string;
};
export const variantNameSchema = z.string().trim().min(1).max(32).regex(/^[a-z][a-z0-9_-]*$/);
const tiledIdSchema = z.number().int().positive();
export const variantSelectorPropertiesSchema = z.object({
  action: characterActionSchema, facing: facingSchema.optional(),
  offsetX: z.number().finite().default(0), offsetY: z.number().finite().default(0),
  targetObjectId: tiledIdSchema,
  variants: z.string().transform(value => value.split(',').map(part => part.trim()))
    .pipe(z.array(variantNameSchema).min(1).max(16).refine(values => new Set(values).size === values.length, 'Variants must be unique')),
});
export type VariantSelector = Point & {
  id: string; kind: 'variantSelector'; name: string; action: string; facing?: Facing;
  offsetX: number; offsetY: number; targetObjectId: string; variants: string[];
};
export type VariantTarget = Rect & { id: string; gid: number; variants: Record<string, number> };
export type ActionAnchor = ActionObject | VariantSelector;
export type WorldMap = {
  width: number; height: number;
  spawns: Record<string, Point>;
  collisions: Rect[]; zones: Zone[];
  actions: ActionObject[]; selectors: VariantSelector[]; variantTargets: VariantTarget[];
};

// Only project semantic objects are constrained. Decorative objects stay opaque.
const objectSchema = z.object({
  id: z.number().int().positive().optional(), name: z.string().default(''), x: z.number().finite(), y: z.number().finite(),
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
const actionPropertiesSchema = z.object({
  action: actionNameSchema, facing: facingSchema.optional(),
  offsetX: z.number().finite().default(0), offsetY: z.number().finite().default(0),
  linkedObjectId: identifier.optional(),
});
export type InteractionDefinition = { validate(zone: Zone): void };
export const interactionDefinitions = new InteractionRegistry<InteractionDefinition>();
for (const kind of ['board', 'pomodoro', 'web']) {
  interactionDefinitions.register(kind, { validate: zone => { identifier.parse(zone.resourceId); } });
}
export const portalPropertiesSchema = z.object({ targetMap: identifier, targetSpawn: identifier });
interactionDefinitions.register('wardrobe', { validate: zone => { z.object({}).parse(zone.properties); } });
interactionDefinitions.register('privateArea', { validate: zone => { z.object({}).parse(zone.properties); } });
interactionDefinitions.register('Portal', { validate: zone => { portalPropertiesSchema.parse(zone.properties); } });

/** Extract authoritative semantics without imposing renderer-specific Tiled restrictions. */
export function parseWorldMap(raw: unknown, definitions = interactionDefinitions): WorldMap {
  const map = tiledSemanticsSchema.parse(raw);
  const authoredObjects = new Map<number, Record<string, unknown>>();
  const duplicateObjectIds = new Set<number>();
  const semanticLayers = new Map<string, { objects: unknown[]; x: number; y: number }>();
  const visit = (rawLayers: unknown[], parent: Point) => {
    for (const rawLayer of rawLayers) {
      const layer = layerSchema.parse(rawLayer);
      const position = { x: parent.x + layer.offsetx + layer.x * (layer.type === 'tilelayer' ? TILE_SIZE : 1),
        y: parent.y + layer.offsety + layer.y * (layer.type === 'tilelayer' ? TILE_SIZE : 1) };
      if (layer.type === 'objectgroup') for (const value of layer.objects ?? []) {
        const parsedObject = z.record(z.string(), z.unknown()).safeParse(value);
        if (!parsedObject.success) continue;
        const object = parsedObject.data;
        if (typeof object.id === 'number') {
          if (authoredObjects.has(object.id)) duplicateObjectIds.add(object.id);
          authoredObjects.set(object.id, { ...object, x: Number(object.x) + position.x, y: Number(object.y) + position.y });
        }
      }
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
  const actions: ActionObject[] = [];
  const selectors: VariantSelector[] = [];
  const variantTargets: VariantTarget[] = [];
  for (const obj of objects('interactions')) {
    let id = identifier.parse(obj.name);
    const kind = identifier.parse(obj.class || obj.type);
    if (['variantSelector', 'privateArea', 'wardrobe'].includes(kind)) {
      id = String(tiledIdSchema.parse(obj.id));
      if (duplicateObjectIds.has(Number(id))) throw new Error('Duplicate Tiled object ID');
    }
    if (ids.has(id)) throw new Error('Interactions must have unique authored IDs');
    ids.add(id);
    const properties = Object.fromEntries(obj.properties.map(prop => [prop.name, prop.value]));
    if (new Set(obj.properties.map(prop => prop.name)).size !== obj.properties.length) throw new Error('Duplicate semantic property');
    if (kind === 'variantSelector') {
      if (!obj.point || obj.width || obj.height) throw new Error('Variant selectors must be points');
      const config = variantSelectorPropertiesSchema.parse(properties);
      selectors.push({ id, kind, name: obj.name, x: obj.x, y: obj.y, ...config, targetObjectId: String(config.targetObjectId) });
      continue;
    }
    if (kind === 'action') {
      if (!obj.point || obj.width || obj.height) throw new Error('Action anchors must be named points');
      const actionProperties = actionPropertiesSchema.parse(properties);
      actions.push({ id, kind: 'action', x: obj.x, y: obj.y, ...actionProperties });
      continue;
    }
    if (obj.point) throw new Error('Zone interactions must be rectangles');
    const zone: Zone = { id, kind, resourceId: typeof properties.resourceId === 'string' ? properties.resourceId.trim() : '',
      properties, x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    definitions.get(kind)?.validate(zone);
    zones.push(zone);
  }
  const gidSchema = z.number().int().nonnegative().max(0x0fffffff);
  // One selector owns one target: independent seats need independent target objects.
  if (new Set(selectors.map(selector => selector.targetObjectId)).size !== selectors.length) throw new Error('Variant targets must have one selector');
  for (const selector of selectors) {
    const rawTarget = authoredObjects.get(Number(selector.targetObjectId));
    if (duplicateObjectIds.has(Number(selector.targetObjectId))) throw new Error('Duplicate variant target Tiled ID');
    if (ids.has(selector.targetObjectId)) throw new Error('Variant target ID conflicts with an interaction ID');
    const target = z.object({ id: tiledIdSchema, x: z.number().finite(), y: z.number().finite(),
      width: z.number().positive(), height: z.number().positive(), gid: gidSchema.optional(),
      rotation: z.literal(0).default(0), properties: z.array(z.object({ name: z.string(), value: z.unknown() })).default([]),
    }).passthrough().parse(rawTarget);
    for (const shape of ['point', 'ellipse', 'polygon', 'polyline', 'template']) {
      if (target[shape] !== undefined && target[shape] !== false) throw new Error('Variant targets must be upright rectangles or tile objects');
    }
    const properties = Object.fromEntries(target.properties.map(prop => [prop.name, prop.value]));
    if (new Set(target.properties.map(prop => prop.name)).size !== target.properties.length) throw new Error('Duplicate target property');
    const tilesets = z.array(z.object({ name: z.string().optional(), firstgid: tiledIdSchema,
      tilecount: z.number().int().positive().optional() }).passthrough()).parse(map.tilesets ?? []);
    const name = properties.variantTileset === undefined ? undefined : identifier.parse(properties.variantTileset);
    const matches = name === undefined ? tilesets : tilesets.filter(tileset => tileset.name === name);
    const variantTileset = matches.length === 1 ? matches[0] : undefined;
    if (!variantTileset?.tilecount) throw new Error('Variant targets require one resolved tileset; specify variantTileset by name for multiple tilesets');
    const variants: Record<string, number> = {};
    for (const name of selector.variants) {
      const tileId = z.number().int().min(-1).max(variantTileset.tilecount - 1).parse(properties[`variant.${name}`]);
      variants[name] = gidSchema.parse(tileId === -1 ? 0 : variantTileset.firstgid + tileId);
    }
    variantTargets.push({ id: String(target.id), x: target.x, y: target.gid === undefined ? target.y : target.y - target.height,
      width: target.width, height: target.height, gid: target.gid ?? 0, variants });
  }
  const privateAreas = zones.filter(zone => zone.kind === 'privateArea');
  for (const [index, area] of privateAreas.entries()) for (const other of privateAreas.slice(index + 1)) {
    if (area.x < other.x + other.width && area.x + area.width > other.x && area.y < other.y + other.height && area.y + area.height > other.y)
      throw new Error('Private areas must not overlap');
  }
  const world: WorldMap = { width: map.width * TILE_SIZE, height: map.height * TILE_SIZE, spawns, collisions, zones, actions, selectors, variantTargets };
  for (const obj of [...collisions, ...zones, ...variantTargets]) {
    if (obj.width <= 0 || obj.height <= 0 || obj.x < 0 || obj.y < 0 ||
      obj.x + obj.width > world.width || obj.y + obj.height > world.height) throw new Error('Semantic rectangle must have positive size and stay inside map bounds');
  }
  for (const spawn of Object.values(spawns)) if (!canStand(world, spawn.x, spawn.y)) throw new Error('Spawn is outside walkable area');
  const actionTiles = new Set<string>();
  for (const object of [...actions, ...selectors]) {
    if (!canStand(world, object.x, object.y) || !canStand(world, object.x + object.offsetX, object.y + object.offsetY)) {
      throw new Error('Action anchor and its offset must stay inside walkable area');
    }
    const tile = `${object.action}:${Math.floor(object.x / TILE_SIZE)},${Math.floor(object.y / TILE_SIZE)}`;
    if (actionTiles.has(tile)) throw new Error('Only one anchor per action and grid tile is supported');
    actionTiles.add(tile);
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
/** Activation requires positive-area overlap of the ground footprint and the anchor's tile. */
export function standsOnAction(object: ActionAnchor, position: Point): boolean {
  const x = Math.floor(object.x / TILE_SIZE) * TILE_SIZE;
  const y = Math.floor(object.y / TILE_SIZE) * TILE_SIZE;
  return position.x + PLAYER_FOOTPRINT.width / 2 > x && position.x - PLAYER_FOOTPRINT.width / 2 < x + TILE_SIZE &&
    position.y > y && position.y - PLAYER_FOOTPRINT.height < y + TILE_SIZE;
}
/** Resolve the nearest overlapping anchor before checking facing or occupancy; ties use stable IDs. */
export function findActionAnchor(map: WorldMap, position: Point & { actionTargetId?: string; action?: string }, action?: string): ActionAnchor | undefined {
  let nearest: ActionAnchor | undefined;
  let distance = Infinity;
  const anchors = actionAnchors(map);
  // Animation changes retain the current action after its authored offset moved the feet outside the tile.
  const active = anchors.find(anchor => anchor.id === position.actionTargetId && anchor.action === position.action &&
    (action === undefined ? isCharacterAction(anchor.action) : anchor.action === action) &&
    position.x === anchor.x + anchor.offsetX && position.y === anchor.y + anchor.offsetY);
  if (active) return active;
  for (const anchor of anchors) {
    if ((action === undefined ? !isCharacterAction(anchor.action) : anchor.action !== action) || !standsOnAction(anchor, position)) continue;
    const next = (anchor.x - position.x) ** 2 + (anchor.y - position.y) ** 2;
    if (next < distance || (next === distance && nearest && anchor.id < nearest.id)) { nearest = anchor; distance = next; }
  }
  return nearest;
}
export function actionFacingMatches(anchor: ActionAnchor, facing: string): boolean {
  return anchor.facing === undefined || anchor.facing === facing;
}
/** A short alignment must obey the same walls and admission checks along its entire segment. */
export function canAlignAction(map: WorldMap, from: Point, to: Point, permitted: (position: Point) => boolean = () => true): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (Math.min(PLAYER_FOOTPRINT.width, PLAYER_FOOTPRINT.height) / 2)));
  for (let step = 1; step <= steps; step++) {
    const position = { x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps };
    if (!canStand(map, position.x, position.y) || !permitted(position)) return false;
  }
  return true;
}
export function canStand(map: WorldMap, x: number, y: number): boolean {
  const halfWidth = PLAYER_FOOTPRINT.width / 2;
  const top = y - PLAYER_FOOTPRINT.height;
  return x >= halfWidth && top >= 0 && x <= map.width - halfWidth && y <= map.height &&
    !map.collisions.some(rect => x + halfWidth > rect.x && x - halfWidth < rect.x + rect.width &&
      y > rect.y && top < rect.y + rect.height);
}
export function stepMovement(map: WorldMap, position: Point, input: MovementInput, deltaMs: number, permitted: (position: Point) => boolean = () => true): Point {
  const length = Math.hypot(input.x, input.y) || 1;
  const distance = PLAYER_SPEED * Math.min(Math.max(deltaMs, 0), TICK_MS) / 1000;
  const next = { x: position.x, y: position.y };
  const x = next.x + input.x / length * distance;
  if (canStand(map, x, next.y) && permitted({ x, y: next.y })) next.x = x;
  const y = next.y + input.y / length * distance;
  if (canStand(map, next.x, y) && permitted({ x: next.x, y })) next.y = y;
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
      selectors: z.array(pointSchema.extend({ id: identifier, kind: z.literal('variantSelector'), name: identifier,
        action: characterActionSchema, facing: facingSchema.optional(), offsetX: z.number().finite(), offsetY: z.number().finite(),
        targetObjectId: identifier, variants: z.array(variantNameSchema).min(1), })),
      variantTargets: z.array(rectSchema.extend({ id: identifier, gid: z.number().int().nonnegative().max(0x0fffffff), variants: z.record(variantNameSchema, z.number().int().nonnegative().max(0x0fffffff)) })),
      actions: z.array(pointSchema.extend({ id: identifier, kind: z.literal('action'),
        ...actionPropertiesSchema.shape })),
    }),
  })).min(1),
});

/** Interaction precedence is explicit; private context is computed independently. */
export function currentZone(map: WorldMap, position: Point): Zone | undefined {
  return map.zones.find(zone => zone.kind !== 'privateArea' && contains(zone, position.x, position.y)) ??
    map.zones.find(zone => zone.kind === 'privateArea' && contains(zone, position.x, position.y));
}
export function actionAnchors(map: WorldMap): ActionAnchor[] { return [...map.actions, ...map.selectors]; }
