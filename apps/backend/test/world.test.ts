import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { parseWorldMap, stepMovement, canStand, contains, PLAYER_FOOTPRINT, PLAYER_SPEED, TICK_MS,
  InteractionRegistry, validateMapRegistry, type InteractionDefinition } from '@virtual-workspace/shared';
import { standsOnSeat, movementFacing } from '@virtual-workspace/shared';

const raw: unknown = JSON.parse(readFileSync(new URL('../../../assets/maps/lobby.tmj', import.meta.url), 'utf8'));
const world = parseWorldMap(raw);
const spawn = world.spawns.default;
const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const array = (value: unknown) => z.array(z.unknown()).parse(value);
function mutate(change: (map: Record<string, unknown>, layers: Record<string, unknown>[]) => void) {
  const map = record(structuredClone(raw));
  const layers = array(map.layers).map(record);
  map.layers = layers;
  change(map, layers);
  return map;
}
const objects = (layer: Record<string, unknown>) => array(layer.objects).map(record);

// Keep pixel geometry stable during the 32px -> 16px authoring migration.
test('Tiled source supplies named spawn, collision geometry and interaction resources at 16px', () => {
  assert.deepEqual(spawn, { x: 352, y: 384 });
  assert.deepEqual([world.width, world.height], [768, 512]);
  assert.equal(world.collisions.length, 1);
  assert.deepEqual(world.zones.map(zone => zone.kind), ['web', 'web', 'board', 'pomodoro', 'web', 'web']);
  assert.equal(world.zones[0].resourceId, 'lounge-screen');
  assert.equal(contains(world.zones[0], 64, 64), true);
  assert.equal(contains(world.zones[0], 224, 64), false);
});

test('movement normalizes diagonals, clamps ticks, slides along walls and blocks edges', () => {
  const diagonal = stepMovement(world, spawn, { x: 1, y: 1 }, 5000);
  assert.ok(Math.abs(Math.hypot(diagonal.x - spawn.x, diagonal.y - spawn.y) - PLAYER_SPEED * TICK_MS / 1000) < 0.0001);
  const slide = stepMovement(world, { x: 310, y: 250 }, { x: 1, y: 1 }, TICK_MS);
  assert.equal(slide.x, 310); assert.ok(slide.y > 250);
  assert.deepEqual(PLAYER_FOOTPRINT, { width: 12, height: 8 });
  assert.ok(PLAYER_SPEED * TICK_MS / 1000 < Math.min(PLAYER_FOOTPRINT.width, PLAYER_FOOTPRINT.height));
  assert.deepEqual(stepMovement(world, spawn, { x: 0, y: 0 }, 50), spawn);
  assert.deepEqual(stepMovement(world, spawn, { x: 1, y: 1 }, -50), spawn);
});

test('ground footprint permits edge contact, blocks wall entry and respects map bounds', () => {
  const map = { ...world, width: 64, height: 64,
    collisions: [{ x: 16, y: 16, width: 16, height: 16 }] };
  // The footprint is [x-6, x+6] by [y-8, y]; touching the top or bottom is allowed.
  assert.equal(canStand(map, 24, 16), true);
  assert.equal(canStand(map, 24, 16.01), false);
  assert.equal(canStand(map, 24, 40), true);
  assert.equal(canStand(map, 24, 39.99), false);
  assert.equal(canStand(map, 10, 24), true);
  assert.equal(canStand(map, 10.01, 24), false);
  assert.equal(canStand(map, 38, 24), true);
  assert.equal(canStand(map, 37.99, 24), false);
  assert.equal(canStand(map, 6, 32), true);
  assert.equal(canStand(map, 5.99, 32), false);
  assert.equal(canStand(map, 58, 32), true);
  assert.equal(canStand(map, 58.01, 32), false);
  assert.equal(canStand({ ...map, collisions: [] }, 32, 8), true);
  assert.equal(canStand({ ...map, collisions: [] }, 32, 7.99), false);
  assert.equal(canStand({ ...map, collisions: [] }, 32, 64), true);
  assert.equal(canStand({ ...map, collisions: [] }, 32, 64.01), false);
});

