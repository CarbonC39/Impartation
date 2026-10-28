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
  Object.assign(map.layers[0], { visible: true, opacity: 1, x: 0, y: 0 });
  map.layers.find(layer => layer.name === 'spawns')!.objects![0].name = 'entry';
  map.layers.find(layer => layer.name === 'interactions')!.objects!.push({
    name: 'to-studio', class: 'Portal', x: 704, y: 432, width: 48, height: 64,
    properties: [{ name: 'targetMap', value: 'studio' }, { name: 'targetSpawn', value: 'arrival' }],
  });
  const properties = (values: Record<string, unknown>) => Object.entries(values).map(([name, value]) => ({ name, value }));
  map.layers.find(layer => layer.name === 'interactions')!.objects!.push(
    { id: 20, name: 'sofa-selector', class: 'variantSelector', point: true, x: 360, y: 456,
      properties: properties({ action: 'sit', facing: 'down', targetObjectId: 90, variants: 'computer,book,drawing-board,empty' }) },
    { id: 32, name: 'selector-web', class: 'web', x: 352, y: 448, width: 32, height: 32,
      properties: properties({ resourceId: 'shared-canvas' }) },
    { id: 30, name: 'quiet-room', class: 'privateArea', x: 256, y: 432, width: 128, height: 64 },
    { id: 31, name: 'mirror', class: 'wardrobe', x: 320, y: 432, width: 32, height: 32 },
    { id: 191, name: 'native-crown', class: 'attachment', x: 432, y: 352, width: 16, height: 16,
      properties: properties({ mode: 'single-unique', attachmentIds: 'party-crown', visualObjectId: 190 }) },
  );
  map.layers.push({ name: 'variant-decor', type: 'objectgroup', objects: [
    { id: 190, name: 'source-visual', gid: 10, x: 432, y: 368, width: 16, height: 16 },
    { id: 90, name: 'sofa-item', gid: 8, x: 384, y: 448, width: 16, height: 16,
      properties: properties({ 'variant.computer': 6, 'variant.book': 18, 'variant.drawing-board': 31, 'variant.empty': -1 }) },
  ] });
  map.layers.push({ name: 'sorted-desk', type: 'tilelayer', width: 48, height: 32, visible: true, opacity: 1, x: 0, y: 0,
    properties: [{ name: 'ySort', type: 'bool', value: true }],
    data: Array.from({ length: 48 * 32 }, (_, index) => index === 27 * 48 + 24 ? 1 : 0),
  });
  Object.assign(map.tilesets[0], { image, imagewidth: 256, imageheight: 288, columns: 16, tilecount: 288 });
  writeFileSync(join(directory, 'entry.tmj'), JSON.stringify(map));
  writeFileSync(join(directory, 'atlas.tsj'), JSON.stringify({ ...map.tilesets[0], image }));
  const studio = {
    orientation: 'orthogonal', infinite: false, width: 24, height: 16, tilewidth: 16, tileheight: 16,
    tilesets: [{ firstgid: 1, source: 'atlas.tsj' }, { ...map.tilesets[0], firstgid: 289, name: 'details' }],
    layers: [
      { name: 'floor', type: 'tilelayer', width: 24, height: 16, data: Array.from({ length: 384 }, () => 1) },
      { name: 'artwork', type: 'group', layers: [
        { name: 'decorations', type: 'tilelayer', width: 24, height: 16, data: Array.from({ length: 384 }, () => 291), opacity: 0.5 },
      ] },
      { name: 'spawns', type: 'objectgroup', objects: [{ name: 'arrival', point: true, x: 96, y: 96 }] },
      { name: 'collisions', type: 'objectgroup', objects: [] },
      { name: 'interactions', type: 'objectgroup', objects: [{ name: 'return', class: 'Portal', x: 16, y: 64, width: 32, height: 64,
        properties: [{ name: 'targetMap', value: 'workspace' }, { name: 'targetSpawn', value: 'entry' }] }] },
    ],
  };
  writeFileSync(join(directory, 'studio.tmj'), JSON.stringify(studio));
  const registryPath = join(directory, 'registry.json');
  writeFileSync(registryPath, JSON.stringify({ maps: [
    { id: 'workspace', file: 'entry.tmj', defaultSpawn: 'entry' }, { id: 'studio', file: 'studio.tmj', defaultSpawn: 'arrival' },
  ], spaces: [{ id: 'main', name: 'Main', cover: '/maps/tiles.png', initialMap: 'workspace', maps: ['workspace', 'studio'] }, { id: 'other', name: 'Other', cover: '/maps/tiles.png', initialMap: 'studio', maps: ['workspace', 'studio'] }] }));
  return registryPath;
}
