import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { ATTACHMENTS, DEFAULT_APPEARANCE, PRIVATE_AREA_IDLE_MS, attachmentSourceKey, type SpaceProtocol } from '@impartation/shared';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';

const directory = mkdtempSync(join(tmpdir(), 'workspace-interactions-'));
const props = (values: Record<string, unknown>) => Object.entries(values).map(([name, value]) => ({ name, value }));
const selector = (id: number, x: number, target: number, variants = 'computer,book,drawing-board') => ({
  id, name: `seat-${id}`, class: 'variantSelector', point: true, x, y: 64,
  properties: props({ action: 'sit', facing: 'up', targetObjectId: target, variants }),
});
const makeMap = () => ({
  orientation: 'orthogonal', infinite: false, width: 20, height: 20, tilewidth: 16, tileheight: 16,
  tilesets: [{ firstgid: 1, name: 'tiles', image: fileURLToPath(new URL('../../../assets/maps/tiles.png', import.meta.url)), tilewidth: 16, tileheight: 16, tilecount: 36, columns: 6 }],
  layers: [
    { name: 'floor', type: 'tilelayer', width: 20, height: 20, data: Array(400).fill(1) },
    { name: 'spawns', type: 'objectgroup', objects: [{ id: 1, name: 'entry', point: true, x: 32, y: 32 },
      { id: 2, name: 'private', point: true, x: 176, y: 160 }] },
    { name: 'collisions', type: 'objectgroup', objects: [] },
    { name: 'decor', type: 'objectgroup', objects: [90, 91, 92].map((id, index) => ({
      id, name: `target-${id}`, x: 64 + index * 32, y: 48, width: 16, height: 16, gid: 1,
      properties: props({ 'variant.computer': 1, 'variant.book': 2, 'variant.drawing-board': 3 }),
    })) },
    { name: 'interactions', type: 'objectgroup', objects: [selector(20, 64, 90), selector(21, 96, 91, 'book'),
      { ...selector(22, 80, 92, 'book'), properties: props({ action: 'sit', facing: 'down', targetObjectId: 92, variants: 'book' }) },
      { id: 30, name: 'quiet', class: 'privateArea', x: 144, y: 128, width: 96, height: 96 },
      { id: 31, name: 'mirror', class: 'wardrobe', x: 160, y: 176, width: 32, height: 32 },
      { id: 40, name: 'door', class: 'Portal', x: 272, y: 32, width: 32, height: 32,
        properties: props({ targetMap: 'studio', targetSpawn: 'private' }) },
      { id: 42, name: 'local-door', class: 'Portal', x: 272, y: 80, width: 32, height: 32,
        properties: props({ targetMap: 'home', targetSpawn: 'private' }) },
      { id: 43, name: 'local-exit', class: 'Portal', x: 272, y: 128, width: 32, height: 32,
        properties: props({ targetMap: 'home', targetSpawn: 'entry' }) },
      { id: 41, name: 'offset-entry', class: 'action', point: true, x: 136, y: 160,
        properties: props({ action: 'sit', offsetX: 16 }) },
      { id: 50, name: 'drink', class: 'attachment', x: 32, y: 96, width: 24, height: 24,
        properties: props({ mode: 'single-unlimited', attachmentIds: 'punch' }) },
      { id: 51, name: 'crown', class: 'attachment', x: 64, y: 96, width: 24, height: 24,
        properties: props({ mode: 'single-unique', attachmentIds: 'party-crown' }) },
      { id: 52, name: 'food', class: 'attachment', x: 96, y: 96, width: 24, height: 24,
        properties: props({ mode: 'multiple-unlimited-random', attachmentIds: 'cookie,grape,guava,cheese,ham' }) },
    ] },
  ],
});
for (const id of ['home', 'studio']) writeFileSync(join(directory, `${id}.tmj`), JSON.stringify(makeMap()));
writeFileSync(join(directory, 'registry.json'), JSON.stringify({ maps: ['home', 'studio'].map(id => ({ id, file: `${id}.tmj`, defaultSpawn: 'entry' })), spaces: [{ id: 'main', name: 'Main', cover: '/maps/tiles.png', initialMap: 'home', maps: ['home', 'studio'] }, { id: 'other', name: 'Other', cover: '/maps/tiles.png', initialMap: 'studio', maps: ['home', 'studio'] }] }));
process.env.SPACE_MAX_CLIENTS = '3';
process.env.DATABASE_PATH = ':memory:';
process.env.EXTERNAL_TOOLS = '{}';
process.env.MAP_REGISTRY_PATH = join(directory, 'registry.json');
const { server } = await import('../src/app.config.js');
const { db } = await import('../src/db.js');
const { loadWorldRegistry, worlds } = await import('../src/world.js');
const endpoint = 'http://127.0.0.1:2568';
let harness: ColyseusTestServer<typeof server>;
let connections: Room<SpaceProtocol>[] = [];
before(async () => { harness = await boot(server); });
beforeEach(async () => {
  await Promise.all(connections.filter(room => room.connection.isOpen).map(room => room.leave())); connections = [];
  await harness.cleanup();
});
after(async () => {
  await Promise.all(connections.filter(room => room.connection.isOpen).map(room => room.leave()));
  await harness.shutdown(); db.close(); rmSync(directory, { recursive: true, force: true });
});
async function connect(name: string, spaceId = 'main') {
  const response = await fetch(endpoint + '/api/register', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `scene_${randomUUID().replaceAll('-', '').slice(0, 16)}`, password: 'password1234', displayName: name }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const room = await new Client(endpoint, { headers: { Cookie: cookie } }).joinOrCreate<SpaceProtocol>('space', { name, avatar: 'mint', appearance: DEFAULT_APPEARANCE, spaceId });
  room.onMessage('chat', () => {}); room.onError(() => {}); room.reconnection.minUptime = 0;
  await room.waitForInitialState(); connections.push(room); return room;
}
async function until(predicate: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out waiting for state'); await delay(10); }
}
const pause = () => delay(510);
function roomFor(client: Room<SpaceProtocol>) { return harness.getRoomById<SpaceRoom>(client.roomId); }

