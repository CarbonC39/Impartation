import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createTestMap } from '../../../packages/shared/test-fixtures/world';

/** Test-only maps exercise the registry without adding destinations to the product map. */
export function createWorldFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-browser-world-'));
  const map = z.object({
    layers: z.array(z.object({ name: z.string(), type: z.string(), objects: z.array(z.record(z.string(), z.unknown())).optional() }).passthrough()),
    tilesets: z.array(z.object({ name: z.string(), image: z.string() }).passthrough()),
  }).passthrough().parse(createTestMap());
  const image = fileURLToPath(new URL('../../../assets/maps/tiles.png', import.meta.url));
  map.layers[0].name = 'floor';
  map.layers.find(layer => layer.name === 'spawns')!.objects![0].name = 'entry';
  map.layers.find(layer => layer.name === 'interactions')!.objects!.push({
    name: 'to-studio', class: 'Portal', x: 704, y: 432, width: 48, height: 64,
    properties: [{ name: 'targetMap', value: 'studio' }, { name: 'targetSpawn', value: 'arrival' }],
  });
  map.tilesets[0].image = image;
  writeFileSync(join(directory, 'entry.tmj'), JSON.stringify(map));
  writeFileSync(join(directory, 'atlas.tsj'), JSON.stringify({ ...map.tilesets[0], image }));
  const studio = {
    orientation: 'orthogonal', infinite: false, width: 24, height: 16, tilewidth: 16, tileheight: 16,
    tilesets: [{ firstgid: 1, source: 'atlas.tsj' }, { ...map.tilesets[0], firstgid: 37, name: 'details' }],
    layers: [
      { name: 'floor', type: 'tilelayer', width: 24, height: 16, data: Array.from({ length: 384 }, () => 1) },
      { name: 'artwork', type: 'group', layers: [
        { name: 'decorations', type: 'tilelayer', width: 24, height: 16, data: Array.from({ length: 384 }, () => 39), opacity: 0.5 },
      ] },
      { name: 'spawns', type: 'objectgroup', objects: [{ name: 'arrival', point: true, x: 96, y: 96 }] },
      { name: 'collisions', type: 'objectgroup', objects: [] },
      { name: 'interactions', type: 'objectgroup', objects: [{ name: 'return', class: 'Portal', x: 16, y: 64, width: 32, height: 64,
        properties: [{ name: 'targetMap', value: 'workspace' }, { name: 'targetSpawn', value: 'entry' }] }] },
    ],
  };
  writeFileSync(join(directory, 'studio.tmj'), JSON.stringify(studio));
  const registryPath = join(directory, 'registry.json');
  writeFileSync(registryPath, JSON.stringify({ initialMap: 'workspace', maps: [
    { id: 'workspace', file: 'entry.tmj', defaultSpawn: 'entry' }, { id: 'studio', file: 'studio.tmj', defaultSpawn: 'arrival' },
  ] }));
  return registryPath;
}
