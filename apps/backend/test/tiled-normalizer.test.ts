import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { normalizeTiledMap } from '../src/tiled-normalizer.js';

function makeMap(layers: unknown[], tilesets: unknown[] = []) {
  return { type: 'map', orientation: 'orthogonal', infinite: false, width: 8, height: 8, tilewidth: 16, tileheight: 16, layers, tilesets };
}

function objectLayer(objects: unknown[]) { return { name: 'objects', type: 'objectgroup', objects }; }

test('project custom classes expand defaults and preserve top-level typed property metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-normalizer-'));
  const mapPath = join(directory, 'map.tmj');
  const projectPath = join(directory, 'project.tiled-project');
  writeFileSync(projectPath, JSON.stringify({ propertyTypes: [
    { id: 1, name: 'Appearance', type: 'class', members: [
      { name: 'tone', type: 'string', value: 'warm' },
      { name: 'nested', type: 'class', propertytype: 'Nested', value: { visible: false } },
    ] },
    { id: 2, name: 'Nested', type: 'class', members: [
      { name: 'visible', type: 'bool', value: true },
      { name: 'deep', type: 'class', propertytype: 'Deep', value: { label: 'nested member' } },
    ] },
    { id: 4, name: 'Deep', type: 'class', members: [
      { name: 'label', type: 'string', value: 'deep default' }, { name: 'active', type: 'bool', value: true },
    ] },
    { id: 3, name: 'Actor', type: 'class', members: [
      { name: 'health', type: 'int', value: 5 },
      { name: 'appearance', type: 'class', propertytype: 'Appearance', value: { tone: 'actor default', nested: { deep: { active: false } } } },
    ] },
  ] }));
  const map = makeMap([objectLayer([{ id: 1, name: 'npc', class: 'Actor', x: 12, y: 16, width: 16, height: 16,
    properties: [{ name: 'health', type: 'int', value: 9 }, { name: 'appearance', type: 'class', propertytype: 'Appearance', value: { tone: 'cool', nested: { deep: { label: 'local' } } } }],
  }])]);
  const normalized = normalizeTiledMap(map, mapPath, projectPath);
  const npc = (normalized.layers as { objects: Record<string, unknown>[] }[])[0]?.objects[0];
  assert.ok(npc);
  assert.deepEqual(npc.properties, [
    { name: 'health', type: 'int', value: 9 },
    { name: 'appearance', type: 'class', propertytype: 'Appearance', value: { tone: 'cool', nested: { visible: false, deep: { label: 'local', active: false } } } },
  ]);
  assert.deepEqual(npc.typedProperties, {
    health: { type: 'int', value: 9 },
    appearance: { type: 'class', propertytype: 'Appearance', value: { tone: 'cool', nested: { visible: false, deep: { label: 'local', active: false } } } },
  });
});

test('class defaults normalize map, layer, tileset, tile, and typed tile-object properties', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-host-classes-'));
  const mapPath = join(directory, 'map.tmj');
  const projectPath = join(directory, 'project.tiled-project');
  writeFileSync(projectPath, JSON.stringify({ propertyTypes: [
    { name: 'MapDefaults', type: 'class', members: [{ name: 'mapFlag', type: 'bool', value: true }] },
    { name: 'LayerDefaults', type: 'class', members: [{ name: 'ySort', type: 'bool', value: true }, { name: 'abovePlayers', type: 'bool', value: false }] },
    { name: 'AtlasDefaults', type: 'class', members: [{ name: 'atlasName', type: 'string', value: 'decor' }] },
    { name: 'TileDefaults', type: 'class', members: [{ name: 'tileKind', type: 'string', value: 'leaf' }] },
  ] }));
  const map = {
    ...makeMap([
      { name: 'canopy', class: 'LayerDefaults', type: 'tilelayer', width: 1, height: 1, data: [1] },
      objectLayer([{ id: 11, name: 'canopy-object', class: 'action', gid: 1, x: 16, y: 32, width: 16, height: 16 }]),
    ], [{ firstgid: 1, name: 'decor', class: 'AtlasDefaults', image: 'atlas.png', tilewidth: 16, tileheight: 16, tilecount: 1,
      tiles: [{ id: 0, class: 'TileDefaults' }],
    }]),
    class: 'MapDefaults',
  };
  const normalized = normalizeTiledMap(map, mapPath, projectPath);
  assert.deepEqual(normalized.properties, [{ name: 'mapFlag', type: 'bool', value: true }]);
  const layers = normalized.layers as Record<string, unknown>[];
  assert.deepEqual(layers[0]?.properties, [
    { name: 'ySort', type: 'bool', value: true },
    { name: 'abovePlayers', type: 'bool', value: false },
  ]);
  const tilesets = normalized.tilesets as Record<string, unknown>[];
  assert.deepEqual(tilesets[0]?.properties, [{ name: 'atlasName', type: 'string', value: 'decor' }]);
  assert.deepEqual((tilesets[0]?.tiles as Record<string, unknown>[])[0]?.properties, [{ name: 'tileKind', type: 'string', value: 'leaf' }]);
  const object = (layers[1]?.objects as Record<string, unknown>[])[0];
  assert.ok(object);
  assert.deepEqual(object.properties, [{ name: 'tileKind', type: 'string', value: 'leaf' }]);
});

