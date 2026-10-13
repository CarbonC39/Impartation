import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Client, type Room } from '@colyseus/sdk';
import { worldRegistryResponseSchema, type SpaceProtocol } from '@virtual-workspace/shared';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';

const directory = mkdtempSync(join(tmpdir(), 'workspace-maps-'));
const portal = (name: string, targetMap: string, targetSpawn: string) => ({
  name, class: 'Portal', x: 80, y: 32, width: 32, height: 32,
  properties: [{ name: 'targetMap', value: targetMap }, { name: 'targetSpawn', value: targetSpawn }],
});
const makeMap = (spawnName: string, zones: unknown[], collisions: unknown[] = []) => ({
  orientation: 'orthogonal', infinite: false, width: 16, height: 12, tilewidth: 16, tileheight: 16,
  tilesets: [{ firstgid: 1, source: 'atlas.tsj' }, { firstgid: 13, name: 'decorations', image: fileURLToPath(new URL('../../../assets/maps/tiles.png', import.meta.url)), tilewidth: 16, tileheight: 16, columns: 6, tilecount: 12 }],
  layers: [
    { name: 'floor', type: 'tilelayer', width: 16, height: 12, data: Array.from({ length: 192 }, () => 1) },
    { name: 'details', type: 'tilelayer', width: 16, height: 12, data: Array.from({ length: 192 }, () => 13) },
    { name: 'spawns', type: 'objectgroup', objects: [{ name: spawnName, point: true, x: 32, y: 32 }] },
    { name: 'collisions', type: 'objectgroup', objects: collisions },
    { name: 'interactions', type: 'objectgroup', objects: zones },
  ],
});
writeFileSync(join(directory, 'atlas.tsj'), JSON.stringify({ name: 'atlas', image: fileURLToPath(new URL('../../../assets/maps/tiles.png', import.meta.url)), tilewidth: 16, tileheight: 16, columns: 6, tilecount: 12 }));
const seat = { name: 'same-seat', class: 'seat', point: true, x: 88, y: 40,
  properties: [{ name: 'facing', value: 'left' }] };
