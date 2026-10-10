import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorldMap, stepMovement, canStand, contains, PLAYER_SPEED, TICK_MS } from '@virtual-workspace/shared';

const raw = JSON.parse(readFileSync(new URL('../../../assets/maps/lobby.tmj', import.meta.url), 'utf8'));
const world = parseWorldMap(raw);

test('Tiled fixture supplies spawn, collision geometry, and resource zones', () => {
  assert.deepEqual(world.spawn, { x: 352, y: 384 });
  assert.equal(world.collisions.length, 1);
  assert.deepEqual(world.zones.map(zone => zone.kind), ['media', 'whiteboard', 'board', 'pomodoro']);
  assert.equal(world.zones[0].resourceId, 'lounge-screen');
  assert.equal(contains(world.zones[0], 64, 64), true);
  assert.equal(contains(world.zones[0], 224, 64), false);
});

test('movement normalizes diagonals, clamps delayed ticks, and blocks walls and world edges', () => {
  const diagonal = stepMovement(world, world.spawn, { x: 1, y: 1 }, 5000);
  assert.ok(Math.abs(Math.hypot(diagonal.x - world.spawn.x, diagonal.y - world.spawn.y) - PLAYER_SPEED * TICK_MS / 1000) < 0.0001);
  const slide = stepMovement(world, { x: 310, y: 250 }, { x: 1, y: 1 }, TICK_MS);
  assert.equal(slide.x, 310);
  assert.ok(slide.y > 250);
  assert.equal(canStand(world, 319, 250), false);
  const edge = stepMovement(world, { x: 10, y: 40 }, { x: -1, y: 0 }, TICK_MS);
  assert.equal(edge.x, 10);
});

test('unsupported or invalid Tiled geometry fails at startup', () => {
  const mutation = (change: (map: typeof raw) => void) => {
    const map = structuredClone(raw);
    change(map);
    assert.throws(() => parseWorldMap(map));
  };
  mutation(map => { map.infinite = true; });
  mutation(map => { map.layers[2].offsetx = 32; });
  mutation(map => { map.layers[2].objects[0].rotation = 45; });
  mutation(map => { map.layers[2].objects[0].polygon = [{ x: 0, y: 0 }]; });
  mutation(map => { map.layers[1].objects[0].x = -1; });
  mutation(map => { map.layers[3].objects[1].name = map.layers[3].objects[0].name; });
  mutation(map => { map.layers[3].objects[0].properties = []; });
});

test('AABB corner collision is conservative and stationary input leaves position unchanged', () => {
  assert.equal(canStand(world, 311, 183), false);
  assert.equal(canStand(world, 310, 182), true);
  assert.deepEqual(stepMovement(world, world.spawn, { x: 0, y: 0 }, 50), world.spawn);
  assert.deepEqual(stepMovement(world, world.spawn, { x: 1, y: 1 }, -50), world.spawn);
});

test('Tiled class field and an embedded atlas name are read without hardcoded names', () => {
  const map = structuredClone(raw);
  map.layers[3].objects[0].class = 'media';
  delete map.layers[3].objects[0].type;
  map.tilesets[0].name = 'custom';
  map.tilesets[0].image = '../custom-atlas.png';
  assert.equal(parseWorldMap(map).zones[0].kind, 'media');
  assert.deepEqual(parseWorldMap(map).tileset, { name: 'custom', image: '../custom-atlas.png' });
});
for (const [name, change] of Object.entries({
  'missing ground': (map: typeof raw) => { map.layers.shift(); },
  'ground type': (map: typeof raw) => { map.layers[0].type = 'objectgroup'; },
  'ground dimensions': (map: typeof raw) => { map.layers[0].width = 1; },
  'truncated tile data': (map: typeof raw) => { map.layers[0].data.pop(); },
  'unknown tile id': (map: typeof raw) => { map.layers[0].data[0] = 99; },
  'compressed data': (map: typeof raw) => { map.layers[0].data = 'compressed'; },
  'external tileset': (map: typeof raw) => { map.tilesets = [{ firstgid: 1, source: 'external.tsj' }]; },
  'missing tileset': (map: typeof raw) => { delete map.tilesets; },
  'group layer': (map: typeof raw) => { map.layers[2].type = 'group'; },
  'duplicate layers': (map: typeof raw) => { map.layers[2].name = 'spawns'; },
  'missing object layer': (map: typeof raw) => { map.layers.pop(); },
  'spawn in wall': (map: typeof raw) => { map.layers[1].objects[0].x = 350; map.layers[1].objects[0].y = 250; },
  'zero area collision': (map: typeof raw) => { map.layers[2].objects[0].width = 0; },
  'out of bounds zone': (map: typeof raw) => { map.layers[3].objects[0].width = 9999; },
  'invalid zone kind': (map: typeof raw) => { map.layers[3].objects[0].type = 'unknown'; },
  'empty resource id': (map: typeof raw) => { map.layers[3].objects[0].properties[0].value = ''; },
})) test(`Tiled validation rejects ${name}`, () => {
  const map = structuredClone(raw);
  change(map);
  assert.throws(() => parseWorldMap(map));
});
