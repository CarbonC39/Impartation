import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createTestMap } from '../../../packages/shared/test-fixtures/world.js';
import { parseWorldMap, stepMovement, canStand, contains, PLAYER_FOOTPRINT, PLAYER_SPEED, TICK_MS,
  InteractionRegistry, validateMapRegistry, validateWorldRegistry, spaceDefinitionSchema, type InteractionDefinition } from '@virtual-workspace/shared';
import { standsOnAction, findActionAnchor, actionFacingMatches, canAlignAction, movementFacing } from '@virtual-workspace/shared';

const raw: unknown = createTestMap();
const authoredRaw: unknown = JSON.parse(readFileSync(new URL('../../../assets/maps/lobby.tmj', import.meta.url), 'utf8'));
const world = parseWorldMap(raw);
const spawn = world.spawns.default;
const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const array = (value: unknown) => z.array(z.unknown()).parse(value);
function setProperty(object: Record<string, unknown>, name: string, value: unknown) {
  const properties = array(object.properties).map(record);
  const index = properties.findIndex(property => property.name === name);
  if (index < 0) properties.push({ name, value });
  else properties[index] = { ...properties[index], value };
  object.properties = properties;
}
function mutate(change: (map: Record<string, unknown>, layers: Record<string, unknown>[]) => void) {
  const map = record(structuredClone(raw));
  const layers = array(map.layers).map(record);
  map.layers = layers;
  change(map, layers);
  return map;
}
const objects = (layer: Record<string, unknown>) => array(layer.objects).map(record);

test('authored Tiled source supplies map geometry and action anchors', () => {
  const authoredWorld = parseWorldMap(authoredRaw);
  for (const point of Object.values(authoredWorld.spawns)) assert.equal(canStand(authoredWorld, point.x, point.y), true);
  for (const anchor of authoredWorld.actions) {
    assert.equal(canStand(authoredWorld, anchor.x + anchor.offsetX, anchor.y + anchor.offsetY), true);
  }
});

test('deterministic fixture supplies named spawns, collision geometry and interaction resources', () => {
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

test('action anchors normalize to action objects with optional facing, offsets and linkage', () => {
  const action = world.actions[0];
  assert.deepEqual(action, { id: 'lobby-seat-1', kind: 'action', action: 'sit', x: 408, y: 392,
    facing: 'up', offsetX: 0, offsetY: 0, linkedObjectId: 'desk-1' });
  assert.equal(standsOnAction(action, { x: 400, y: 384.01 }), true);
  assert.equal(standsOnAction(action, { x: 415.99, y: 399.99 }), true);
  assert.equal(standsOnAction(action, { x: 399.99, y: 392 }), true);
  assert.equal(standsOnAction(action, { x: 416, y: 392 }), true);
  assert.equal(standsOnAction(action, { x: 408, y: 400 }), true);

  const noFacing = parseWorldMap(mutate((_map, layers) => {
    const list = objects(layers[3]);
    const object = list.find(item => item.name === 'lobby-seat-1')!;
    object.properties = array(object.properties).map(record).filter(property => property.name !== 'facing');
    layers[3].objects = list;
  }));
  assert.equal(noFacing.actions[0].facing, undefined);

  const offsets = parseWorldMap(mutate((_map, layers) => {
    const list = objects(layers[3]);
    const object = list.find(item => item.name === 'lobby-seat-1')!;
    setProperty(object, 'offsetX', -4);
    setProperty(object, 'offsetY', 6);
    layers[3].objects = list;
  }));
  assert.deepEqual([offsets.actions[0].offsetX, offsets.actions[0].offsetY], [-4, 6]);
  const offset = parseWorldMap(mutate((map, layers) => {
    map.layers = [layers[0], { type: 'group', offsetx: 16, offsety: 16, layers: layers.slice(1) }];
  }));
  assert.deepEqual([offset.actions[0].x, offset.actions[0].y], [424, 408]);
});

test('anchor tiles require ground-footprint area overlap, including across tile boundaries', () => {
  const anchor = world.actions[0]; // tile [400,416) × [384,400)
  for (const position of [{ x: 394, y: 392 }, { x: 422, y: 392 }, { x: 408, y: 384 }, { x: 408, y: 408 }]) {
    assert.equal(standsOnAction(anchor, position), false, 'edge-only contact does not overlap');
  }
  for (const position of [{ x: 394.01, y: 392 }, { x: 421.99, y: 392 }, { x: 408, y: 384.01 }, { x: 408, y: 407.99 }]) {
    assert.equal(standsOnAction(anchor, position), true);
  }
});

test('nearest overlapping anchor is deterministic and is checked before facing', () => {
  const first = world.actions[0];
  const second = { ...first, id: 'zz-adjacent', x: 424, facing: 'down' as const };
  const map = { ...world, actions: [first, second] };
  assert.equal(findActionAnchor(map, { x: 415, y: 392 }, 'sit')?.id, first.id);
  assert.equal(findActionAnchor(map, { x: 417, y: 392 }, 'sit')?.id, second.id);
  assert.equal(findActionAnchor(map, { x: 416, y: 392 }, 'sit')?.id, first.id);
  assert.equal(findActionAnchor({ ...map, actions: [second, first] }, { x: 416, y: 392 }, 'sit')?.id, first.id);
  assert.equal(findActionAnchor(map, { x: 416, y: 392 }, 'wave'), undefined);
  assert.equal(actionFacingMatches(first, 'up'), true);
  for (const facing of ['down', 'left', 'right']) assert.equal(actionFacingMatches(first, facing), false);
  assert.equal(actionFacingMatches({ ...first, facing: undefined }, 'left'), true);
  const offset = { ...first, offsetX: 48 };
  assert.equal(findActionAnchor({ ...world, actions: [offset] }, {
    x: 456, y: 392, action: 'sit', actionTargetId: first.id,
  }, 'sit')?.id, first.id, 'animation updates retain an already active offset anchor');
});

test('action alignment cannot cross thin walls or forbidden areas between clear endpoints', () => {
  const clear = { ...world, collisions: [] };
  const from = { x: 64, y: 64 }; const to = { x: 96, y: 64 };
  assert.equal(canAlignAction(clear, from, to), true);
  assert.equal(canAlignAction({ ...clear, collisions: [{ x: 80, y: 48, width: 1, height: 32 }] }, from, to), false);
  assert.equal(canAlignAction(clear, from, to, position => position.x < 76 || position.x > 84), false);
  assert.equal(canAlignAction(clear, from, from, () => false), false);
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
  'missing action': { properties: [] },
  'invalid facing': { properties: [{ name: 'action', value: 'sit' }, { name: 'facing', value: 'north' }] },
  'invalid action': { properties: [{ name: 'action', value: 'Bad action' }] },
  'blocked anchor': { x: 350, y: 250 },
  'out of bounds': { x: -1 },
  'duplicate authored id': { name: 'message-wall' },
})) test(`action authoring rejects ${name}`, () => {
  assert.throws(() => parseWorldMap(mutate((_map, layers) => {
    const list = objects(layers[3]);
    Object.assign(list.find(object => object.name === 'lobby-seat-1')!, changes);
    layers[3].objects = list;
  })));
});

test('action offsets must be finite and end on walkable ground', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => parseWorldMap(mutate((_map, layers) => {
      const list = objects(layers[3]);
      const object = list.find(item => item.name === 'lobby-seat-1')!;
      setProperty(object, 'offsetX', value);
      layers[3].objects = list;
    })));
  }
  for (const [offsetX, offsetY] of [[400, 0], [0, -100]]) {
    assert.throws(() => parseWorldMap(mutate((_map, layers) => {
      const list = objects(layers[3]);
      const object = list.find(item => item.name === 'lobby-seat-1')!;
      setProperty(object, 'offsetX', offsetX);
      setProperty(object, 'offsetY', offsetY);
      layers[3].objects = list;
    })));
  }
});