writeFileSync(join(directory, 'home.tmj'), JSON.stringify(makeMap('entry', [portal('door', 'studio', 'arrival'), seat])));
writeFileSync(join(directory, 'studio.tmj'), JSON.stringify(makeMap('arrival', [portal('return', 'home', 'entry'), seat], [{ x: 48, y: 16, width: 16, height: 48 }])));
writeFileSync(join(directory, 'registry.json'), JSON.stringify({ initialMap: 'home', maps: [
  { id: 'home', file: 'home.tmj', defaultSpawn: 'entry' }, { id: 'studio', file: 'studio.tmj', defaultSpawn: 'arrival' },
] }));
process.env.DATABASE_PATH = ':memory:';
process.env.EXTERNAL_TOOLS = '{}';
process.env.MAP_REGISTRY_PATH = join(directory, 'registry.json');
const { server } = await import('../src/app.config.js');
const { db } = await import('../src/db.js');
const { loadWorldRegistry } = await import('../src/world.js');
const endpoint = 'http://127.0.0.1:2568';
let harness: ColyseusTestServer<typeof server>;
const connections: Room<SpaceProtocol>[] = [];
before(async () => { harness = await boot(server); });
after(async () => {
  await Promise.all(connections.filter(room => room.connection.isOpen).map(room => room.leave()));
  await harness.shutdown(); db.close(); rmSync(directory, { recursive: true, force: true });
});
async function connect(name: string) {
  const response = await fetch(endpoint + '/api/auth/sign-in/anonymous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
  const room = await new Client(endpoint, { headers: { Cookie: cookie } }).joinOrCreate<SpaceProtocol>('space', { name, avatar: 'mint' });
  room.onMessage('chat', () => {});
  await room.waitForInitialState(); connections.push(room);
  return room;
}

test('world API publishes the registered Tiled source, multiple layers and resolved external TSJ assets', async () => {
  const response = await fetch(endpoint + '/api/world');
  assert.deepEqual(response.headers.getSetCookie(), []);
  const registry = worldRegistryResponseSchema.parse(await response.json());
  assert.equal(registry.initialMap, 'home');
  assert.deepEqual(registry.maps.map(map => [map.id, map.defaultSpawn]), [['home', 'entry'], ['studio', 'arrival']]);
  const render = await (await fetch(endpoint + registry.maps[0].url)).json() as { layers: { name: string }[]; tilesets: { image: string; source?: string }[] };
  assert.deepEqual(render.layers.slice(0, 2).map(layer => layer.name), ['floor', 'details']);
  assert.equal(render.tilesets.length, 2);
  assert.equal(render.tilesets[0].source, undefined);
  for (const tileset of render.tilesets) assert.equal((await fetch(endpoint + tileset.image)).status, 200);
  assert.equal((await fetch(endpoint + '/api/maps/home/assets/999')).status, 404);
  assert.equal((await fetch(endpoint + '/api/maps/unknown/map.json')).status, 404);
});

test('Portal uses authenticated server position and named destination, preserves identity and connection', async () => {
  const alice = await connect('Traveler');
  const bob = await connect('Observer');
  const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
  const player = authoritative.state.players.get(alice.sessionId)!;
  const other = authoritative.state.players.get(bob.sessionId)!;
  assert.equal(player.mapId, 'home');
  assert.deepEqual([player.x, player.y], [32, 32]);
  const identity = player.userId;
  assert.equal((await alice.request('portal', { zoneId: 'door' })).ok, false);
  player.x = 88; player.y = 40;
  assert.equal((await alice.request('portal', { zoneId: 'return' })).ok, false);
  // The schema strips forged destination/session fields; only the server map controls them.
  const forged = { zoneId: 'door', targetMap: 'home', targetSpawn: 'missing', sessionId: bob.sessionId };
  assert.equal((await alice.request('portal', forged)).ok, true);
  assert.equal(player.mapId, 'studio'); assert.equal(other.mapId, 'home');
  assert.deepEqual([player.x, player.y], [32, 32]);
  assert.equal(player.userId, identity); assert.equal(player.connected, true);
  await new Promise<void>(resolve => alice.onStateChange.once(() => resolve()));
  assert.equal(alice.state.players.get(alice.sessionId)?.mapId, 'studio');
  const received = new Promise<string>(resolve => bob.onMessage('chat', message => resolve(message.text)));
  alice.send('chat', { text: 'same room after transition' });
  assert.equal(await received, 'same room after transition');
  alice.send('input', { x: 1, y: 0 });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(player.x <= 42, 'movement must collide with the destination map wall');
  assert.equal((await alice.request('boardPost', { resourceId: 'message-wall', text: 'not on this map' })).ok, false);
});

test('object ids are scoped by map and a Portal releases the old seat and action', async () => {
  const alice = await connect('SeatedTraveler');
  const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
  const player = authoritative.state.players.get(alice.sessionId)!;
  player.x = 88; player.y = 40;
  assert.equal((await alice.request('activateAction', { action: 'sit', animated: true })).ok, true);
  const homeSeat = authoritative.state.worldObjects.get('home')!.objects.get('same-seat')!;
  const studioSeat = authoritative.state.worldObjects.get('studio')!.objects.get('same-seat')!;
  assert.equal(homeSeat.occupiedBy, alice.sessionId); assert.equal(studioSeat.occupiedBy, '');
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal((await alice.request('portal', { zoneId: 'door' })).ok, true);
  assert.equal(player.mapId, 'studio'); assert.equal(player.action, 'none');
  assert.equal(player.actionTargetId, ''); assert.equal(player.motion, 'idle');
  assert.equal(player.actionAnimated, false);
  assert.equal(homeSeat.occupiedBy, ''); assert.equal(homeSeat.variant, 'empty');
  assert.equal(studioSeat.occupiedBy, '');
});

test('registry loader rejects unresolved destinations before exposing maps', () => {
  const file = join(directory, 'broken.json');
  writeFileSync(file, JSON.stringify({ initialMap: 'home', maps: [{ id: 'home', file: 'home.tmj', defaultSpawn: 'entry' }] }));
  assert.throws(() => loadWorldRegistry(file), /Portal/);
});