test('explicit property types reject malformed values while legacy untyped values remain compatible', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-property-types-'));
  const mapPath = join(directory, 'map.tmj');
  const invalidProperties = [
    { name: 'stringValue', type: 'string', value: 4 },
    { name: 'integerValue', type: 'int', value: 1.5 },
    { name: 'floatValue', type: 'float', value: Number.POSITIVE_INFINITY },
    { name: 'boolValue', type: 'bool', value: 1 },
    { name: 'colorValue', type: 'color', value: 'red' },
    { name: 'classValue', type: 'class', propertytype: 'Missing', value: [] },
    { name: 'listValue', type: 'list', value: [{ value: 3 }] },
  ];
  for (const property of invalidProperties) {
    const map = makeMap([objectLayer([{ id: 1, name: 'typed', x: 0, y: 0, properties: [property] }])]);
    assert.throws(() => normalizeTiledMap(map, mapPath));
  }
  const legacy = makeMap([objectLayer([{ id: 1, name: 'legacy', x: 0, y: 0, properties: [{ name: 'legacyNumeric', value: 5 }] }])]);
  assert.doesNotThrow(() => normalizeTiledMap(legacy, mapPath));
});

test('JSON object templates inherit geometry and properties, then allow instance overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-template-'));
  const mapPath = join(directory, 'map.tmj');
  mkdirSync(join(directory, 'templates'));
  const templatePath = join(directory, 'templates', 'entry.tj');
  writeFileSync(templatePath, JSON.stringify({ type: 'template', object: {
    id: 0, name: 'base-entry', class: 'web', x: 0, y: 0, width: 24, height: 32,
    properties: [{ name: 'resourceId', type: 'string', value: 'shared' }, { name: 'enabled', type: 'bool', value: true }],
  } }));
  const map = makeMap([objectLayer([{ id: 3, name: 'entry-a', x: 64, y: 80, template: 'templates/entry.tj',
    properties: [{ name: 'resourceId', type: 'string', value: 'local' }],
  }])]);
  const normalized = normalizeTiledMap(map, mapPath);
  const instance = (normalized.layers as { objects: Record<string, unknown>[] }[])[0]?.objects[0];
  assert.ok(instance);
  assert.equal(instance.id, 3);
  assert.equal(instance.name, 'entry-a');
  assert.equal(instance.class, 'web');
  assert.equal(instance.x, 64);
  assert.equal(instance.y, 80);
  assert.equal(instance.width, 24);
  assert.equal(instance.height, 32);
  assert.deepEqual(instance.properties, [
    { name: 'resourceId', type: 'string', value: 'local' },
    { name: 'enabled', type: 'bool', value: true },
  ]);
  assert.equal(instance.template, undefined);
});