test('attachments replace without changing actions; unique claims are released and random sources stay available', async () => {
  const alice = await connect('Alice'); const bob = await connect('Bob');
  const room = roomFor(alice);
  const a = room.state.players.get(alice.sessionId)!; const b = room.state.players.get(bob.sessionId)!;
  const place = (player: typeof a, x: number) => { player.x = x; player.y = 104; };
  place(a, 40); place(b, 40);
  assert.equal((await alice.request('takeAttachment', { sourceId: 'drink' })).ok, true);
  assert.equal((await bob.request('takeAttachment', { sourceId: 'drink' })).ok, true);
  assert.equal(a.attachmentId, 'punch'); assert.equal(b.attachmentId, 'punch');
  assert.equal((await bob.request('takeAttachment', { sourceId: 'crown' })).ok, false, 'source location is checked on the server');
  place(a, 72); place(b, 72); await pause();
  const results = await Promise.all([alice, bob].map(client => client.request('takeAttachment', { sourceId: 'crown' })));
  assert.equal(results.filter(result => result.ok).length, 1);
  const winner = results[0].ok ? alice : bob; const loser = winner === alice ? bob : alice;
  const holder = room.state.players.get(winner.sessionId)!;
  const source = room.state.attachmentSources.get(attachmentSourceKey('home', 'crown'))!;
  assert.equal(source.holder, winner.sessionId);
  assert.equal(holder.attachmentId, 'party-crown');
  await pause();
  assert.equal((await loser.request('takeAttachment', { sourceId: 'crown' })).ok, false);
  place(holder, 104); await pause();
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    assert.equal((await winner.request('takeAttachment', { sourceId: 'food' })).ok, true);
    assert.ok(['cookie', 'grape', 'guava', 'cheese', 'ham'].includes(holder.attachmentId));
    seen.add(holder.attachmentId);
    if (i < 7) await pause();
  }
  assert.equal(source.holder, '', 'replacing a unique attachment releases its source');
  assert.ok(seen.size >= 1);
  holder.x = 64; holder.y = 68; holder.facing = 'up';
  await pause();
  assert.equal((await winner.request('activateAction', { action: 'sit' })).ok, true);
  assert.equal(holder.action, 'sit');
  const attachmentWhileSitting = holder.attachmentId;
  winner.send('input', { x: 1, y: 0 });
  await until(() => holder.action === 'none');
  assert.equal(holder.attachmentId, attachmentWhileSitting);
  winner.send('input', { x: 0, y: 0 });
  await pause();
  assert.equal((await loser.request('takeAttachment', { sourceId: 'crown' })).ok, true);
  assert.equal(source.holder, loser.sessionId);
  assert.equal((await loser.request('clearAttachment', {})).ok, true);
  assert.equal(source.holder, '');
  assert.equal(room.state.players.get(loser.sessionId)?.attachmentId, '');
  place(holder, 72); await pause();
  assert.equal((await winner.request('takeAttachment', { sourceId: 'crown' })).ok, true);
  await winner.leave();
  await until(() => source.holder === '');
  assert.equal(ATTACHMENTS.punch.name, '潘趣酒');
});

