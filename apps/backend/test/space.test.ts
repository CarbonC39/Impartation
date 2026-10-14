import assert from 'node:assert/strict';
import { before, after, beforeEach, describe, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Client, type Room } from '@colyseus/sdk';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';
import { rmSync } from 'node:fs';
import { createRoomWorldFixture } from './world-fixture.js';

process.env.DATABASE_PATH = ':memory:';
const fixture = createRoomWorldFixture();
process.env.MAP_REGISTRY_PATH = fixture.registryPath;
process.env.EXTERNAL_TOOLS = JSON.stringify({
  'shared-canvas': { url: 'https://board.example/boards/workspace' },
});
const { server } = await import('../src/app.config.js');
const { db } = await import('../src/db.js');
const { setRole } = await import('../src/identity.js');
const endpoint = 'http://127.0.0.1:2568';
async function createIdentity() {
  const response = await fetch(endpoint + '/api/auth/sign-in/anonymous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
}
function sdk(cookie: string) { return new Client<typeof server>(endpoint, { headers: { Cookie: cookie } }); }
async function me(cookie: string) {
  const response = await fetch(endpoint + '/api/me', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return await response.json() as { id: string; name: string; avatar: string; appearance: object; role: 'member' | 'admin' };
}

async function until(predicate: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for room state');
    await delay(10);
  }
}

describe('space room over real WebSocket connections', { timeout: 30000 }, () => {
  let harness: ColyseusTestServer<typeof server>;
  const connections: Room<SpaceRoom>[] = [];
  before(async () => { harness = await boot(server); });
  beforeEach(async () => {
    await Promise.all(connections.splice(0).filter(room => room.connection.isOpen).map(room => room.leave()));
    await harness.cleanup();
    db.prepare('DELETE FROM board_notes').run();
  });
  after(async () => {
    await Promise.all(connections.splice(0).filter(room => room.connection.isOpen).map(room => room.leave()));
    await harness.shutdown();
    db.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });
  async function join(name: string, avatar: 'mint' | 'amber' | 'violet' = 'mint', cookie?: string) {
    const room = await sdk(cookie ?? await createIdentity()).joinOrCreate('space', { name, avatar });
    room.onMessage('chat', () => {});
    room.onError(() => {});
    room.reconnection.minUptime = 0;
    connections.push(room);
    await room.waitForInitialState();
    return room;
  }
  test('tool directory publishes only web resource configuration, without creating or granting an identity', async () => {
    const response = await fetch(endpoint + '/api/tools');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.deepEqual(await response.json(), [
      { resourceId: 'shared-canvas', url: 'https://board.example/boards/workspace' },
    ]);
  });
  test('two guests share the same room and avatar state; consented leave removes only that player', async () => {
    const alice = await join('Alice', 'amber');
    const bob = await join('Bob', 'violet');
    assert.equal(alice.roomId, bob.roomId);
    await until(() => alice.state.players.size === 2);
    assert.equal(alice.state.players.get(bob.sessionId)?.avatar, 'violet');
    assert.equal(alice.state.players.get(alice.sessionId)?.name, 'Alice');
    connections.splice(connections.indexOf(bob), 1);
    await bob.leave();
    await until(() => alice.state.players.size === 1);
    assert.equal(alice.state.players.has(bob.sessionId), false);
  });
  test('guest input is validated before joining', async () => {
    const client = sdk(await createIdentity());
    await assert.rejects(client.joinOrCreate('space', { name: '', avatar: 'mint' }));
    // The SDK's permissive overload allows malformed data; the server must reject it.
    await assert.rejects(client.joinOrCreate('space', { name: 'Alice', avatar: 'unknown' }));
  });
  test('server movement stops after stale input and prevents walking through collisions', async () => {
    const alice = await join('Alice');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    const x = player.x;
    alice.send('input', { x: 1, y: 0 });
    await until(() => player.x > x);
    assert.equal(player.facing, 'right'); assert.equal(player.motion, 'walk');
    await delay(350);
    const stopped = player.x;
    await delay(150);
    assert.equal(player.x, stopped);
    assert.equal(player.motion, 'idle'); assert.equal(player.facing, 'right');
    player.x = 310; player.y = 250;
    alice.send('input', { x: 1, y: 0 });
    await delay(150);
    assert.equal(player.x, 310);
    assert.equal(player.motion, 'idle');
  });
  for (const action of ['sit', 'wave', 'exercise', 'sleep', 'read']) {
    test(`${action} runs in place, stops movement and is cancelled by new movement`, async () => {
      const alice = await join('AbilityUser');
      const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
      const player = authoritative.state.players.get(alice.sessionId)!;
      alice.send('input', { x: 1, y: 0 });
      await until(() => player.motion === 'walk');
      assert.equal((await alice.request('activateAction', { action, animated: true })).ok, true);
      const position = { x: player.x, y: player.y };
      assert.equal(player.action, action); assert.equal(player.actionAnimated, true);
      assert.equal(player.actionTargetId, ''); assert.equal(player.motion, 'idle');
      assert.equal(player.facing, 'right');
      alice.send('input', { x: 0, y: 0 });
      await delay(150);
      assert.deepEqual({ x: player.x, y: player.y }, position);
      assert.equal(player.action, action); assert.equal(player.motion, 'idle');
      await until(() => alice.state.players.get(alice.sessionId)?.actionAnimated === true);
      alice.send('input', { x: 0, y: 1 });
      await until(() => player.action === 'none');
      assert.equal(player.actionTargetId, ''); assert.equal(player.actionAnimated, false);
      await until(() => player.motion === 'walk');
      assert.equal(player.facing, 'down');
    });
  }
  test('adjacent tiles perform sit in place without borrowing a nearby anchor', async () => {
    const alice = await join('AdjacentAction');
    const player = harness.getRoomById<SpaceRoom>(alice.roomId).state.players.get(alice.sessionId)!;
    player.x = 399.99; player.y = 392; player.facing = 'left';
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: false })).ok, true);
    assert.deepEqual([player.x, player.y, player.facing, player.actionTargetId, player.actionAnimated],
      [399.99, 392, 'left', '', false]);
  });
  test('matching sit anchor overrides facing, ignores forged context and retains occupancy', async () => {
    const alice = await join('SeatedAlice');
    const bob = await join('SeatedBob');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    const other = authoritative.state.players.get(bob.sessionId)!;
    player.x = 402; player.y = 386;
    const forged = { action: 'sit', animated: false, objectId: 'lobby-seat-2', sessionId: bob.sessionId,
      facing: 'down', x: 1, y: 1, offsetX: 900, linkedObjectId: 'forged-desk', variant: 'forged' };
    assert.equal((await alice.request('activateAction', forged)).ok, true);
    assert.deepEqual([player.x, player.y, player.facing, player.motion, player.action, player.actionTargetId],
      [408, 392, 'up', 'idle', 'sit', 'lobby-seat-1']);
    assert.equal(other.action, 'none');
    const objects = authoritative.state.worldObjects.get('lobby')!.objects;
    const object = objects.get('lobby-seat-1')!;
    assert.equal(object.occupiedBy, alice.sessionId); assert.equal(object.variant, 'occupied');
    assert.equal(objects.get('desk-1')?.variant, '');
    assert.equal(objects.has('forged-desk'), false);
    // Future handlers can update a linked authored ID without referencing visual tiles.
    objects.get('desk-1')!.variant = 'active';
    await until(() => bob.state.worldObjects.get('lobby')?.objects.get('desk-1')?.variant === 'active');
    await until(() => bob.state.players.get(alice.sessionId)?.action === 'sit');
    other.x = 408; other.y = 392;
    assert.equal((await bob.request('activateAction', { action: 'sit', animated: false })).ok, false);
    alice.send('input', { x: 0, y: 0 });
    await delay(150);
    assert.equal(player.action, 'sit'); assert.equal(player.x, 408);
    alice.send('input', { x: -1, y: 0 });
    await until(() => player.action === 'none');
    assert.equal(player.actionTargetId, ''); assert.equal(player.actionAnimated, false); assert.equal(player.facing, 'left');
    assert.equal(object.occupiedBy, ''); assert.equal(object.variant, 'empty');
    await until(() => player.motion === 'walk');
    assert.equal((await bob.request('activateAction', { action: 'sit', animated: true })).ok, true);
    assert.equal(object.occupiedBy, bob.sessionId);
    await bob.leave();
    await until(() => object.occupiedBy === '');
    assert.equal(object.variant, 'empty');
  });
  test('action matching uses the requested name and applies world-pixel offsets with optional facing', async () => {
    const alice = await join('Reader');
    const player = harness.getRoomById<SpaceRoom>(alice.roomId).state.players.get(alice.sessionId)!;
    player.x = 402; player.y = 386; player.facing = 'right';
    assert.equal((await alice.request('activateAction', { action: 'read', animated: false })).ok, true);
    assert.deepEqual([player.x, player.y, player.facing, player.action, player.actionTargetId],
      [410, 391, 'right', 'read', 'reading-spot']);
    await delay(550);
    assert.equal((await alice.request('activateAction', { action: 'read', animated: true })).ok, true);
    assert.deepEqual([player.x, player.y], [410, 391]);
    assert.equal(player.actionAnimated, true);
  });
  test('non-zero movement cancels an action even when collision blocks the movement', async () => {
    const alice = await join('BlockedAction');
    const player = harness.getRoomById<SpaceRoom>(alice.roomId).state.players.get(alice.sessionId)!;
    player.x = 310; player.y = 250;
    assert.equal((await alice.request('activateAction', { action: 'exercise', animated: true })).ok, true);
    alice.send('input', { x: 1, y: 0 });
    await until(() => player.action === 'none');
    await delay(150);
    assert.equal(player.x, 310); assert.equal(player.actionAnimated, false);
    assert.equal(player.actionTargetId, ''); assert.equal(player.motion, 'idle');
  });
  test('a dropped seated player retains occupancy during reconnection and releases it on final leave', async () => {
    const alice = await join('SeatedReconnect');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    player.x = 408; player.y = 392;
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: false })).ok, true);
    const object = authoritative.state.worldObjects.get('lobby')!.objects.get('lobby-seat-1')!;
    const reconnected = new Promise<void>(resolve => alice.onReconnect.once(resolve));
    authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
    await until(() => !player.connected);
    assert.equal(player.action, 'sit'); assert.equal(player.motion, 'idle');
    assert.equal(object.occupiedBy, alice.sessionId);
    await reconnected;
    await until(() => player.connected);
    assert.equal(player.action, 'sit'); assert.equal(object.occupiedBy, alice.sessionId);
    await alice.leave();
    await until(() => object.occupiedBy === '');
  });
  test('revoked identities cannot activate an authored seat even at its anchor', async () => {
    const cookie = await createIdentity();
    const alice = await join('RevokedSeat', 'mint', cookie);
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    player.x = 408; player.y = 392;
    const left = new Promise<number>(resolve => alice.onLeave.once(resolve));
    await fetch(endpoint + '/api/auth/sign-out', { method: 'POST', headers: { Cookie: cookie, Origin: endpoint,
      'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: false })).ok, false);
    assert.equal(player.action, 'none');
    assert.equal(authoritative.state.worldObjects.get('lobby')?.objects.get('lobby-seat-1')?.occupiedBy, '');
    assert.equal(await left, 4003);
  });
  test('chat is broadcast as text with server identity, bounded length, and rate limiting', async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const received: string[] = [];
    bob.onMessage('chat', message => { received.push(message.text); assert.equal(message.name, 'Alice'); });
    alice.send('chat', { text: ' <b>hello</b> ' });
    await until(() => received.length === 1);
    assert.equal(received[0], '<b>hello</b>');
    alice.send('chat', { text: 'too fast' });
    await delay(100);
    assert.equal(received.length, 1);
    await delay(500);
    alice.send('chat', { text: 'after cooldown' });
    await until(() => received.length === 2);
    assert.equal(received[1], 'after cooldown');
  });
  test('unexpected disconnect reconnects with the same identity and position', async () => {
    const alice = await join('Alice');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    const sessionId = alice.sessionId;
    alice.send('input', { x: 1, y: 0 });
    const initialX = player.x;
    await until(() => player.x > initialX);
    const position = { x: player.x, y: player.y };
    const reconnected = new Promise<void>(resolve => alice.onReconnect.once(resolve));
    authoritative.clients.find(client => client.sessionId === sessionId)!.leave(1001, 'test network drop');
    await until(() => player.connected === false);
    await delay(100);
    assert.deepEqual({ x: player.x, y: player.y }, position);
    await reconnected;
    await until(() => player.connected);
    assert.equal(alice.sessionId, sessionId);
    assert.equal(authoritative.state.players.get(sessionId), player);
    assert.deepEqual({ x: player.x, y: player.y }, position);
    assert.equal(authoritative.state.players.size, 1);
  });
  test('zoneId is computed on the server, synchronized on entry, and cleared on exit', async () => {
    const alice = await join('Alice');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    player.x = 80; player.y = 80;
    alice.send('input', { x: 0, y: 0 });
    await until(() => alice.state.players.get(alice.sessionId)?.zoneId === 'lounge-screen');
    player.x = 300; player.y = 100;
    alice.send('input', { x: 0, y: 0 });
    await until(() => alice.state.players.get(alice.sessionId)?.zoneId === '');
  });
  test('chat cooldown is per connection and profiles are stored under distinct identities', async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const names: string[] = [];
    bob.onMessage('chat', message => names.push(message.name));
    alice.send('chat', { text: 'from Alice' });
    bob.send('chat', { text: 'from Bob' });
    await until(() => names.length === 2);
    assert.deepEqual(names.sort(), ['Alice', 'Bob']);
    assert.notEqual(alice.state.players.get(alice.sessionId)?.userId, bob.state.players.get(bob.sessionId)?.userId);
  });
  test('health route checks SQLite and returns JSON', async () => {
    const response = await fetch('http://127.0.0.1:2568/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  function place(room: Room<SpaceRoom>, x: number, y: number) {
    const player = harness.getRoomById<SpaceRoom>(room.roomId).state.players.get(room.sessionId)!;
    player.x = x; player.y = y;
    return player;
  }

  test('boards reject remote and unknown resources, strip forged identity, and rate-limit posts', async () => {
    const alice = await join('Alice');
    assert.equal((await alice.request('boardPost', { resourceId: 'message-wall', text: 'remote' })).ok, false);
    const player = place(alice, 500, 350);
    player.zoneId = 'forged-zone'; // Position, not a caller-provided zone, authorizes the action.
    assert.equal((await alice.request('boardPost', { resourceId: 'unknown', text: 'wrong resource' })).ok, false);
    const payload = { resourceId: 'message-wall', text: ' <b>saved</b> ', name: 'Forged', authorSessionId: 'other' };
    assert.equal((await alice.request('boardPost', payload)).ok, true);
    assert.equal((await alice.request('boardPost', { resourceId: 'message-wall', text: 'too fast' })).ok, false);
    await until(() => alice.state.notes.size === 1);
    const note = [...alice.state.notes.values()][0];
    assert.equal(note.name, 'Alice');
    assert.equal(note.authorSessionId, alice.sessionId);
    assert.equal(note.text, '<b>saved</b>');
    assert.equal(note.authorUserId, alice.state.players.get(alice.sessionId)?.userId);
  });

  test('board ownership survives reconnect but cannot be forged by another guest with the same nickname', async () => {
    const alice = await join('SameName');
    const bob = await join('SameName');
    place(alice, 500, 350); place(bob, 500, 350);
    await alice.request('boardPost', { resourceId: 'message-wall', text: 'owner-only' });
    await until(() => bob.state.notes.size === 1);
    const id = [...bob.state.notes.keys()][0];
    const forged = { resourceId: 'message-wall', id, authorSessionId: alice.sessionId };
    assert.equal((await bob.request('boardDelete', forged)).ok, false);
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const reconnected = new Promise<void>(resolve => alice.onReconnect.once(resolve));
    authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
    await reconnected;
    await delay(550);
    assert.equal((await alice.request('boardDelete', { resourceId: 'message-wall', id })).ok, true);
    await until(() => bob.state.notes.size === 0);
  });

  test('persistent boards synchronize across capacity-split rooms and survive room disposal', async () => {
    const alice = await join('Alice');
    const first = harness.getRoomById<SpaceRoom>(alice.roomId);
    first.maxClients = 1;
    const bob = await join('Bob');
    assert.notEqual(alice.roomId, bob.roomId);
    place(alice, 500, 350); place(bob, 500, 350);
    await alice.request('boardPost', { resourceId: 'message-wall', text: 'shared board' });
    await until(() => bob.state.notes.size === 1);
    const id = [...bob.state.notes.keys()][0];
    await delay(550);
    await alice.request('boardDelete', { resourceId: 'message-wall', id });
    await until(() => bob.state.notes.size === 0);
    await bob.request('boardPost', { resourceId: 'message-wall', text: 'retained' });
    await alice.leave(); await bob.leave();
    await harness.cleanup();
    const carol = await join('Carol');
    assert.equal([...carol.state.notes.values()][0]?.text, 'retained');
  });

  test('pomodoro validates location and transitions, uses server durations and restores late-join state', async () => {
    const alice = await join('Alice');
    assert.equal((await alice.request('pomodoro', { resourceId: 'focus-corner', action: 'start', mode: 'focus' })).ok, false);
    place(alice, 100, 350);
    const forged = { resourceId: 'focus-corner', action: 'start' as const, mode: 'break' as const, endsAt: 1, remainingMs: 1 };
    assert.equal((await alice.request('pomodoro', forged)).ok, true);
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const timer = authoritative.state.pomodoros.get('focus-corner')!;
    assert.equal(timer.remainingMs, 300_000);
    assert.ok(timer.endsAt > Date.now() + 299_000);
    const bob = await join('Bob');
    assert.equal(bob.state.pomodoros.get('focus-corner')?.endsAt, timer.endsAt);
    place(bob, 100, 350);
    assert.equal((await bob.request('pomodoro', { resourceId: 'focus-corner', action: 'start', mode: 'focus' })).ok, false);
    await delay(550);
    assert.equal((await alice.request('pomodoro', { resourceId: 'focus-corner', action: 'pause' })).ok, true);
    const remaining = timer.remainingMs;
    assert.equal(timer.endsAt, 0);
    await delay(550);
    assert.equal(timer.remainingMs, remaining);
    assert.equal((await alice.request('pomodoro', { resourceId: 'focus-corner', action: 'resume' })).ok, true);
    assert.ok(Math.abs(timer.endsAt - Date.now() - remaining) < 100);
    await delay(550);
    assert.equal((await alice.request('pomodoro', { resourceId: 'focus-corner', action: 'reset', mode: 'focus' })).ok, true);
    assert.equal(timer.status, 'idle');
    assert.equal(timer.remainingMs, 1_500_000);
    assert.equal(timer.endsAt, 0);
  });

  test('pomodoro completes on the server clock, recovers after reconnect, and is isolated per room', async () => {
    const alice = await join('Alice');
    place(alice, 100, 350);
    await alice.request('pomodoro', { resourceId: 'focus-corner', action: 'start', mode: 'focus' });
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const timer = authoritative.state.pomodoros.get('focus-corner')!;
    authoritative.maxClients = 1;
    const bob = await join('Bob');
    assert.equal(bob.state.pomodoros.get('focus-corner')?.status, 'idle');
    const endsAt = timer.endsAt;
    const reconnected = new Promise<void>(resolve => alice.onReconnect.once(resolve));
    authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
    await reconnected;
    await until(() => alice.state.pomodoros.get('focus-corner')?.endsAt === endsAt);
    timer.endsAt = Date.now() - 1;
    await until(() => timer.status === 'finished');
    await until(() => alice.state.pomodoros.get('focus-corner')?.remainingMs === 0);
    assert.equal(timer.endsAt, 0);
    assert.equal(bob.state.pomodoros.get('focus-corner')?.status, 'idle');
  });

  test('malformed feature requests reject without mutations or disconnecting the guest', async () => {
    const alice = await join('Alice');
    place(alice, 500, 350);
    await assert.rejects(alice.request('boardPost', { resourceId: 'message-wall', text: ' ' }));
    await assert.rejects(alice.request('boardDelete', { resourceId: 'message-wall', id: 'invalid' }));
    place(alice, 100, 350);
    const invalid = { resourceId: 'focus-corner', action: 'start' as const, mode: 'invalid' as 'focus' };
    await assert.rejects(alice.request('pomodoro', invalid));
    assert.equal(alice.connection.isOpen, true);
    assert.equal(alice.state.notes.size, 0);
    assert.equal(alice.state.pomodoros.get('focus-corner')?.status, 'idle');
  });
  test('missing, unsigned and forged identity claims cannot authorize room joins', async () => {
    await assert.rejects(harness.sdk.joinOrCreate('space', { name: 'Forged', avatar: 'mint', userId: 'owner', role: 'admin' }));
    await assert.rejects(sdk('better-auth.session_token=forged').joinOrCreate('space', { name: 'Forged', avatar: 'mint' }));
    const response = await fetch(endpoint + '/api/me');
    assert.equal(response.status, 401);
    assert.equal((await fetch(endpoint + '/api/auth/sign-up/email', { method: 'POST' })).status, 404);
  });

  test('only the current identity can update its profile and role claims are ignored', async () => {
    const cookie = await createIdentity();
    const other = await createIdentity();
    const original = await me(other);
    const response = await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Saved', avatar: 'violet', id: original.id, userId: original.id, role: 'admin' }) });
    assert.equal(response.status, 200);
    const saved = await me(cookie);
    assert.equal(saved.role, 'member');
    assert.equal(saved.name, 'Saved');
    assert.deepEqual(await me(other), original);
    const alice = await join('ForgedJoin', 'amber', cookie);
    const second = await join('AnotherJoin', 'mint', cookie);
    assert.equal(alice.state.players.get(alice.sessionId)?.name, 'Saved');
    assert.equal(second.state.players.get(second.sessionId)?.userId, saved.id);
    const updated = await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Changed', avatar: 'amber' }) });
    assert.equal(updated.status, 200);
    await until(() => second.state.players.get(alice.sessionId)?.name === 'Changed');
    await until(() => second.state.players.get(second.sessionId)?.avatar === 'amber');
    assert.equal((await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"name":"Evil"}' })).status, 403);
    assert.equal((await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: '{"name":"Evil"}' })).status, 403);
    assert.equal((await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Evil"}' })).status, 401);
    assert.equal((await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"name":""}' })).status, 400);
  });

  test('stable identity owns notes after consented leave and a fresh room connection', async () => {
    const cookie = await createIdentity();
    const alice = await join('Alice', 'mint', cookie);
    place(alice, 500, 350);
    await alice.request('boardPost', { resourceId: 'message-wall', text: 'my persistent note' });
    await until(() => alice.state.notes.size === 1);
    const id = [...alice.state.notes.keys()][0];
    const oldConnection = alice.sessionId;
    const ownerId = alice.state.players.get(oldConnection)!.userId;
    await alice.leave();
    const returned = await join('Same identity', 'violet', cookie);
    assert.notEqual(returned.sessionId, oldConnection);
    assert.equal(returned.state.players.get(returned.sessionId)?.userId, ownerId);
    place(returned, 500, 350);
    assert.equal((await returned.request('boardDelete', { resourceId: 'message-wall', id })).ok, true);
  });

  test('admin can moderate others notes, demotion takes effect without reconnecting', async () => {
    const alice = await join('Alice');
    const cookie = await createIdentity();
    const moderator = await join('Moderator', 'mint', cookie);
    const userId = (await me(cookie)).id;
    place(alice, 500, 350); place(moderator, 500, 350);
    await alice.request('boardPost', { resourceId: 'message-wall', text: 'moderate me' });
    await until(() => moderator.state.notes.size === 1);
    const id = [...moderator.state.notes.keys()][0];
    const forged = { resourceId: 'message-wall', id, role: 'admin', admin: true, authorUserId: alice.state.players.get(alice.sessionId)!.userId };
    assert.equal((await moderator.request('boardDelete', forged)).ok, false);
    assert.equal(setRole('unknown', 'admin'), false);
    assert.equal(setRole(userId, 'admin'), true);
    place(moderator, 352, 384);
    assert.equal((await moderator.request('boardDelete', { resourceId: 'message-wall', id })).ok, false);
    await delay(550); place(moderator, 500, 350);
    assert.equal((await moderator.request('boardDelete', { resourceId: 'message-wall', id })).ok, true);
    await delay(550);
    await alice.request('boardPost', { resourceId: 'message-wall', text: 'after demotion' });
    await until(() => moderator.state.notes.size === 1 && [...moderator.state.notes.keys()][0] !== id);
    const secondId = [...moderator.state.notes.keys()][0];
    assert.equal(setRole(userId, 'member'), true);
    assert.equal((await moderator.request('boardDelete', { resourceId: 'message-wall', id: secondId })).ok, false);
  });

  test('legacy session-owned notes are preserved and only an admin can delete them', async () => {
    const id = 'e4b28642-eaf2-4d65-89fd-c5d1ea9d15d8';
    db.prepare('INSERT INTO board_notes (id, resource_id, author_session_id, name, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, 'message-wall', 'old-session', 'Legacy', 'preserved', Date.now());
    const cookie = await createIdentity();
    const alice = await join('Legacy', 'mint', cookie);
    assert.equal(alice.state.notes.get(id)?.authorUserId, '');
    place(alice, 500, 350);
    assert.equal((await alice.request('boardDelete', { resourceId: 'message-wall', id })).ok, false);
    setRole((await me(cookie)).id, 'admin');
    await delay(550);
    assert.equal((await alice.request('boardDelete', { resourceId: 'message-wall', id })).ok, true);
  });

  test('one-time binding transfers the verified identity and admin role, consumes once and stores only a hash', async () => {
    const cookie = await createIdentity();
    const owner = await me(cookie);
    setRole(owner.id, 'admin');
    const generated = await fetch(endpoint + '/api/auth/one-time-token/generate', { headers: { Cookie: cookie, Authorization: 'Basic ignored' } });
    assert.equal(generated.status, 200);
    const { token } = await generated.json() as { token: string };
    assert.equal(db.prepare('SELECT id FROM auth_verification WHERE identifier = ?').get('one-time-token:' + token), undefined);
    const responses = await Promise.all([1, 2].map(() => fetch(endpoint + '/api/auth/one-time-token/verify', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
    const boundCookie = responses.find(response => response.status === 200)!.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.deepEqual(await me(boundCookie), { ...owner, role: 'admin' });
    const source = await join('Source', 'mint', cookie);
    const target = await join('Target', 'amber', boundCookie);
    assert.notEqual(source.sessionId, target.sessionId);
    assert.equal(target.state.players.get(target.sessionId)?.userId, owner.id);
    place(source, 500, 350); place(target, 500, 350);
    await source.request('boardPost', { resourceId: 'message-wall', text: 'cross-device' });
    await until(() => target.state.notes.size === 1);
    assert.equal((await target.request('boardDelete', { resourceId: 'message-wall', id: [...target.state.notes.keys()][0] })).ok, true);
  });

  test('expired and invalid binding tokens do not create a session', async () => {
    const cookie = await createIdentity();
    const generated = await fetch(endpoint + '/api/auth/one-time-token/generate', { headers: { Cookie: cookie } });
    const { token } = await generated.json() as { token: string };
    db.prepare('UPDATE auth_verification SET expiresAt = ?').run(new Date(Date.now() - 1000).toISOString());
    for (const value of [token, 'invalid']) {
      const response = await fetch(endpoint + '/api/auth/one-time-token/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: value }) });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal((await fetch(endpoint + '/api/auth/one-time-token/generate')).status, 401);
  });

  test('sign-out revokes the session immediately for writes and then disconnects the room', async () => {
    const cookie = await createIdentity();
    const alice = await join('Alice', 'mint', cookie);
    place(alice, 500, 350);
    const left = new Promise<number>(resolve => alice.onLeave.once(resolve));
    assert.equal((await fetch(endpoint + '/api/auth/sign-out', { method: 'POST', headers: { Cookie: cookie, Origin: endpoint, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    const result = await alice.request('boardPost', { resourceId: 'message-wall', text: 'revoked' });
    assert.equal(result.ok, false);
    assert.deepEqual(db.prepare('SELECT count(*) AS count FROM board_notes').get(), { count: 0 });
    assert.equal(await left, 4003);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: cookie } })).status, 401);
    await assert.rejects(sdk(cookie).joinOrCreate('space', { name: 'revoked', avatar: 'mint' }));
  });

  test('profile responses forward refreshed session cookies to the browser', async () => {
    const cookie = await createIdentity();
    const owner = await me(cookie);
    const oldExpiry = new Date(Date.now() + 28 * 24 * 60 * 60_000).toISOString();
    db.prepare('UPDATE auth_session SET expiresAt = ?, updatedAt = ? WHERE userId = ?')
      .run(oldExpiry, new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(), owner.id);
    const response = await fetch(endpoint + '/api/me', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.ok(response.headers.getSetCookie().some(value => value.includes('session_token=')));
    const session = db.prepare('SELECT expiresAt FROM auth_session WHERE userId = ?').get(owner.id) as { expiresAt: string };
    assert.ok(new Date(session.expiresAt).getTime() > new Date(oldExpiry).getTime());
  });

  test('a revoked session cannot use the Colyseus reconnection window', async () => {
    const cookie = await createIdentity();
    const alice = await join('Alice', 'mint', cookie);
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const token = alice.reconnectionToken;
    alice.reconnection.enabled = false;
    authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
    await until(() => !authoritative.state.players.get(alice.sessionId)?.connected);
    await fetch(endpoint + '/api/auth/sign-out', { method: 'POST', headers: { Cookie: cookie, Origin: endpoint, 'Content-Type': 'application/json' }, body: '{}' });
    await assert.rejects(sdk(cookie).reconnect(token));
    await until(() => !authoritative.state.players.has(alice.sessionId));
  });

  test('expired anonymous sessions cannot join a room or read profiles', async () => {
    const cookie = await createIdentity();
    const owner = await me(cookie);
    db.prepare('UPDATE auth_session SET expiresAt = ? WHERE userId = ?').run(new Date(Date.now() - 1000).toISOString(), owner.id);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: cookie } })).status, 401);
    await assert.rejects(sdk(cookie).joinOrCreate('space', { name: 'Expired', avatar: 'mint' }));
  });

  test('a full room rejects joinById and matchmaking creates a separate room', async () => {
    const alice = await join('Alice');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    assert.equal(authoritative.maxClients, 32);
    authoritative.maxClients = 2;
    const bob = await join('Bob');
    assert.equal(alice.roomId, bob.roomId);
    await assert.rejects(harness.sdk.joinById(alice.roomId, { name: 'Charlie', avatar: 'mint' }));
    const charlie = await join('Charlie');
    assert.notEqual(charlie.roomId, alice.roomId);
    assert.equal(authoritative.state.players.size, 2);
  });
  test('a reconnect timeout releases the player and rejects the expired token', async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    player.x = 408; player.y = 392;
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: false })).ok, true);
    const object = authoritative.state.worldObjects.get('lobby')!.objects.get('lobby-seat-1')!;
    authoritative.reconnectionSeconds = 0.1;
    alice.reconnection.enabled = false;
    const token = alice.reconnectionToken;
    authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
    await until(() => !authoritative.state.players.has(alice.sessionId));
    await until(() => bob.state.players.size === 1);
    await assert.rejects(harness.sdk.reconnect(token));
    assert.equal(authoritative.clients.length, 1);
    assert.equal(object.occupiedBy, ''); assert.equal(object.variant, 'empty');
  });
  for (const [name, type, payload] of [
    ['invalid direction', 'input', { x: 2, y: 0 }],
    ['wrong direction type', 'input', { x: '1', y: 0 }],
    ['fractional direction', 'input', { x: 0.5, y: 0 }],
    ['blank chat', 'chat', { text: '   ' }],
    ['oversized chat', 'chat', { text: 'x'.repeat(501) }],
  ] as const) test(`malformed ${name} disconnects the sender and releases their seat`, async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const left = new Promise<number>(resolve => alice.onLeave.once(resolve));
    // Use the runtime wire path to test data that violates the static contract.
    if (type === 'input') {
      const input = inputSchemaTestPayload(payload);
      alice.send('input', input);
    } else alice.send('chat', payload);
    assert.equal(await left, 4002);
    await until(() => !authoritative.state.players.has(alice.sessionId));
    await until(() => bob.state.players.size === 1);
    assert.equal(authoritative.clients.length, 1);
  });
});

// Deliberately encode a string as a numeric field for malformed-wire testing.
function inputSchemaTestPayload(value: unknown): { x: number; y: number } {
  return value as { x: number; y: number };
}
