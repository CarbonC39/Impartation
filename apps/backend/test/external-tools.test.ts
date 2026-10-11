import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWorldMap } from '@virtual-workspace/shared';
import { loadExternalTools } from '../src/external-tools.js';

const world = parseWorldMap(JSON.parse(readFileSync(new URL('../../../assets/maps/lobby.tmj', import.meta.url), 'utf8')));

test('external tools are optional and map each resource to its native page without identity fields', () => {
  assert.deepEqual(loadExternalTools('{}', world), []);
  const config = {
    'shared-canvas': { kind: 'whiteboard', url: 'https://board.example/boards/shared' },
    'shared-drawing': { kind: 'drawing', url: 'https://draw.example/' },
    'lounge-screen': { kind: 'media', url: 'http://localhost:8080/' },
    'shared-document': { kind: 'document', url: 'https://docs.example/p/shared' },
  };
  assert.deepEqual(loadExternalTools(JSON.stringify(config), world),
    Object.entries(config).map(([resourceId, entry]) => ({ resourceId, ...entry })));
});

test('invalid JSON, unknown resources, kind mismatches and identity fields fail configuration', () => {
  for (const raw of [
    '{', '[]', 'null',
    JSON.stringify({ unknown: { kind: 'whiteboard', url: 'https://board.example/' } }),
    JSON.stringify({ 'shared-canvas': { kind: 'document', url: 'https://board.example/' } }),
    JSON.stringify({ 'message-wall': { kind: 'board', url: 'https://board.example/' } }),
    JSON.stringify({ 'shared-canvas': { kind: 'whiteboard', url: 'https://board.example/', token: 'secret' } }),
  ]) assert.throws(() => loadExternalTools(raw, world));
});

test('a configured resource cannot also belong to a different zone kind', () => {
  const ambiguous = { ...world, zones: [...world.zones, { ...world.zones[0], resourceId: 'shared-canvas' }] };
  assert.throws(() => loadExternalTools(JSON.stringify({ 'shared-canvas': { kind: 'whiteboard', url: 'https://board.example/' } }), ambiguous));
});

for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/tool', '/relative',
  'not a url', 'https://user:password@board.example/', 'https://user@board.example/']) {
  test(`external tool URL rejects ${url}`, () => {
    assert.throws(() => loadExternalTools(JSON.stringify({ 'shared-canvas': { kind: 'whiteboard', url } }), world));
  });
}

test('presentation configuration accepts native, embed and external with explicit external fallback', () => {
  for (const mode of ['external', 'embed', 'native']) {
    const entry = { kind: 'whiteboard', mode, url: 'https://board.example/',
      ...(mode === 'native' ? { fallback: 'external' } : {}) };
    assert.deepEqual(loadExternalTools(JSON.stringify({ 'shared-canvas': entry }), [world]), [{ resourceId: 'shared-canvas', ...entry }]);
  }
  assert.deepEqual(loadExternalTools(JSON.stringify({ 'shared-canvas': { kind: 'whiteboard', mode: 'native' } }), world),
    [{ resourceId: 'shared-canvas', kind: 'whiteboard', mode: 'native' }]);
  for (const entry of [
    { kind: 'whiteboard', mode: 'unknown', url: 'https://board.example/' },
    { kind: 'whiteboard', mode: 'embed' },
    { kind: 'whiteboard', mode: 'external' },
    { kind: 'whiteboard', mode: 'overlay', url: 'https://board.example/' },
    { kind: 'whiteboard', mode: 'adapter', url: 'https://board.example/' },
    { kind: 'whiteboard', mode: 'native', adapterId: 'view' },
    { kind: 'whiteboard', mode: 'native', fallback: 'external' },
    { kind: 'whiteboard', mode: 'native', url: 'https://board.example/', fallback: 'unknown' },
  ]) assert.throws(() => loadExternalTools(JSON.stringify({ 'shared-canvas': entry }), world));
});

test('resource kind consistency is checked across every registered map', () => {
  const other = { ...world, zones: [{ ...world.zones[0], resourceId: 'shared-canvas' }] };
  assert.throws(() => loadExternalTools(JSON.stringify({ 'shared-canvas': { kind: 'whiteboard', url: 'https://board.example/' } }), [world, other]));
});