test('simultaneous claims have one winner, validate variants, replicate target state and release on cancel', async () => {
  const alice = await connect('Alice'); const bob = await connect('Bob');
  const room = roomFor(alice); const a = room.state.players.get(alice.sessionId)!; const b = room.state.players.get(bob.sessionId)!;
  a.x = b.x = 64; a.y = b.y = 68; a.facing = b.facing = 'up';
  const results = await Promise.all([alice, bob].map(client => client.request('activateAction', { action: 'sit' })));
  assert.equal(results.filter(result => result.ok).length, 1);
  const winner = results[0].ok ? alice : bob; const loser = winner === alice ? bob : alice;
  const objects = room.state.worldObjects.get('home')!.objects;
  assert.equal(objects.get('20')?.occupiedBy, winner.sessionId);
  assert.equal((await loser.request('selectVariant', { selectorId: '20', variant: 'book' })).ok, false);
  assert.equal((await winner.request('selectVariant', { selectorId: '20', variant: 'unknown' })).ok, false);
  await pause();
  assert.equal((await winner.request('selectVariant', { selectorId: '20', variant: 'drawing-board' })).ok, true);
  await until(() => loser.state.worldObjects.get('home')?.objects.get('90')?.variant === 'drawing-board');
  assert.equal((await winner.request('cancelAction', {})).ok, true);
  assert.equal(objects.get('20')?.occupiedBy, ''); assert.equal(objects.get('90')?.variant, '');
  await until(() => loser.state.worldObjects.get('home')?.objects.get('90')?.variant === '');
  assert.equal((await loser.request('activateAction', { action: 'sit' })).ok, true);
});

test('wrong-facing selectors allow free sit; correctly-facing occupied selectors reject without changing seats', async () => {
  const alice = await connect('NearestAlice'); const bob = await connect('NearestBob'); const room = roomFor(alice);
  const a = room.state.players.get(alice.sessionId)!; const b = room.state.players.get(bob.sessionId)!;
  const objects = room.state.worldObjects.get('home')!.objects;
  a.x = 79; a.y = 68; a.facing = 'up';
  for (const facing of ['up', 'left', 'right']) {
    a.facing = facing;
    const forged = { action: 'sit', facing: 'down' };
    const result = await alice.request('activateAction', forged);
    assert.equal(result.ok, true); assert.match(result.message, /已原地坐下.*面向下方/);
    assert.deepEqual([a.x, a.y, a.facing, a.action, a.actionTargetId], [79, 68, facing, 'sit', '']);
    assert.equal(objects.get('20')?.occupiedBy, ''); assert.equal(objects.get('22')?.occupiedBy, '');
    assert.equal(objects.get('92')?.variant, '');
    assert.equal((await alice.request('selectVariant', { selectorId: '22', variant: 'book' })).ok, false);
    await pause();
  }
  a.facing = 'down';
  assert.equal((await alice.request('activateAction', { action: 'sit' })).ok, true);
  assert.equal(a.actionTargetId, '22'); assert.equal(objects.get('92')?.variant, 'book');
  b.x = 79; b.y = 68; b.facing = 'down';
  assert.equal((await bob.request('activateAction', { action: 'sit' })).ok, false);
  assert.deepEqual([b.x, b.y, b.actionTargetId], [79, 68, '']);
  assert.equal(objects.get('20')?.occupiedBy, '');
  await pause(); a.facing = 'up';
  assert.equal((await alice.request('activateAction', { action: 'sit' })).ok, true);
  assert.deepEqual([a.x, a.y, a.action, a.actionTargetId], [80, 64, 'sit', '']);
  assert.equal(objects.get('22')?.occupiedBy, '');
  assert.equal(objects.get('92')?.variant, '', 'free sit releases the prior selector and restores its target');
});

test('single variant applies directly; moving, drop and map transfer free claims immediately', async () => {
  const alice = await connect('Alice'); const room = roomFor(alice); const player = room.state.players.get(alice.sessionId)!;
  const objects = room.state.worldObjects.get('home')!.objects;
  player.x = 96; player.y = 68; player.facing = 'up';
  assert.equal((await alice.request('activateAction', { action: 'sit' })).ok, true);
  assert.equal(objects.get('91')?.variant, 'book');
  alice.send('input', { x: 1, y: 0 }); await until(() => objects.get('21')?.occupiedBy === '');
  assert.equal(objects.get('91')?.variant, '');
  alice.send('input', { x: 0, y: 0 }); await delay(60); await pause();
  player.x = 64; player.y = 68; player.facing = 'up';
  assert.equal((await alice.request('activateAction', { action: 'sit' })).ok, true);
  await pause();
  assert.equal((await alice.request('selectVariant', { selectorId: '20', variant: 'computer' })).ok, true);
  // Dropped selector owners never reserve the point during the reconnection window.
  room.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
  await until(() => !player.connected);
  assert.equal(objects.get('20')?.occupiedBy, ''); assert.equal(player.action, 'none');
  assert.equal(objects.get('91')?.variant, '');
  assert.equal(objects.get('90')?.variant, '');
  await until(() => player.connected);
  assert.equal(player.action, 'none'); assert.equal(objects.get('20')?.occupiedBy, '');
});

