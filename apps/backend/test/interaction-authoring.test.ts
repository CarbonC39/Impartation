import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorldMap } from '@virtual-workspace/shared';

type TiledObject = {
  id: number; name: string; class?: string; type?: string; x: number; y: number;
  width?: number; height?: number; point?: boolean; gid?: number;
  properties?: { name: string; value: unknown }[];
};

const properties = (values: Record<string, unknown>) => Object.entries(values).map(([name, value]) => ({ name, value }));
function makeMap(interactions: TiledObject[], targetObjects: TiledObject[] = []): { layers: unknown[]; [key: string]: unknown } {
  return {
    orientation: 'orthogonal', infinite: false, width: 20, height: 20, tilewidth: 16, tileheight: 16,
    tilesets: [{ firstgid: 1, name: 'test', tilecount: 200 }],
    layers: [
      { name: 'spawns', type: 'objectgroup', objects: [{ id: 1, name: 'entry', point: true, x: 32, y: 32 }] },
      { name: 'collisions', type: 'objectgroup', objects: [] },
      { name: 'decor', type: 'objectgroup', objects: targetObjects },
      { name: 'interactions', type: 'objectgroup', objects: interactions },
    ],
  };
}

function selector(id: number, targetObjectId: number, variants = 'computer,book,drawing-board', x = 48, y = 48): TiledObject {
  return { id, name: `selector-${id}`, class: 'variantSelector', point: true, x, y,
    properties: properties({ action: 'sit', offsetX: 2, targetObjectId, variants }) };
}
function target(id: number, x = 48, y = 64, variants: Record<string, number> = {
  computer: 100, book: 101, 'drawing-board': 102,
}, gid: number | null = 100): TiledObject {
  return { id, name: `decor-${id}`, x, y, width: 16, height: 16, ...(gid === null ? {} : { gid }),
    properties: properties(Object.fromEntries(Object.entries(variants).map(([name, gid]) => [`variant.${name}`, gid]))) };
}
function parse(interactions: TiledObject[], targets: TiledObject[] = []) {
  return parseWorldMap(makeMap(interactions, targets));
}

test('variant selectors resolve stable numeric Tiled IDs and zero-based local tile IDs normalized to GIDs', () => {
  const world = parse([selector(20, 90)], [target(90)]);
  assert.equal(world.selectors.length, 1);
  assert.deepEqual(world.selectors[0], {
    id: '20', kind: 'variantSelector', name: 'selector-20', x: 48, y: 48,
    action: 'sit', offsetX: 2, offsetY: 0, targetObjectId: '90',
    variants: ['computer', 'book', 'drawing-board'],
  });
  assert.deepEqual(world.variantTargets, [{ id: '90', x: 48, y: 48, width: 16, height: 16, gid: 100,
    variants: { computer: 101, book: 102, 'drawing-board': 103 } }]);
  assert.equal(world.actions.length, 0);
});

test('single variant and grouped layer offsets are preserved in world coordinates', () => {
  const raw = makeMap([selector(20, 90, 'computer', 16, 16)], [target(90, 16, 32, { computer: 100 })]);
  raw.layers = [
    raw.layers[0]!, raw.layers[1]!,
    { name: 'offset-group', type: 'group', offsetx: 16, offsety: 32, layers: [
      { name: 'decor', type: 'objectgroup', objects: [target(90, 16, 32, { computer: 100 })] },
      { name: 'interactions', type: 'objectgroup', objects: [selector(20, 90, 'computer', 16, 16)] },
    ] },
  ];
  const world = parseWorldMap(raw);
  assert.deepEqual([world.selectors[0]?.x, world.selectors[0]?.y], [32, 48]);
  assert.deepEqual([world.variantTargets[0]?.x, world.variantTargets[0]?.y], [32, 48]);
  assert.deepEqual(world.variantTargets[0]?.variants, { computer: 101 });
});