test('movement cannot cross a thin wall and fits through a 16px clear passage', () => {
  const thinWall = { ...world, width: 128, height: 64,
    collisions: [{ x: 48, y: 0, width: 1, height: 64 }] };
  let position = { x: 35, y: 32 };
  for (let i = 0; i < 8; i += 1) position = stepMovement(thinWall, position, { x: 1, y: 0 }, TICK_MS);
  assert.ok(position.x <= 42);
  assert.equal(canStand(thinWall, 42, 32), true);
  assert.equal(canStand(thinWall, 42.01, 32), false);

  const thinHorizontalWall = { ...world, width: 128, height: 64,
    collisions: [{ x: 0, y: 32, width: 128, height: 1 }] };
  let verticalPosition = { x: 64, y: 20 };
  for (let i = 0; i < 8; i += 1) verticalPosition = stepMovement(thinHorizontalWall, verticalPosition, { x: 0, y: 1 }, TICK_MS);
  assert.ok(verticalPosition.y <= 32);
  assert.equal(canStand(thinHorizontalWall, 64, 32), true);
  assert.equal(canStand(thinHorizontalWall, 64, 32.01), false);

  const passage = { ...world, width: 64, height: 64,
    collisions: [{ x: 0, y: 0, width: 24, height: 64 }, { x: 40, y: 0, width: 24, height: 64 }] };
  assert.equal(canStand(passage, 32, 32), true);
  let passagePosition = { x: 32, y: 24 };
  for (let i = 0; i < 3; i += 1) passagePosition = stepMovement(passage, passagePosition, { x: 0, y: -1 }, TICK_MS);
  assert.ok(passagePosition.y < 24);
  const upperY = passagePosition.y;
  for (let i = 0; i < 5; i += 1) passagePosition = stepMovement(passage, passagePosition, { x: 0, y: 1 }, TICK_MS);
  assert.ok(passagePosition.y > upperY);
  assert.equal(passagePosition.x, 32);
});

test('seat points expose authored anchor/facing and only the foot tile can activate them', () => {
  const seat = world.seats[0];
  assert.deepEqual(seat, { id: 'lobby-seat-1', kind: 'seat', x: 408, y: 392, facing: 'up' });
  assert.equal(standsOnSeat(seat, { x: 400, y: 384 }), true);
  assert.equal(standsOnSeat(seat, { x: 415.99, y: 399.99 }), true);
  // Adjacent tiles cannot activate, even if very close to the same anchor.
  assert.equal(standsOnSeat(seat, { x: 399.99, y: 392 }), false);
  assert.equal(standsOnSeat(seat, { x: 416, y: 392 }), false);
  assert.equal(standsOnSeat(seat, { x: 408, y: 400 }), false);
  const offset = parseWorldMap(mutate((map, layers) => {
    map.layers = [layers[0], { type: 'group', offsetx: 16, offsety: 16, layers: layers.slice(1) }];
  }));
  assert.deepEqual(offset.seats[0], { ...seat, x: 424, y: 408 });
});

test('movement facing retains zero direction and resolves cardinal and diagonal input', () => {
  assert.equal(movementFacing({ x: 0, y: 0 }, 'left'), 'left');
  assert.equal(movementFacing({ x: 1, y: 0 }, 'down'), 'right');
  assert.equal(movementFacing({ x: -1, y: 0 }, 'down'), 'left');
  assert.equal(movementFacing({ x: 0, y: -1 }, 'right'), 'up');
  assert.equal(movementFacing({ x: 1, y: 1 }, 'up'), 'down');
});

for (const [name, changes] of Object.entries({
  rectangle: { point: false, width: 16, height: 16 },
  'missing facing': { properties: [] },
  'invalid facing': { properties: [{ name: 'facing', value: 'north' }] },
  'blocked anchor': { x: 350, y: 250 },
  'out of bounds': { x: -1 },
  'duplicate authored id': { name: 'message-wall' },
  'overlapping seat tile': { x: 440, y: 392 },
})) test(`seat authoring rejects ${name}`, () => {
  assert.throws(() => parseWorldMap(mutate((_map, layers) => {
    const list = objects(layers[3]);
    Object.assign(list.find(object => object.name === 'lobby-seat-1')!, changes);
    layers[3].objects = list;
  })));
});

test('semantic validation accepts independent visual layers, multiple/external tilesets and decorative shapes', () => {
  const map = mutate((map, layers) => {
    layers[0].name = 'floor';
    layers.push({ name: 'floor', type: 'tilelayer', data: 'encoded', encoding: 'base64', compression: 'zlib' });
    layers.push({ name: 'art', type: 'objectgroup', objects: [{ ellipse: true, rotation: 45, x: 1, y: 1 }] });
    layers.push({ name: 'backdrop', type: 'imagelayer', image: 'sky.png' });
    map.tilesets = [{ firstgid: 1, source: 'tiles.tsj' }, { firstgid: 200, name: 'decoration', tiles: [] }];
  });
  assert.deepEqual(parseWorldMap(map), world);
  assert.deepEqual(parseWorldMap(mutate((map, layers) => { layers.shift(); delete map.tilesets; })), world);
});