test('Portal releases selector claim and scopes target variants by map', async () => {
  const alice = await connect('Alice'); const room = roomFor(alice); const player = room.state.players.get(alice.sessionId)!;
  player.x = 96; player.y = 68; player.facing = 'up';
  await alice.request('activateAction', { action: 'sit' }); await pause();
  player.x = 280; player.y = 40;
  assert.equal((await alice.request('portal', { zoneId: 'door' })).ok, true);
  assert.equal(player.mapId, 'studio'); assert.equal(player.actionTargetId, '');
  assert.equal(room.state.worldObjects.get('home')?.objects.get('21')?.occupiedBy, '');
  assert.equal(room.state.worldObjects.get('home')?.objects.get('91')?.variant, '');
  assert.equal(room.state.worldObjects.get('studio')?.objects.get('91')?.variant, '');
});

test('clear hides an opaque target without releasing a single-option selector, and animation changes preserve it', async () => {
  const alice = await connect('ClearOwner'); const bob = await connect('ClearPeer'); const room = roomFor(alice);
  const player = room.state.players.get(alice.sessionId)!;
  const objects = room.state.worldObjects.get('home')!.objects; const target = objects.get('91')!;
  player.x = 96; player.y = 68; player.facing = 'up';
  assert.equal((await alice.request('activateAction', { action: 'sit' })).ok, true);
  assert.equal(target.variant, 'book');
  assert.equal((await bob.request('selectVariant', { selectorId: '21', variant: null })).ok, false);
  await pause();
  assert.equal((await alice.request('selectVariant', { selectorId: '21', variant: null })).ok, true);
  assert.equal(target.variant, ''); assert.equal(target.variantCleared, true);
  assert.equal(objects.get('21')?.occupiedBy, alice.sessionId); assert.equal(player.actionTargetId, '21');
  await until(() => bob.state.worldObjects.get('home')?.objects.get('91')?.variantCleared === true);
  await pause();
  assert.equal((await alice.request('activateAction', { action: 'sit', animated: true })).ok, true);
  assert.equal(target.variantCleared, true, 'animation changes must not reapply the single option');
  await pause();
  assert.equal((await alice.request('selectVariant', { selectorId: '21', variant: 'book' })).ok, true);
  assert.equal(target.variant, 'book'); assert.equal(target.variantCleared, false);
  await pause();
  assert.equal((await alice.request('activateAction', { action: 'sit', animated: false })).ok, true);
  assert.equal(target.variant, 'book', 'animation changes preserve a selection');
  assert.equal((await alice.request('cancelAction', {})).ok, true);
  assert.equal(target.variant, ''); assert.equal(target.variantCleared, false);
  assert.equal(objects.get('21')?.occupiedBy, '');
});

test('leaving a selector resets its target and stale owners cannot reset a new claim', async () => {
  const alice = await connect('OldOwner'); const bob = await connect('NewOwner'); const room = roomFor(alice);
  const a = room.state.players.get(alice.sessionId)!; const b = room.state.players.get(bob.sessionId)!;
  const objects = room.state.worldObjects.get('home')!.objects; const target = objects.get('90')!;
  a.x = b.x = 64; a.y = b.y = 68; a.facing = b.facing = 'up';
  assert.equal((await alice.request('activateAction', { action: 'sit' })).ok, true);
  await pause();
  await Promise.all([alice.request('selectVariant', { selectorId: '20', variant: 'computer' }), alice.request('cancelAction', {})]);
  assert.equal(target.variant, ''); assert.equal(target.variantCleared, false);
  assert.equal((await bob.request('activateAction', { action: 'sit' })).ok, true);
  await pause();
  assert.equal((await bob.request('selectVariant', { selectorId: '20', variant: 'book' })).ok, true);
  const { releaseActionClaim } = await import('../src/interactions/action/handler.js');
  releaseActionClaim({ state: room.state, maps: worlds }, 'home', '20', alice.sessionId);
  assert.equal(objects.get('20')?.occupiedBy, bob.sessionId); assert.equal(target.variant, 'book');
  assert.equal((await alice.request('selectVariant', { selectorId: '20', variant: null })).ok, false);
  assert.equal(target.variant, 'book'); assert.equal(target.variantCleared, false);
  await bob.leave();
  await until(() => objects.get('20')?.occupiedBy === '');
  assert.equal(target.variant, ''); assert.equal(target.variantCleared, false);
});