test('stable semantic IDs do not depend on authored names and ordinary zones retain custom properties', () => {
  const authored = [
    { id: 20, name: 'renamed-selector', class: 'variantSelector', point: true, x: 48, y: 48,
      properties: properties({ action: 'sit', targetObjectId: 90, variants: 'book' }) },
    { id: 21, name: 'renamed-wardrobe', class: 'wardrobe', x: 80, y: 80, width: 32, height: 16 },
    { id: 22, name: 'custom-zone', class: 'customZone', x: 128, y: 80, width: 32, height: 16,
      properties: properties({ theme: 'quiet', customFlag: true }) },
  ];
  const world = parse(authored, [target(90, 48, 64, { book: 102 })]);
  assert.equal(world.selectors[0]?.id, '20');
  assert.equal(world.zones.find(zone => zone.kind === 'wardrobe')?.id, '21');
  assert.deepEqual(world.zones.find(zone => zone.kind === 'customZone')?.properties,
    { theme: 'quiet', customFlag: true });
});

test('private areas are numeric-ID rectangles and reject overlap', () => {
  const world = parse([
    { id: 30, name: 'private-one', class: 'privateArea', x: 32, y: 64, width: 32, height: 32 },
    { id: 31, name: 'private-two', class: 'privateArea', x: 64, y: 64, width: 32, height: 32 },
  ]);
  assert.deepEqual(world.zones.filter(zone => zone.kind === 'privateArea').map(zone => zone.id), ['30', '31']);
  assert.throws(() => parse([
    { id: 30, name: 'one', class: 'privateArea', x: 32, y: 64, width: 32, height: 32 },
    { id: 31, name: 'overlap', class: 'privateArea', x: 48, y: 80, width: 32, height: 32 },
  ]), /Private areas must not overlap/);
});

test('attachment sources require known distinct IDs and the correct count for each mode', () => {
  const source = (mode: string, attachmentIds: string): TiledObject => ({
    id: 40, name: 'attachment-source', class: 'attachment', x: 32, y: 64, width: 32, height: 32,
    properties: properties({ mode, attachmentIds }),
  });
  assert.equal(parse([source('single-unique', 'party-crown')]).zones[0]?.kind, 'attachment');
  assert.equal(parse([source('multiple-unlimited-random', 'cookie,grape')]).zones[0]?.kind, 'attachment');
  for (const [mode, ids] of [
    ['single-unique', 'cookie,grape'], ['single-unlimited', 'unknown'],
    ['multiple-unlimited-random', 'cookie'], ['multiple-unlimited-random', 'cookie,cookie'],
  ]) assert.throws(() => parse([source(mode!, ids!)]));
  const visual = source('single-unique', 'party-crown');
  visual.properties!.push(...properties({ visualGid: 82, visualX: 64, visualY: 96 }));
  assert.equal(parse([visual]).zones[0]?.properties.visualGid, 82);
  assert.throws(() => parse([{ ...visual, properties: properties({ mode: 'single-unique', attachmentIds: 'party-crown', visualGid: 82 }) }]));
  assert.throws(() => parse([{ ...visual, properties: properties({ mode: 'single-unique', attachmentIds: 'party-crown', visualGid: 82, visualX: 63, visualY: 96 }) }]));
  assert.throws(() => parse([{ ...visual, properties: properties({ mode: 'single-unique', attachmentIds: 'party-crown', visualGid: 82, visualX: 320, visualY: 96 }) }]));
});

test('parser rejects malformed variant declarations and unresolved or invalid targets', () => {
  assert.throws(() => parse([selector(20, 90, 'computer,computer')], [target(90)]), /Variants must be unique/);
  assert.throws(() => parse([selector(20, 90)], []));
  assert.throws(() => parse([selector(20, 90)], [target(90, 48, 64, { computer: -2, book: 102, 'drawing-board': 103 })]));
  assert.throws(() => parse([selector(20, 90)], [target(90, 48, 64, { computer: 100 })]));
  assert.throws(() => parse([selector(20, 90)], [target(90), target(90)]), /Duplicate variant target Tiled ID/);
});

test('variant targets support transparent rectangle and tile defaults with distinct Tiled origins', () => {
  const rectangle = parse([selector(20, 90, 'computer')], [target(90, 48, 64, { computer: 100 }, null)]);
  assert.deepEqual(rectangle.variantTargets, [{ id: '90', x: 48, y: 64, width: 16, height: 16, gid: 0,
    variants: { computer: 101 } }]);

  const transparentTile = parse([selector(20, 90, 'computer')], [target(90, 48, 64, { computer: -1 }, 0)]);
  assert.deepEqual(transparentTile.variantTargets, [{ id: '90', x: 48, y: 48, width: 16, height: 16, gid: 0,
    variants: { computer: 0 } }]);

  const opaqueTile = parse([selector(20, 90, 'computer')], [target(90, 48, 64, { computer: 100 }, 100)]);
  assert.deepEqual([opaqueTile.variantTargets[0]?.x, opaqueTile.variantTargets[0]?.y, opaqueTile.variantTargets[0]?.gid], [48, 48, 100]);
});

