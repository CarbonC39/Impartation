import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, beforeEach, after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type Room } from '@colyseus/sdk';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { DEFAULT_APPEARANCE, occupancySchema, type SpaceProtocol } from '@impartation/shared';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';

const directory = mkdtempSync(join(tmpdir(), 'impartation-navigation-'));
const props = (values: Record<string, unknown>) => Object.entries(values).map(([name, value]) => ({ name, value }));
const portal = (name: string, targetMap: string) => ({ name, class: 'Portal', x: 80, y: 32, width: 32, height: 32,
  properties: props({ targetMap, targetSpawn: 'entry' }) });
for (const id of ['home', 'studio', 'locked', 'foreign']) {
  writeFileSync(join(directory, `${id}.tmj`), JSON.stringify({
    orientation: 'orthogonal', infinite: false, width: 20, height: 20, tilewidth: 16, tileheight: 16,
    tilesets: [{ firstgid: 1, name: 'tiles', tilewidth: 16, tileheight: 16, columns: 6, tilecount: 36,
      image: fileURLToPath(new URL('../../../assets/maps/tiles.png', import.meta.url)) }],
    layers: [
      { name: 'floor', type: 'tilelayer', width: 20, height: 20, data: Array(400).fill(1) },
      { name: 'spawns', type: 'objectgroup', objects: [{ name: 'entry', point: true, x: 32, y: 32 }] },
      { name: 'collisions', type: 'objectgroup', objects: id === 'studio' ? [{ x: 48, y: 16, width: 16, height: 48 }] : [] },
      { name: 'interactions', type: 'objectgroup', objects: id === 'home' ? [portal('door', 'studio'),
        { name: 'desk', class: 'web', x: 16, y: 16, width: 32, height: 32, properties: props({ resourceId: 'web' }) },
        { name: 'seat', class: 'action', point: true, x: 88, y: 40, properties: props({ action: 'sit', facing: 'left' }) },
      ] : id === 'studio' ? [portal('return', 'home')] : id === 'locked' ? [
        { id: 30, name: 'private', class: 'privateArea', x: 16, y: 16, width: 64, height: 64 },
      ] : [] },
    ],
  }));
}
writeFileSync(join(directory, 'registry.json'), JSON.stringify({
  maps: ['home', 'studio', 'locked', 'foreign'].map(id => ({ id, file: `${id}.tmj`, defaultSpawn: 'entry' })),
  spaces: [
    { id: 'main', name: 'Main', cover: '/maps/tiles.png', initialMap: 'home', maps: ['home', 'studio', 'locked'] },
    { id: 'other', name: 'Other', cover: '/maps/tiles.png', initialMap: 'foreign', maps: ['foreign', 'home', 'studio'] },
  ],
}));
process.env.MAP_REGISTRY_PATH = join(directory, 'registry.json');
process.env.DATABASE_PATH = ':memory:';
process.env.SPACE_MAX_CLIENTS = '5';
process.env.EXTERNAL_TOOLS = '{}';
const { server } = await import('../src/app.config.js');
const { db } = await import('../src/db.js');
const endpoint = 'http://127.0.0.1:2568';
let harness: ColyseusTestServer<typeof server>;
let connections: Room<SpaceProtocol>[] = [];
before(async () => { harness = await boot(server); });
beforeEach(async () => {
  await Promise.all(connections.filter(room => room.connection.isOpen).map(room => room.leave()));
  connections = [];
  await harness.cleanup();
});
after(async () => {
  await Promise.all(connections.filter(room => room.connection.isOpen).map(room => room.leave()));
  await harness.shutdown(); db.close(); rmSync(directory, { recursive: true, force: true });
});
async function connect(spaceId = 'main', cookie?: string) {
  if (!cookie) {
    const response = await fetch(endpoint + '/api/register', { method: 'POST',
      headers: { Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `nav_${randomUUID().replaceAll('-', '').slice(0, 16)}`, password: 'password1234', displayName: 'Traveler' }) });
    assert.equal(response.status, 200);
    cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  }
  const sdk = new Client(endpoint, { headers: { Cookie: cookie } });
  const room = await sdk.joinOrCreate<SpaceProtocol>('space', { name: 'Traveler', avatar: 'mint', appearance: DEFAULT_APPEARANCE, spaceId });
  room.onMessage('chat', () => {});
  await room.waitForInitialState(); connections.push(room);
  return { room, sdk, cookie };
}
const occupancy = async () => occupancySchema.parse(await (await fetch(endpoint + '/api/occupancy')).json());
async function until(condition: () => boolean) {
  const end = Date.now() + 3000;
  while (!condition()) { assert.ok(Date.now() < end, 'Timed out waiting for authoritative state'); await delay(10); }
}