test('invalid and orphaned selector claims restore targets without cancelling unrelated actions', async () => {
  const alice = await connect('InvalidOwner'); const room = roomFor(alice);
  const player = room.state.players.get(alice.sessionId)!; const objects = room.state.worldObjects.get('home')!.objects;
  const claim = objects.get('20')!; const target = objects.get('90')!;
  player.x = 64; player.y = 68; player.facing = 'up';
  assert.equal((await alice.request('activateAction', { action: 'sit' })).ok, true);
  target.variant = 'book'; target.variantCleared = true; player.x = 120;
  room['interactions'].registry.get('variantSelector')!.tick?.();
  assert.equal(player.action, 'none'); assert.equal(claim.occupiedBy, '');
  assert.equal(target.variant, ''); assert.equal(target.variantCleared, false);
  player.action = 'sit'; player.actionTargetId = '';
  for (const owner of [alice.sessionId, 'missing-session']) {
    claim.occupiedBy = owner; target.variant = 'book'; target.variantCleared = true;
    room['interactions'].registry.get('variantSelector')!.tick?.();
    assert.equal(player.action, 'sit'); assert.equal(player.actionTargetId, '');
    assert.equal(claim.occupiedBy, ''); assert.equal(target.variant, ''); assert.equal(target.variantCleared, false);
  }
});

test('private membership is removed on exit, invitations persist until entry, and inactive areas reset', async () => {
  const alice = await connect('Alice'); const bob = await connect('Bob'); const carol = await connect('Carol');
  const room = roomFor(alice); const a = room.state.players.get(alice.sessionId)!; const b = room.state.players.get(bob.sessionId)!;
  const c = room.state.players.get(carol.sessionId)!;
  const access = room['interactions'].access;
  a.x = c.x = 176; a.y = c.y = 160; access.tick();
  const area = room.state.privateAreas.get('home')!.areas.get('30')!;
  assert.equal(a.privateAreaId, '30'); assert.equal(area.members.has(alice.sessionId), true);
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, false);
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
  // Footprint stops at the boundary, even if the foot point itself is still outside.
  b.x = 138; b.y = 160;
  bob.send('input', { x: 1, y: 0 }); await delay(180); bob.send('input', { x: 0, y: 0 });
  assert.equal(b.x, 138); assert.equal(b.privateAreaId, '');
  b.x = 136; b.y = 164;
  assert.equal((await bob.request('activateAction', { action: 'sit' })).ok, false, 'action offsets cannot bypass locked border');
  assert.equal(access.canMove('home', bob.sessionId, { x: 176, y: 224.1 }, { x: 176, y: 231.6 }), true, 'outsiders straddling a new lock can retreat');
  assert.equal(access.canMove('home', bob.sessionId, { x: 176, y: 224.1 }, { x: 176, y: 224.05 }), false, 'straddling outsiders cannot move further inside');
  assert.equal(area.members.get(carol.sessionId), true);
  // Leaving immediately removes an entered member and their management rights.
  a.x = 32; a.y = 32; access.tick();
  assert.equal(a.privateAreaId, ''); assert.equal(area.members.has(alice.sessionId), false);
  await pause();
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'addMember', playerId: bob.sessionId })).ok, false);
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: false })).ok, false);
  assert.equal(area.locked, true);
  assert.equal(access.canEnter('home', alice.sessionId, { x: 176, y: 160 }), false, 'exited members cannot re-enter a locked area');
  // The remaining member can invite Alice again; the invitation alone grants no management rights.
  assert.equal((await carol.request('privateArea', { areaId: '30', operation: 'addMember', playerId: alice.sessionId })).ok, true);
  assert.equal(area.members.get(alice.sessionId), false);
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: false })).ok, false);
  // Entering on invitation restores membership and management rights.
  a.x = 176; a.y = 160; access.tick(); await pause();
  assert.equal(area.members.get(alice.sessionId), true);
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: false })).ok, true);
  await pause();
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'addMember', playerId: bob.sessionId })).ok, true);
  assert.equal(area.members.get(bob.sessionId), false);
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'lock', locked: false })).ok, false);
  b.x = 176; b.y = 160; access.tick();
  assert.equal(b.privateAreaId, '30');
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'lock', locked: false })).ok, true);
  await pause();
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'addMember', playerId: carol.sessionId })).ok, true);
  assert.equal((await carol.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
  b.x = 32; b.y = 32; access.tick();
  assert.equal(area.members.has(bob.sessionId), false);
  await pause();
  assert.equal((await carol.request('privateArea', { areaId: '30', operation: 'addMember', playerId: bob.sessionId })).ok, true);
  a.x = 32; c.x = 32;
  access.syncPlayer(alice.sessionId, a); access.syncPlayer(carol.sessionId, c);
  assert.equal(area.members.has(alice.sessionId), false);
  assert.equal(area.members.has(carol.sessionId), false);
  assert.equal(area.members.get(bob.sessionId), false, 'an outstanding invitation remains while the area is idle');
  const now = Date.now(); access.tick(now); assert.equal(area.resetAt, now + PRIVATE_AREA_IDLE_MS);
  access.tick(now + PRIVATE_AREA_IDLE_MS);
  assert.equal(area.members.size, 0); assert.equal(area.locked, false); assert.equal(area.resetAt, 0);
});