test('template class aliases and partial class-property overrides follow the instance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-template-class-'));
  const mapPath = join(directory, 'map.tmj');
  const projectPath = join(directory, 'project.tiled-project');
  writeFileSync(projectPath, JSON.stringify({ propertyTypes: [
    { name: 'Config', type: 'class', members: [
      { name: 'a', type: 'int', value: 1 }, { name: 'b', type: 'int', value: 2 },
      { name: 'nested', type: 'class', propertytype: 'Nested', value: { label: 'default' } },
    ] },
    { name: 'Nested', type: 'class', members: [
      { name: 'label', type: 'string', value: 'nested default' }, { name: 'active', type: 'bool', value: true },
    ] },
  ] }));
  writeFileSync(join(directory, 'base.tj'), JSON.stringify({ type: 'template', object: {
    id: 0, name: 'base', class: 'web', x: 0, y: 0,
    properties: [{ name: 'config', type: 'class', propertytype: 'Config', value: { a: 10, b: 20, nested: { label: 'template' } } }],
  } }));
  const makeInstance = (classAlias: Record<string, unknown>) => makeMap([objectLayer([
    { id: 1, name: 'instance', x: 16, y: 16, template: 'base.tj', ...classAlias,
      properties: [{ name: 'config', type: 'class', propertytype: 'Config', value: { a: 30, nested: { label: 'instance' } } }],
    },
  ])]);
  for (const aliases of [{ type: 'Portal' }, { class: 'Portal' }]) {
    const normalized = normalizeTiledMap(makeInstance(aliases), mapPath, projectPath);
    const object = (normalized.layers as { objects: Record<string, unknown>[] }[])[0]?.objects[0];
    assert.ok(object);
    assert.equal(object.class, 'Portal');
    assert.equal(object.type, undefined);
    assert.deepEqual(object.properties, [{ name: 'config', type: 'class', propertytype: 'Config', value: {
      a: 30, b: 20, nested: { label: 'instance', active: true },
    } }]);
  }
});

test('template tile GIDs remap to the matching map tileset and references are validated', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-template-gid-'));
  const mapPath = join(directory, 'map.tmj');
  writeFileSync(join(directory, 'shared.tsj'), JSON.stringify({ type: 'tileset', name: 'shared', tilewidth: 16, tileheight: 16, tilecount: 8, columns: 8 }));
  const templatePath = join(directory, 'tile.tj');
  writeFileSync(templatePath, JSON.stringify({ type: 'template', tileset: { firstgid: 1, source: 'shared.tsj' }, object: {
    id: 0, name: 'tile', gid: 4, x: 0, y: 0, width: 16, height: 16,
  } }));
  const map = makeMap([objectLayer([
    { id: 3, name: 'tile-instance', x: 48, y: 64, template: 'tile.tj' },
    { id: 4, name: 'reference-owner', x: 0, y: 0, width: 0, height: 0,
      properties: [{ name: 'target', type: 'object', value: 3 }, { name: 'unset', type: 'object', value: 0 }] },
  ])], [{ firstgid: 101, source: 'shared.tsj' }]);
  const normalized = normalizeTiledMap(map, mapPath);
  const objects = (normalized.layers as { objects: Record<string, unknown>[] }[])[0]?.objects;
  assert.equal(objects?.[0]?.gid, 104);
  assert.deepEqual(objects?.[1]?.typedProperties, {
    target: { type: 'object', value: 3 }, unset: { type: 'object', value: 0 },
  });
  const invalid = makeMap([objectLayer([{ id: 1, name: 'bad-reference', x: 0, y: 0, width: 0, height: 0,
    properties: [{ name: 'target', type: 'object', value: 88 }],
  }])]);
  assert.throws(() => normalizeTiledMap(invalid, mapPath), /missing object 88/);
});

