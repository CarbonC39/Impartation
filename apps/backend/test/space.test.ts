import assert from 'node:assert/strict';
import { before, after, beforeEach, describe, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room } from '@colyseus/sdk';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';

process.env.DATABASE_PATH = ':memory:';
const { server } = await import('../src/app.config.js');
const { db } = await import('../src/db.js');

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
  });
  async function join(name: string, avatar: 'mint' | 'amber' | 'violet' = 'mint') {
    const room = await harness.sdk.joinOrCreate('space', { name, avatar });
    room.onMessage('chat', () => {});
    room.onError(() => {});
    room.reconnection.minUptime = 0;
    connections.push(room);
    await room.waitForInitialState();
    return room;
  }
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
    await assert.rejects(harness.sdk.joinOrCreate('space', { name: '', avatar: 'mint' }));
    // The SDK's permissive overload allows malformed data; the server must reject it.
    await assert.rejects(harness.sdk.joinOrCreate('space', { name: 'Alice', avatar: 'unknown' }));
  });
  test('server movement stops after stale input and prevents walking through collisions', async () => {
    const alice = await join('Alice');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    const x = player.x;
    alice.send('input', { x: 1, y: 0 });
    await until(() => player.x > x);
    await delay(350);
    const stopped = player.x;
    await delay(150);
    assert.equal(player.x, stopped);
    player.x = 310; player.y = 250;
    alice.send('input', { x: 1, y: 0 });
    await delay(150);
    assert.equal(player.x, 310);
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
  test('chat cooldown is per player, and guests are never persisted as accounts', async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const names: string[] = [];
    bob.onMessage('chat', message => names.push(message.name));
    alice.send('chat', { text: 'from Alice' });
    bob.send('chat', { text: 'from Bob' });
    await until(() => names.length === 2);
    assert.deepEqual(names.sort(), ['Alice', 'Bob']);
    assert.deepEqual(db.prepare('SELECT count(*) AS count FROM profiles').get(), { count: 0 });
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
    assert.deepEqual(db.prepare('SELECT count(*) AS count FROM profiles').get(), { count: 0 });
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
    authoritative.reconnectionSeconds = 0.1;
    alice.reconnection.enabled = false;
    const token = alice.reconnectionToken;
    authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
    await until(() => !authoritative.state.players.has(alice.sessionId));
    await until(() => bob.state.players.size === 1);
    await assert.rejects(harness.sdk.reconnect(token));
    assert.equal(authoritative.clients.length, 1);
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