test('zero local ID selects the first tile and minus one selects transparency', () => {
  const world = parse([selector(20, 90, 'computer,empty')], [target(90, 48, 64, { computer: 0, empty: -1 })]);
  assert.deepEqual(world.variantTargets[0]?.variants, { computer: 1, empty: 0 });
});

test('multiple tilesets require an explicit unambiguous variantTileset and validate local IDs', () => {
  const prop = target(90, 48, 64, { computer: 0, book: 6, empty: -1 });
  const raw = makeMap([selector(20, 90, 'computer,book,empty')], [prop]);
  raw.tilesets = [{ firstgid: 1, name: 'floor', tilecount: 12 }, { firstgid: 101, name: 'props', tilecount: 72 }];
  assert.throws(() => parseWorldMap(raw), /variantTileset/);
  prop.properties!.push({ name: 'variantTileset', value: 'props' });
  assert.deepEqual(parseWorldMap(raw).variantTargets[0]?.variants, { computer: 101, book: 107, empty: 0 });
  prop.properties!.find(property => property.name === 'variant.computer')!.value = 72;
  assert.throws(() => parseWorldMap(raw));
  prop.properties!.find(property => property.name === 'variant.computer')!.value = 0;
  prop.properties!.find(property => property.name === 'variantTileset')!.value = 'missing';
  assert.throws(() => parseWorldMap(raw), /variantTileset/);
  prop.properties!.find(property => property.name === 'variantTileset')!.value = 3;
  assert.throws(() => parseWorldMap(raw));
});

test('variant targets reject invalid or missing variant GID bindings and unsupported shapes', () => {
  for (const invalid of [-2, 1.5]) {
    assert.throws(() => parse([selector(20, 90, 'computer')], [target(90, 48, 64, { computer: invalid })]));
  }
  assert.throws(() => parse([selector(20, 90, 'computer,book')], [target(90, 48, 64, { computer: 100 })]));
  for (const shape of [
    { point: true }, { ellipse: true }, { polygon: [{ x: 0, y: 0 }] }, { rotation: 45 },
  ]) {
    assert.throws(() => parse([selector(20, 90, 'computer')], [{ ...target(90, 48, 64, { computer: 100 }), ...shape }]));
  }
});

test('parser rejects duplicate action anchors and multiple selectors claiming one target', () => {
  assert.throws(() => parse([
    selector(20, 90),
    { id: 21, name: 'sit-anchor', class: 'action', point: true, x: 49, y: 49,
      properties: properties({ action: 'sit' }) },
  ], [target(90)]), /Only one anchor per action and grid tile/);
  assert.throws(() => parse([selector(20, 90), selector(21, 90, 'computer', 64, 48)], [target(90)]),
    /Variant targets must have one selector/);
});

test('semantic properties reject duplicate keys, invalid shapes, and invalid wardrobe definitions', () => {
  assert.throws(() => parse([{ ...selector(20, 90), point: false, width: 16, height: 16 }], [target(90)]), /Variant selectors must be points/);
  assert.throws(() => parse([{ id: 20, name: 'wardrobe', class: 'wardrobe', x: 80, y: 80, width: 32, height: 16,
    properties: [{ name: 'unexpected', value: true }, { name: 'unexpected', value: false }] }]), /Duplicate semantic property/);
  assert.throws(() => parse([{ ...selector(20, 90), properties: [
    { name: 'action', value: 'sit' }, { name: 'action', value: 'sit' },
    { name: 'targetObjectId', value: 90 }, { name: 'variants', value: 'computer' },
  ] }]), /Duplicate semantic property/);
  assert.throws(() => parse([selector(20, 90)], [{ ...target(90), properties: [
    { name: 'variant.computer', value: 101 }, { name: 'variant.computer', value: 102 },
    { name: 'variant.book', value: 102 }, { name: 'variant.drawing-board', value: 103 },
  ] }]), /Duplicate target property/);
});