test('nested template GIDs are remapped once while an instance GID remains in map space', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-nested-template-gid-'));
  const mapPath = join(directory, 'map.tmj');
  mkdirSync(join(directory, 'templates'));
  writeFileSync(join(directory, 'shared.tsj'), JSON.stringify({ type: 'tileset', name: 'shared', tilewidth: 16, tileheight: 16, tilecount: 8, columns: 8 }));
  writeFileSync(join(directory, 'templates', 'base.tj'), JSON.stringify({ type: 'template',
    tileset: { firstgid: 1, source: '../shared.tsj' }, object: { id: 0, name: 'base', gid: 4, x: 0, y: 0, width: 16, height: 16 },
  }));
  writeFileSync(join(directory, 'templates', 'nested.tj'), JSON.stringify({ type: 'template',
    object: { template: 'base.tj' },
  }));
  const map = makeMap([objectLayer([
    { id: 1, name: 'inherited-tile', x: 16, y: 32, template: 'templates/nested.tj' },
    { id: 2, name: 'overridden-tile', x: 48, y: 64, template: 'templates/base.tj', gid: 106 },
  ])], [{ firstgid: 101, source: 'shared.tsj' }]);
  const normalized = normalizeTiledMap(map, mapPath);
  const objects = (normalized.layers as { objects: Record<string, unknown>[] }[])[0]?.objects;
  assert.equal(objects?.[0]?.gid, 104);
  assert.equal(objects?.[1]?.gid, 106);
});

test('object references inside class and list properties validate after template expansion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-nested-ref-'));
  const mapPath = join(directory, 'map.tmj');
  const projectPath = join(directory, 'project.tiled-project');
  writeFileSync(projectPath, JSON.stringify({ propertyTypes: [{ name: 'Links', type: 'class', members: [
    { name: 'target', type: 'object', value: 0 },
    { name: 'targets', type: 'list', value: [] },
  ] }] }));
  const objects = [
    { id: 7, name: 'source', x: 0, y: 0, properties: [
      { name: 'links', type: 'class', propertytype: 'Links', value: { target: 9, targets: [{ type: 'object', value: 9 }] } },
    ] },
    { id: 9, name: 'target', x: 16, y: 16 },
  ];
  assert.doesNotThrow(() => normalizeTiledMap(makeMap([objectLayer(objects)]), mapPath, projectPath));
  const bad = structuredClone(objects);
  const source = bad[0];
  assert.ok(source);
  const properties = source.properties as { value: { target: number; targets: { type: string; value: number }[] } }[];
  const links = properties[0];
  assert.ok(links);
  links.value.targets[0]!.value = 17;
  assert.throws(() => normalizeTiledMap(makeMap([objectLayer(bad)]), mapPath, projectPath), /missing object 17/);
});

test('cyclic templates and missing external files report the template path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-template-cycle-'));
  const mapPath = join(directory, 'map.tmj');
  writeFileSync(join(directory, 'a.tj'), JSON.stringify({ type: 'template', object: { template: 'b.tj' } }));
  writeFileSync(join(directory, 'b.tj'), JSON.stringify({ type: 'template', object: { template: 'a.tj' } }));
  const map = makeMap([objectLayer([{ id: 1, name: 'cycle', x: 0, y: 0, template: 'a.tj' }])]);
  assert.throws(() => normalizeTiledMap(map, mapPath), /Cyclic Tiled templates/);
  const missing = makeMap([objectLayer([{ id: 1, name: 'missing', x: 0, y: 0, template: 'missing.tj' }])]);
  assert.throws(() => normalizeTiledMap(missing, mapPath), /Unable to read Tiled template/);
});

test('atlas animation frames must be non-empty and reference valid local tile IDs with positive integer durations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiled-animation-'));
  const mapPath = join(directory, 'map.tmj');
  const tilesetPath = join(directory, 'atlas.tsj');
  const map = makeMap([], [{ firstgid: 1, source: 'atlas.tsj' }]);
  const setData = (animation: unknown) => writeFileSync(tilesetPath, JSON.stringify({
    type: 'tileset', name: 'atlas', image: 'atlas.png', tilecount: 4, tilewidth: 16, tileheight: 16,
    tiles: [{ id: 1, animation }],
  }));
  setData([{ tileid: 1, duration: 100 }, { tileid: 2, duration: 80 }]);
  assert.doesNotThrow(() => normalizeTiledMap(map, mapPath));
  for (const invalid of [[], [{ tileid: 4, duration: 100 }], [{ tileid: 1, duration: 0 }], [{ tileid: 1, duration: 2.5 }]]) {
    setData(invalid);
    assert.throws(() => normalizeTiledMap(map, mapPath), /Invalid atlas animation/);
  }
});