test('semantic layers support nested groups and offsets, including named spawn selection', () => {
  const map = mutate((map, layers) => {
    const spawns = objects(layers[1]); spawns[0].name = 'arrival';
    layers[1].objects = spawns;
    const grouped = layers.slice(1);
    map.layers = [layers[0], { type: 'group', name: 'world', offsetx: 16, offsety: 16, layers: grouped }];
  });
  const parsed = parseWorldMap(map);
  assert.deepEqual(parsed.spawns.arrival, { x: 368, y: 400 });
  assert.equal(parsed.spawns.default, undefined);
  assert.equal(parsed.zones[0].x, world.zones[0].x + 16);
  assert.equal(parsed.collisions[0].y, world.collisions[0].y + 16);
});

test('interaction kinds are extensible and only registered semantics are validated', () => {
  const definitions = new InteractionRegistry<InteractionDefinition>().register('custom', {
    validate: zone => { z.string().min(1).parse(zone.properties.destination); },
  });
  const map = mutate((_map, layers) => {
    layers[3].objects = [{ name: 'custom-zone', class: 'custom', x: 16, y: 16, width: 32, height: 32,
      properties: [{ name: 'destination', value: 'work' }] }];
  });
  assert.equal(parseWorldMap(map, definitions).zones[0].kind, 'custom');
  assert.equal(parseWorldMap(map).zones[0].properties.destination, 'work');
  const broken = structuredClone(map);
  const layers = array(broken.layers).map(record); const zones = objects(layers[3]);
  zones[0].properties = []; layers[3].objects = zones; broken.layers = layers;
  assert.throws(() => parseWorldMap(broken, definitions));
  assert.throws(() => definitions.register('custom', { validate() {} }));
});

test('registry chooses initial map and named spawn and resolves every Portal destination', () => {
  const withPortal = mutate((_map, layers) => {
    layers[3].objects = [{ name: 'door', class: 'Portal', x: 16, y: 16, width: 32, height: 32,
      properties: [{ name: 'targetMap', value: 'studio' }, { name: 'targetSpawn', value: 'arrival' }] }];
  });
  const home = parseWorldMap(withPortal);
  const studio = { ...world, spawns: { arrival: spawn } };
  const registry = { initialMap: 'home', maps: [
    { id: 'home', url: '/home.json', defaultSpawn: 'default', world: home },
    { id: 'studio', url: '/studio.json', defaultSpawn: 'arrival', world: studio },
  ] };
  assert.equal(validateMapRegistry(registry), registry);
  assert.throws(() => validateMapRegistry({ ...registry, initialMap: 'missing' }));
  assert.throws(() => validateMapRegistry({ ...registry, maps: [registry.maps[0]] }));
  assert.throws(() => validateMapRegistry({ ...registry, maps: [...registry.maps, registry.maps[0]] }));
  assert.throws(() => validateMapRegistry({ ...registry, maps: [registry.maps[0], { ...registry.maps[1], defaultSpawn: 'missing' }] }));
  assert.throws(() => validateMapRegistry({ ...registry, maps: [registry.maps[0], { ...registry.maps[1], world: { ...studio, spawns: { other: spawn } } }] }));
});

for (const [name, change] of Object.entries({
  'nonstandard tile size': (map: Record<string, unknown>) => { map.tilewidth = 32; },
  'infinite world': (map: Record<string, unknown>) => { map.infinite = true; },
  'missing semantic layer': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { layers.pop(); },
  'duplicate semantic layers': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { layers.push(layers[1]); },
  'spawn in wall': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[1]); list[0].x = 350; list[0].y = 250; layers[1].objects = list; },
  'rotated collision': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[2]); list[0].rotation = 45; layers[2].objects = list; },
  'zero-area collision': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[2]); list[0].width = 0; layers[2].objects = list; },
  'polygon collision': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[2]); list[0].polygon = [{ x: 0, y: 0 }]; layers[2].objects = list; },
  'duplicate interaction IDs': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[3]); list[1].name = list[0].name; layers[3].objects = list; },
  'missing board resource': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[3]); list[2].properties = []; layers[3].objects = list; },
  'missing web resource': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[3]); list[0].properties = []; layers[3].objects = list; },
  'out-of-bounds interaction': (_map: Record<string, unknown>, layers: Record<string, unknown>[]) => { const list = objects(layers[3]); list[0].width = 9999; layers[3].objects = list; },
})) test(`project semantics reject ${name}`, () => assert.throws(() => parseWorldMap(mutate(change))));
