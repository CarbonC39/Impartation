import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { attachmentSource, mapRegistrySchema, parseWorldMap, validateWorldRegistry, type WorldRegistry } from '@impartation/shared';
import { config } from './config.js';
import { normalizeTiledMap, normalizeTiledTileset, resolveTiledProject } from './tiled-normalizer.js';

const jsonObject = z.record(z.string(), z.unknown());
const tilesetReference = z.object({ firstgid: z.number().int().positive(), source: z.string().optional() }).passthrough();
const tilesetImages = z.object({
  image: z.string().optional(), tiles: z.array(z.object({ image: z.string().optional() }).passthrough()).optional(),
}).passthrough();

/** Resolve render assets independently of authoritative geometry validation. */
export function loadWorldRegistry(path: string) {
  const input = mapRegistrySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const projectPath = resolveTiledProject(path, input.project);
  const renderMaps = new Map<string, Record<string, unknown>>();
  const assets = new Map<string, string>();
  const registry: WorldRegistry = { spaces: input.spaces, maps: input.maps.map(entry => {
    const file = resolve(dirname(path), entry.file);
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const render = normalizeTiledMap(raw, file, projectPath);
    const base = `/api/maps/${encodeURIComponent(entry.id)}`;
    let assetIndex = 0;
    const asset = (value: string, directory: string) => {
      const key = `${entry.id}/${assetIndex++}`;
      assets.set(key, resolve(directory, value));
      return `${base}/assets/${key.slice(key.lastIndexOf('/') + 1)}`;
    };
    const references = z.array(tilesetReference).parse(render.tilesets ?? []);
    render.tilesets = references.map(reference => {
      const sourceFile = reference.source ? resolve(dirname(file), reference.source) : file;
      const rawTileset = reference.source ? JSON.parse(readFileSync(sourceFile, 'utf8')) : reference;
      const data = tilesetImages.parse(normalizeTiledTileset(rawTileset, sourceFile, projectPath));
      delete data.source;
      if (data.image) data.image = asset(data.image, dirname(sourceFile));
      if (data.tiles) data.tiles = data.tiles.map(tile => tile.image ? { ...tile, image: asset(tile.image, dirname(sourceFile)) } : tile);
      return { ...data, firstgid: reference.firstgid };
    });
    // External JSON tilesets must be expanded before resolving authored local variant tile IDs.
    const world = parseWorldMap(render);
    if (world.variantTargets.length || world.zones.some(zone => zone.kind === 'attachment' && attachmentSource(zone).visualGid !== undefined)) {
      const atlases = z.array(z.object({
        firstgid: z.number().int().positive(), tilecount: z.number().int().positive().optional(),
        tilewidth: z.number().int().positive().optional(), tileheight: z.number().int().positive().optional(),
        image: z.string().optional(), objectalignment: z.string().optional(),
      })).parse(render.tilesets);
      for (const target of world.variantTargets) for (const gid of [target.gid, ...Object.values(target.variants)]) {
        if (gid === 0) continue;
        const atlas = atlases.filter(set => set.firstgid <= gid).sort((a, b) => b.firstgid - a.firstgid)[0];
        if (!atlas?.image || !atlas.tilecount || !atlas.tilewidth || !atlas.tileheight || gid >= atlas.firstgid + atlas.tilecount ||
          (atlas.objectalignment !== undefined && !['unspecified', 'bottomleft'].includes(atlas.objectalignment)))
          throw new Error(`Variant target ${target.id} requires an atlas tile GID with bottom-left alignment: ${gid}`);
      }
      for (const zone of world.zones.filter(zone => zone.kind === 'attachment')) {
        const gid = attachmentSource(zone).visualGid;
        if (gid === undefined) continue;
        const atlas = atlases.filter(set => set.firstgid <= gid).sort((a, b) => b.firstgid - a.firstgid)[0];
        if (!atlas?.image || !atlas.tilecount || !atlas.tilewidth || !atlas.tileheight || gid >= atlas.firstgid + atlas.tilecount)
          throw new Error(`Attachment source ${zone.id} requires an atlas tile GID: ${gid}`);
      }
    }
    // Image layers can appear anywhere, including groups. Other Tiled metadata is retained.
    const rewriteLayers = (layers: unknown[]): unknown[] => layers.map(value => {
      const layer = jsonObject.parse(value);
      if (typeof layer.image === 'string') layer.image = asset(layer.image, dirname(file));
      if (Array.isArray(layer.layers)) layer.layers = rewriteLayers(layer.layers);
      return layer;
    });
    if (Array.isArray(render.layers)) render.layers = rewriteLayers(render.layers);
    renderMaps.set(entry.id, render);
    return { id: entry.id, defaultSpawn: entry.defaultSpawn, url: `${base}/map.json`, world };
  }) };
  return { registry: validateWorldRegistry(registry), renderMaps, assets };
}

export const { registry: worldRegistry, renderMaps, assets: worldAssets } = loadWorldRegistry(config.MAP_REGISTRY_PATH);
export const worlds = new Map(worldRegistry.maps.map(map => [map.id, map]));