test('occupancy includes empty Spaces/maps and counts only authoritative online players per Space', async () => {
  const response = await fetch(endpoint + '/api/occupancy');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.deepEqual(occupancySchema.parse(await response.json()), { spaces: [
    { id: 'main', online: 0, capacity: 5, maps: [{ id: 'home', online: 0 }, { id: 'studio', online: 0 }, { id: 'locked', online: 0 }] },
    { id: 'other', online: 0, capacity: 5, maps: [{ id: 'foreign', online: 0 }, { id: 'home', online: 0 }, { id: 'studio', online: 0 }] },
  ] });
  const { room: alice, sdk, cookie } = await connect();
  const { room: bob } = await connect();
  const { room: carol } = await connect('other');
  const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
  const player = authoritative.state.players.get(alice.sessionId)!;
  const initial = await occupancy();
  assert.deepEqual(initial.spaces.map(space => space.online), [2, 1]);
  assert.equal((await alice.request('quickTravel', { mapId: 'studio' })).ok, true);
  assert.deepEqual((await occupancy()).spaces[0]!.maps.map(map => map.online), [1, 1, 0]);
  // Different Spaces may share a map definition without sharing players/counts.
  assert.equal((await carol.request('quickTravel', { mapId: 'studio' })).ok, true);
  assert.deepEqual((await occupancy()).spaces.map(space => space.maps.find(map => map.id === 'studio')!.online), [1, 1]);
  const token = alice.reconnectionToken;
  alice.reconnection.enabled = false;
  authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
  await until(() => !player.connected);
  assert.equal(authoritative.state.players.size, 2, 'dropped seat is retained');
  assert.equal((await occupancy()).spaces[0]!.online, 1, 'dropped player is not online');
  const restored = await sdk.reconnect<SpaceProtocol>(token);
  restored.onMessage('chat', () => {}); await restored.waitForInitialState(); connections.push(restored);
  assert.equal(restored.sessionId, alice.sessionId);
  assert.equal((await occupancy()).spaces[0]!.online, 2);
  const { room: replacement } = await connect('main', cookie);
  await until(() => !authoritative.state.players.has(restored.sessionId));
  assert.equal((await occupancy()).spaces[0]!.online, 2, 'takeover never adds a duplicate account seat');
  await bob.leave(); await replacement.leave();
  await until(() => authoritative.state.players.size === 0);
  assert.equal((await occupancy()).spaces[0]!.online, 0);
});

test('quick travel preserves session, uses default spawn, rejects foreign maps and releases transient state', async () => {
  const { room } = await connect(); const { room: observer } = await connect();
  const authoritative = harness.getRoomById<SpaceRoom>(room.roomId);
  const player = authoritative.state.players.get(room.sessionId)!;
  const other = authoritative.state.players.get(observer.sessionId)!;
  const userId = player.userId;
  assert.equal(player.mapId, 'home', 'normal joins start at initialMap');
  assert.equal((await room.request('quickTravel', { mapId: 'foreign' })).ok, false);
  assert.equal((await room.request('quickTravel', { mapId: 'missing' })).ok, false);
  assert.equal((await room.request('quickTravel', { mapId: 'home' })).ok, false);
  room.send('webTool', { open: true }); room.send('typing', { typing: true });
  await until(() => Boolean(player.webToolZone) && player.typing);
  const forged = { mapId: 'studio', sessionId: observer.sessionId, x: 200, y: 200, targetSpawn: 'missing' };
  assert.equal((await room.request('quickTravel', forged)).ok, true);
  assert.deepEqual([player.mapId, player.x, player.y], ['studio', 32, 32]);
  assert.equal(player.userId, userId); assert.equal(player.connected, true);
  assert.equal(other.mapId, 'home'); assert.equal(player.webToolZone, ''); assert.equal(player.typing, false);
  room.send('input', { x: 1, y: 0 }); await delay(200);
  assert.ok(player.x <= 42, 'destination map collision is enforced');
  room.send('input', { x: 0, y: 0 }); await delay(350);
  // Physical Portals remain usable after menu travel.
  player.x = 88; player.y = 40;
  assert.equal((await room.request('portal', { zoneId: 'return' })).ok, true);
  assert.equal(player.mapId, 'home');
  player.x = 88; player.y = 40; player.facing = 'left'; await delay(510);
  assert.equal((await room.request('activateAction', { action: 'sit' })).ok, true);
  assert.equal(authoritative.state.worldObjects.get('home')!.objects.get('seat')!.occupiedBy, room.sessionId);
  await delay(510);
  assert.equal((await room.request('quickTravel', { mapId: 'studio' })).ok, true);
  assert.equal(player.action, 'none'); assert.equal(player.motion, 'idle');
  assert.equal(authoritative.state.worldObjects.get('home')!.objects.get('seat')!.occupiedBy, '');
  assert.equal(authoritative['movementInputs'].has(room.sessionId), false);
});

test('quick travel enforces locked destination spawn admission and clears private membership on departure', async () => {
  const { room: alice } = await connect(); const { room: bob } = await connect();
  const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
  assert.equal((await bob.request('quickTravel', { mapId: 'locked' })).ok, true);
  await delay(510);
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
  const player = authoritative.state.players.get(alice.sessionId)!;
  assert.equal((await alice.request('quickTravel', { mapId: 'locked' })).ok, false);
  assert.equal(player.mapId, 'home');
  await delay(510);
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'addMember', playerId: alice.sessionId })).ok, true);
  assert.equal((await alice.request('quickTravel', { mapId: 'locked' })).ok, true);
  const area = authoritative.state.privateAreas.get('locked')!.areas.get('30')!;
  assert.equal(area.members.get(alice.sessionId), true);
  await delay(510);
  assert.equal((await alice.request('quickTravel', { mapId: 'studio' })).ok, true);
  assert.equal(area.members.has(alice.sessionId), false); assert.equal(player.privateAreaId, '');
  await delay(510);
  assert.equal((await alice.request('quickTravel', { mapId: 'locked' })).ok, false, 'exit revoked re-entry permission');
});
