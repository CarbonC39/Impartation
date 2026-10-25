import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWorldMap } from '@impartation/shared';
import { loadWebTools } from '../src/interactions/web/config.js';

const world = parseWorldMap(JSON.parse(readFileSync(new URL('../../../assets/maps/lobby.tmj', import.meta.url), 'utf8')));

test('web tools are optional and resolve arbitrary resource IDs without provider kinds or identity fields', () => {
  assert.deepEqual(loadWebTools('{}', world), []);
  const calendar = { ...world.zones[0], id: 'calendar-entry', kind: 'web', resourceId: 'team-calendar' };
  const customWorld = { ...world, zones: [...world.zones, calendar] };
  const config = {
    'shared-canvas': { url: 'https://board.example/boards/shared' },
    'shared-drawing': { url: 'https://draw.example/' },
    'lounge-screen': { url: 'http://localhost:8080/' },
    'shared-document': { url: 'https://docs.example/p/shared' },
    'team-calendar': { url: 'https://calendar.example/', mode: 'embed' },
  };
  assert.deepEqual(loadWebTools(JSON.stringify(config), customWorld),
    Object.entries(config).map(([resourceId, entry]) => ({ resourceId, ...entry })));
});

test('invalid JSON, unknown or non-web resources, obsolete kinds and identity fields fail configuration', () => {
  for (const raw of [
    '{', '[]', 'null',
    JSON.stringify({ unknown: { url: 'https://board.example/' } }),
    JSON.stringify({ 'message-wall': { url: 'https://board.example/' } }),
    JSON.stringify({ 'shared-canvas': { kind: 'whiteboard', url: 'https://board.example/' } }),
    JSON.stringify({ 'shared-canvas': { url: 'https://board.example/', token: 'secret' } }),
  ]) assert.throws(() => loadWebTools(raw, world));
});

test('a configured web resource cannot also belong to a non-web interaction', () => {
  const board = world.zones.find(zone => zone.kind === 'board')!;
  const ambiguous = { ...world, zones: [...world.zones, { ...board, resourceId: 'shared-canvas' }] };
  assert.throws(() => loadWebTools(JSON.stringify({ 'shared-canvas': { url: 'https://board.example/' } }), ambiguous));
});

for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/tool', '/relative',
  'not a url', 'https://user:password@board.example/', 'https://user@board.example/']) {
  test(`web tool URL rejects ${url}`, () => {
    assert.throws(() => loadWebTools(JSON.stringify({ 'shared-canvas': { url } }), world));
  });
}

test('web presentation accepts embed and external with optional manual link and trusted origin settings', () => {
  for (const mode of ['external', 'embed']) {
    const entry = { mode, url: 'https://board.example/', manualExternalOpen: true, allowSameOrigin: true };
    assert.deepEqual(loadWebTools(JSON.stringify({ 'shared-canvas': entry }), [world]), [{ resourceId: 'shared-canvas', ...entry }]);
  }
  for (const entry of [
    { mode: 'unknown', url: 'https://board.example/' },
    {},
    { mode: 'embed' },
    { mode: 'external' },
    { mode: 'native', url: 'https://board.example/' },
    { mode: 'popup', url: 'https://board.example/' },
    { mode: 'overlay', url: 'https://board.example/' },
    { mode: 'adapter', url: 'https://board.example/' },
    { url: 'https://board.example/', adapterId: 'view' },
    { url: 'https://board.example/', fallback: 'unknown' },
  ]) assert.throws(() => loadWebTools(JSON.stringify({ 'shared-canvas': entry }), world));
});

test('web resource consistency is checked across every registered map and same resources can be reused', () => {
  const config = JSON.stringify({ 'shared-canvas': { url: 'https://board.example/' } });
  assert.deepEqual(loadWebTools(config, [world, world]), [{ resourceId: 'shared-canvas', url: 'https://board.example/' }]);
  const board = world.zones.find(zone => zone.kind === 'board')!;
  const other = { ...world, zones: [{ ...board, resourceId: 'shared-canvas' }] };
  assert.throws(() => loadWebTools(config, [world, other]));
});