test('walking out revokes private membership in the authoritative movement step', async () => {
  const alice = await connect('Walker'); const bob = await connect('RemainingMember');
  const room = roomFor(alice), access = room['interactions'].access;
  const a = room.state.players.get(alice.sessionId)!, b = room.state.players.get(bob.sessionId)!;
  a.x = 239; a.y = 160; b.x = 176; b.y = 160; access.tick();
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
  const area = room.state.privateAreas.get('home')!.areas.get('30')!;
  alice.send('input', { x: 1, y: 0 });
  await until(() => a.x > 240);
  alice.send('input', { x: 0, y: 0 });
  assert.equal(a.privateAreaId, ''); assert.equal(area.members.has(alice.sessionId), false);
  assert.equal(area.locked, true); assert.equal(area.members.get(bob.sessionId), true);
  assert.equal(access.canEnter('home', alice.sessionId, { x: 239, y: 160 }), false);
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: false })).ok, false);
});

test('polygon private admission uses the diagonal boundary and allows retreat after a lock', async () => {
  const definition = worlds.get('home')!.world.zones.find(zone => zone.id === '30')!;
  definition.polygon = [{ x: 144, y: 128 }, { x: 240, y: 128 }, { x: 144, y: 224 }];
  try {
    const alice = await connect('PolygonMember'); const bob = await connect('PolygonOutsider');
    const room = roomFor(alice), access = room['interactions'].access;
    const a = room.state.players.get(alice.sessionId)!, b = room.state.players.get(bob.sessionId)!;
    a.x = 176; a.y = 160; b.x = 224; b.y = 208; access.tick();
    assert.equal(a.privateAreaId, '30'); assert.equal(b.privateAreaId, '');
    assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
    assert.equal(access.canEnter('home', bob.sessionId, { x: 224, y: 208 }), true, 'empty corner in bounding box stays accessible');
    assert.equal(access.canEnter('home', bob.sessionId, { x: 188, y: 188 }), false, 'outside foot point still has footprint overlap');
    assert.equal(access.canMove('home', bob.sessionId, { x: 188, y: 188 }, { x: 189, y: 189 }), true);
    assert.equal(access.canMove('home', bob.sessionId, { x: 188, y: 188 }, { x: 187, y: 187 }), false);
    assert.equal(access.canEnter('home', alice.sessionId, { x: 188, y: 188 }), true);
    // The current map Portal points at the private spawn; polygon admission also protects transfers.
    b.x = 280; b.y = 88;
    assert.equal((await bob.request('portal', { zoneId: 'local-door' })).ok, false);
  } finally { delete definition.polygon; }
});

test('private areas receive public chat and voice but keep private content one-way', async () => {
  const alice = await connect('Alice'); const bob = await connect('Bob'); const carol = await connect('Carol');
  const clients = [alice, bob, carol];
  const room = roomFor(alice); const access = room['interactions'].access;
  const [a, b, c] = clients.map(client => room.state.players.get(client.sessionId)!);
  a.x = 176; a.y = 160; b.x = 200; b.y = 200; c.x = 130; c.y = 160; access.tick();
  assert.deepEqual([a.privateAreaId, b.privateAreaId, c.privateAreaId], ['30', '30', '']);
  const inbox = new Map(clients.map(client => [client.sessionId, [] as string[]]));
  const ended: string[] = [];
  for (const client of clients) {
    client.onMessage('chat', message => inbox.get(client.sessionId)!.push(`${message.privateAreaId}:${message.text}`));
    client.onMessage('voiceOffer', () => {}); client.onMessage('voiceEnd', () => ended.push(client.sessionId));
  }
  alice.send('chat', { text: 'inside' }); carol.send('chat', { text: 'outside' });
  await until(() => clients.every(client => inbox.get(client.sessionId)!.length >= 1)); await delay(100);
  assert.deepEqual(inbox.get(alice.sessionId)!.sort(), ['30:inside', ':outside']);
  assert.deepEqual(inbox.get(bob.sessionId)!.sort(), ['30:inside', ':outside']);
  assert.deepEqual(inbox.get(carol.sessionId), [':outside']);

  for (const client of clients) assert.equal(await client.request('voiceEnabled', { enabled: true }), true);
  const offer = (one: Room<SpaceProtocol>, two: Room<SpaceProtocol>) => {
    const [from, to] = [one, two].sort((x, y) => x.sessionId < y.sessionId ? -1 : 1);
    return from!.request('voiceOffer', { peerId: to!.sessionId, connectionId: randomUUID(), sdp: 'offer' });
  };
  assert.equal(await offer(alice, carol), true, 'a pair can carry public voice into the private area');
  assert.equal(await offer(carol, alice), false, 'duplicate pair creation is rejected');
  assert.equal(await offer(alice, bob), true);
  b.x = 130; b.y = 200; access.tick(); room['voice'].tick();
  await delay(100);
  assert.equal(ended.includes(alice.sessionId) || ended.includes(bob.sessionId), false,
    'leaving the private area keeps the public-to-private audio direction alive');
  b.x = 1000; b.y = 1000; room['voice'].tick();
  await until(() => ended.includes(alice.sessionId) && ended.includes(bob.sessionId));
  b.x = 130; b.y = 200; room['voice'].tick();
  assert.equal(await offer(bob, carol), true, 'leaving the area rejoins the public audience');
});

