import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestMap } from '../../../packages/shared/test-fixtures/world.js';

/** Stable room geometry independent of the editable product map. */
export function createRoomWorldFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-room-world-'));
  const source = createTestMap();
  source.layers[3].objects.push({ id: 11, name: 'reading-spot', class: 'action',
    point: true, x: 360, y: 440, width: 0, height: 0,
    properties: [
      { name: 'action', type: 'string', value: 'sit' },
      { name: 'offsetX', type: 'float', value: 2 },
      { name: 'offsetY', type: 'float', value: -1 },
    ],
  });
  const map = { ...source, tilesets: source.tilesets.map(tileset => ({ ...tileset,
    image: fileURLToPath(new URL('../../../assets/maps/tiles.png', import.meta.url)),
  })) };
  writeFileSync(join(directory, 'lobby.tmj'), JSON.stringify(map));
  const registryPath = join(directory, 'registry.json');
  writeFileSync(registryPath, JSON.stringify({ maps: [
    { id: 'lobby', file: 'lobby.tmj', defaultSpawn: 'default' },
    { id: 'unused', file: 'lobby.tmj', defaultSpawn: 'default' },
  ], spaces: [{ id: 'main', name: 'Main', cover: '/maps/tiles.png', initialMap: 'lobby', maps: ['lobby'] }, { id: 'other', name: 'Other', cover: '/maps/tiles.png', initialMap: 'lobby', maps: ['lobby'] }] }));
  return { directory, registryPath };
}
