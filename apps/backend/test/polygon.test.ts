import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorldMap, polygonArea, overlapArea, areasOverlap, contains, canStand, currentZone,
  stepMovement, worldRegistryResponseSchema, type Point } from '@virtual-workspace/shared';

const polygon = (points: number[][]) => points.map(([x, y]) => ({ x, y }));
const triangle = polygon([[0, 0], [64, 0], [0, 64]]);
function mapWith(obstacles: unknown[] = [], zones: unknown[] = []) {
  return { orientation: 'orthogonal', infinite: false, width: 16, height: 16, tilewidth: 16, tileheight: 16,
    layers: [
      { type: 'objectgroup', name: 'spawns', objects: [{ name: 'entry', x: 32, y: 32, point: true }] },
      { type: 'group', name: 'offsets', offsetx: 64, offsety: 64, layers: [
        { type: 'objectgroup', name: 'collisions', objects: obstacles },
        { type: 'objectgroup', name: 'interactions', objects: zones },
      ] },
    ] };
}
const zone = (id: number, points: Point[], x = 0, y = 0) => ({ id, name: `zone-${id}`, class: 'privateArea', x, y, polygon: points });

test('polygon semantics apply group offsets and preserve vertices through the world API schema', () => {
  const world = parseWorldMap(mapWith([{ x: 0, y: 0, polygon: triangle }], [zone(2, triangle, 80)]));
  assert.deepEqual(world.collisions[0], { x: 64, y: 64, width: 64, height: 64,
    polygon: polygon([[64, 64], [128, 64], [64, 128]]) });
  const response = worldRegistryResponseSchema.parse({ spaces: [{ id: 'main', name: 'Main', cover: '/cover.png', initialMap: 'map', maps: ['map'] }],
    maps: [{ id: 'map', url: '/map.json', defaultSpawn: 'entry', world }] });
  assert.deepEqual(response.maps[0].world.collisions, world.collisions);
  assert.deepEqual(response.maps[0].world.zones, world.zones);
  assert.equal(currentZone(world, { x: 150, y: 70 })?.id, '2');
  assert.equal(currentZone(world, { x: 200, y: 120 }), undefined, 'outside polygon but inside bounding box');
});

test('ground footprints collide with polygon edges, allow edge contact, and walk through empty bounding corners', () => {
  const world = parseWorldMap(mapWith([{ x: 0, y: 0, polygon: triangle }]));
  assert.equal(canStand(world, 70, 80), false);
  assert.equal(canStand(world, 120, 120), true);
  assert.equal(canStand(world, 100, 106), true, 'footprint only touches diagonal x+y=192');
  assert.equal(canStand(world, 100, 105.9), false);
  assert.equal(canStand(world, 58, 90), true);
  assert.equal(canStand(world, 58.1, 90), false);
  assert.ok(stepMovement(world, { x: 58, y: 90 }, { x: 1, y: 0 }, 50).x <= 58);
});

test('concave polygons retain cutouts and correct overlap area in either winding', () => {
  const points = polygon([[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]]);
  for (const vertices of [points, [...points].reverse()]) {
    const area = polygonArea(vertices);
    assert.equal(contains(area, 30, 30), false);
    assert.equal(contains(area, 10, 30), true);
    assert.equal(overlapArea(area, { x: 10, y: 10, width: 30, height: 30 }), 500);
    assert.equal(overlapArea(area, { x: 20, y: 20, width: 30, height: 30 }), 0);
    assert.equal(areasOverlap(area, area), true);
  }
  // Clipping a concave polygon can produce disjoint pieces; both count.
  const u = polygonArea(polygon([[0, 0], [60, 0], [60, 60], [40, 60], [40, 20], [20, 20], [20, 60], [0, 60]]));
  assert.equal(overlapArea(u, { x: 0, y: 30, width: 60, height: 10 }), 400);
});

test('private polygon areas may share bounding boxes and edges, but reject actual overlap', () => {
  const first = zone(1, triangle);
  const separate = zone(2, polygon([[64, 64], [64, 1], [1, 64]]));
  assert.equal(parseWorldMap(mapWith([], [first, separate])).zones.length, 2);
  const touching = zone(2, polygon([[64, 64], [64, 0], [0, 64]]));
  assert.equal(parseWorldMap(mapWith([], [first, touching])).zones.length, 2);
  const crossing = zone(2, polygon([[64, 64], [64, 0], [0, 62]]));
  assert.throws(() => parseWorldMap(mapWith([], [first, crossing])), /must not overlap/);
  assert.throws(() => parseWorldMap(mapWith([], [first, zone(2, triangle)])), /must not overlap/);
  assert.throws(() => parseWorldMap(mapWith([], [first, { id: 2, name: 'rect', class: 'privateArea', x: 1, y: 1, width: 4, height: 4 }])), /must not overlap/);
});

for (const [name, points] of Object.entries({
  'too few vertices': [[0, 0], [1, 1]],
  'zero area': [[0, 0], [1, 1], [2, 2]],
  'self intersection': [[0, 0], [60, 50], [0, 60], [60, 0]],
  'duplicate vertex': [[0, 0], [60, 0], [60, 0], [0, 60]],
  'overlapping adjacent edges': [[0, 0], [60, 0], [30, 0], [30, 60], [0, 60]],
  'out of bounds': [[0, 0], [600, 0], [0, 60]],
})) test(`polygon semantics reject ${name}`, () => {
  assert.throws(() => parseWorldMap(mapWith([{ x: 0, y: 0, polygon: polygon(points) }])));
});

test('polygons do not replace point semantics or accept rotation', () => {
  assert.throws(() => parseWorldMap(mapWith([], [{ name: 'seat', class: 'action', point: true, x: 0, y: 0,
    polygon: triangle, properties: [{ name: 'action', value: 'sit' }] }])), /must be named points/);
  assert.throws(() => parseWorldMap(mapWith([{ x: 0, y: 0, rotation: 15, polygon: triangle }])));
});