test('Portal rejects locked destination and map change/drop prune temporary membership', async () => {
  const alice = await connect('Alice'); const bob = await connect('Bob');
  const room = roomFor(alice); const a = room.state.players.get(alice.sessionId)!; const b = room.state.players.get(bob.sessionId)!;
  const access = room['interactions'].access;
  const reconnected = new Promise<void>(resolve => bob.onReconnect.once(resolve));
  b.mapId = 'studio'; b.x = 176; b.y = 160; access.tick();
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
  a.x = 280; a.y = 40;
  assert.equal((await alice.request('portal', { zoneId: 'door' })).ok, false); assert.equal(a.mapId, 'home');
  await pause();
  await bob.request('privateArea', { areaId: '30', operation: 'addMember', playerId: alice.sessionId });
  await pause();
  a.x = 176; a.y = 160; access.tick();
  assert.equal(room.state.privateAreas.get('home')?.areas.get('30')?.members.has(alice.sessionId), true);
  a.x = 280; a.y = 40;
  assert.equal((await alice.request('portal', { zoneId: 'door' })).ok, true);
  assert.equal(room.state.privateAreas.get('home')?.areas.get('30')?.members.size, 0);
  assert.equal(a.privateAreaId, '30');
  room.clients.find(client => client.sessionId === bob.sessionId)!.leave(1001); await until(() => !b.connected);
  const state = room.state.privateAreas.get('studio')!.areas.get('30')!;
  assert.equal(state.members.has(bob.sessionId), false);
  await reconnected;
  await until(() => b.connected && bob.connection.isOpen);
  assert.equal(b.privateAreaId, '', 'reconnect cannot bypass the locked border');
  await bob.leave();
  await alice.leave(); await until(() => !room.state.players.has(alice.sessionId));
  assert.equal(state.members.size, 0); assert.equal(state.locked, false);
});

test('same-map Portal cannot restore an exited member without a fresh invite', async () => {
  const alice = await connect('Alice'); const bob = await connect('Bob'); const room = roomFor(alice);
  const a = room.state.players.get(alice.sessionId)!; const b = room.state.players.get(bob.sessionId)!;
  a.x = b.x = 176; a.y = b.y = 160; room['interactions'].access.tick();
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
  a.x = 280; a.y = 88; room['interactions'].access.tick(); await pause();
  assert.equal((await alice.request('portal', { zoneId: 'local-door' })).ok, false);
  assert.equal((await bob.request('privateArea', { areaId: '30', operation: 'addMember', playerId: alice.sessionId })).ok, true);
  await pause();
  assert.equal((await alice.request('portal', { zoneId: 'local-door' })).ok, true);
  const area = room.state.privateAreas.get('home')!.areas.get('30')!;
  assert.equal(area.members.has(alice.sessionId), true); assert.equal(a.privateAreaId, '30'); assert.equal(area.locked, true);
});

test('same-map Portal removes membership when it transfers a member outside the area', async () => {
  const alice = await connect('Alice'); const room = roomFor(alice);
  const player = room.state.players.get(alice.sessionId)!;
  const access = room['interactions'].access;
  player.x = 176; player.y = 160; access.tick();
  const area = room.state.privateAreas.get('home')!.areas.get('30')!;
  assert.equal(area.members.get(alice.sessionId), true);
  player.x = 280; player.y = 136; await pause();
  assert.equal((await alice.request('portal', { zoneId: 'local-exit' })).ok, true);
  assert.equal(area.members.has(alice.sessionId), false);
  assert.equal(player.privateAreaId, '');
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, false);
});

test('map loader rejects missing atlas GIDs before publishing variant targets', () => {
  const source = makeMap();
  const invalid = { ...source, tilesets: [{ ...source.tilesets[0], tilecount: 2 }] };
  writeFileSync(join(directory, 'invalid.tmj'), JSON.stringify(invalid));
  const registryPath = join(directory, 'invalid-registry.json');
  writeFileSync(registryPath, JSON.stringify({ maps: [
    { id: 'home', file: 'invalid.tmj', defaultSpawn: 'entry' },
    { id: 'studio', file: 'studio.tmj', defaultSpawn: 'entry' },
  ], spaces: [{ id: 'main', name: 'Main', cover: '/maps/tiles.png', initialMap: 'home', maps: ['home', 'studio'] }] }));
  assert.throws(() => loadWorldRegistry(registryPath), /Too big/);
});