test('different actions may share a tile but duplicate same-action tile anchors are rejected', () => {
  const sharedTile = (action: string) => mutate((_map, layers) => {
    const list = objects(layers[3]);
    const object = list.find(item => item.name === 'lobby-seat-2')!;
    object.x = 410; object.y = 395;
    setProperty(object, 'action', action);
    layers[3].objects = list;
  });
  assert.equal(parseWorldMap(sharedTile('wave')).actions.length, 2);
  assert.throws(() => parseWorldMap(sharedTile('sit')));
});

test('point interactions require the explicit action class', () => {
  assert.throws(() => parseWorldMap(mutate((_map, layers) => {
    const list = objects(layers[3]);
    const object = list.find(item => item.name === 'lobby-seat-1')!;
    object.class = 'seat';
    object.properties = array(object.properties).map(record).filter(property => property.name !== 'action');
    layers[3].objects = list;
  })), /Zone interactions must be rectangles/);
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


test('Space registry preserves display order and validates member maps and Portal boundaries', () => {
  const maps = ['home', 'studio'].map(id => ({ id, url: `/${id}.json`, defaultSpawn: 'default', world }));
  const spaces = [
    { id: 'z-space', name: 'First', cover: '/covers/first.png', initialMap: 'studio', maps: ['studio', 'home'] },
    { id: 'a-space', name: 'Second', description: 'Optional', cover: '/covers/second.png', initialMap: 'home', maps: ['home'] },
  ];
  const registry = { maps, spaces };
  assert.equal(validateWorldRegistry(registry), registry);
  assert.deepEqual(registry.spaces.map(space => space.id), ['z-space', 'a-space']);
  assert.throws(() => validateWorldRegistry({ maps, spaces: [] }));
  assert.throws(() => validateWorldRegistry({ maps, spaces: [spaces[0], spaces[0]] }));
  for (const changes of [{ maps: ['missing'] }, { initialMap: 'studio' }, { maps: ['home', 'home'] }]) {
    assert.throws(() => validateWorldRegistry({ maps, spaces: [{ ...spaces[1], ...changes }] }));
  }
  assert.throws(() => validateWorldRegistry({ maps: [...maps, maps[0]], spaces }));
  for (const changes of [{ id: 'has spaces' }, { name: '' }, { cover: '' }, { maps: [] }]) {
    assert.equal(spaceDefinitionSchema.safeParse({ ...spaces[0], ...changes }).success, false);
  }
  const home = { ...world, zones: [{ id: 'door', kind: 'Portal', resourceId: 'door', x: 16, y: 16, width: 32, height: 32,
    properties: { targetMap: 'studio', targetSpawn: 'default' } }] };
  const withPortal = [{ ...maps[0], world: home }, maps[1]];
  assert.throws(() => validateWorldRegistry({ maps: withPortal, spaces: [spaces[1]] }), /Invalid Portal/);
  assert.equal(validateWorldRegistry({ maps: withPortal, spaces: [spaces[0]] }).spaces.length, 1);
});