test('external JSON tilesets resolve local variant IDs before atlas validation', () => {
  const source = makeMap();
  const decor = source.layers.find(layer => layer.name === 'decor')!;
  for (const object of decor.objects ?? []) {
    if ('gid' in object) object.gid = 101;
    if ('properties' in object && object.properties) {
      for (const property of object.properties) if (property.name.startsWith('variant.')) property.value = 0;
    }
  }
  const external = { ...source, tilesets: [{ firstgid: 101, source: 'variant-atlas.tsj' }] };
  writeFileSync(join(directory, 'variant-atlas.tsj'), JSON.stringify({ ...source.tilesets[0], name: 'props' }));
  writeFileSync(join(directory, 'external-variants.tmj'), JSON.stringify(external));
  const registryPath = join(directory, 'external-variants.json');
  writeFileSync(registryPath, JSON.stringify({ maps: [
    { id: 'home', file: 'external-variants.tmj', defaultSpawn: 'entry' },
    { id: 'studio', file: 'studio.tmj', defaultSpawn: 'entry' },
  ], spaces: [{ id: 'main', name: 'Main', cover: '/maps/tiles.png', initialMap: 'home', maps: ['home', 'studio'] }] }));
  const loaded = loadWorldRegistry(registryPath);
  assert.deepEqual(loaded.registry.maps[0]?.world.variantTargets[0]?.variants, { computer: 101, book: 101, 'drawing-board': 101 });
});


test('Spaces reuse map geometry but isolate initial map, selector claims and private-area locks', async () => {
  const alice = await connect('Alice'); const bob = await connect('Bob', 'other');
  const first = roomFor(alice); const second = roomFor(bob);
  assert.notEqual(alice.roomId, bob.roomId);
  assert.equal(first.state.spaceId, 'main'); assert.equal(second.state.spaceId, 'other');
  assert.equal(first.state.players.get(alice.sessionId)?.mapId, 'home');
  const b = second.state.players.get(bob.sessionId)!;
  assert.equal(b.mapId, 'studio');
  // Both Spaces enter the same map and authored selector; neither claim blocks the other.
  b.x = 280; b.y = 88;
  assert.equal((await bob.request('portal', { zoneId: 'local-door' })).ok, true);
  const a = first.state.players.get(alice.sessionId)!;
  a.x = b.x = 64; a.y = b.y = 68; a.facing = b.facing = 'up';
  await pause();
  for (const client of [alice, bob]) assert.equal((await client.request('activateAction', { action: 'sit' })).ok, true);
  await pause();
  assert.equal((await alice.request('selectVariant', { selectorId: '20', variant: 'book' })).ok, true);
  assert.equal(first.state.worldObjects.get('home')?.objects.get('90')?.variant, 'book');
  assert.equal(second.state.worldObjects.get('home')?.objects.get('90')?.variant, '');
  assert.equal(second.state.worldObjects.get('home')?.objects.get('20')?.occupiedBy, bob.sessionId);
  for (const client of [alice, bob]) await client.request('cancelAction', {});
  a.x = b.x = 176; a.y = b.y = 160;
  first['interactions'].access.tick(); second['interactions'].access.tick();
  await pause();
  assert.equal((await alice.request('privateArea', { areaId: '30', operation: 'lock', locked: true })).ok, true);
  assert.equal(first.state.privateAreas.get('home')?.areas.get('30')?.locked, true);
  assert.equal(second.state.privateAreas.get('home')?.areas.get('30')?.locked, false);
  assert.equal(first.state.players.has(bob.sessionId), false);
  assert.equal(second.state.players.has(alice.sessionId), false);
});

test('runtime capacity applies to every Space and concurrent joins never create overflow instances', async () => {
  const results = await Promise.allSettled(Array.from({ length: 7 }, (_, index) => connect(`Guest${index}`)));
  const joined = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  assert.equal(joined.length, 3);
  assert.equal(new Set(joined.map(room => room.roomId)).size, 1);
  for (const result of results) if (result.status === 'rejected') assert.match(String(result.reason), /Space is full/);
  assert.equal(roomFor(joined[0]).maxClients, 3);
  const other = await connect('Other', 'other');
  assert.equal(roomFor(other).maxClients, 3);
  assert.equal((await matchMaker.query({ name: 'space' })).length, 2);
  assert.equal(roomFor(joined[0]).state.players.size, 3);
});
