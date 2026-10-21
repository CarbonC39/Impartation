import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { before, after, beforeEach, describe, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { WebSocketClient } from '@colyseus/ws-transport';
import type { SpaceRoom } from '../src/rooms/SpaceRoom.js';
import { rmSync } from 'node:fs';
import { createRoomWorldFixture } from './world-fixture.js';
import { CHARACTER_ACTION_NAMES, DEFAULT_APPEARANCE } from '@virtual-workspace/shared';

process.env.DATABASE_PATH = ':memory:';
const fixture = createRoomWorldFixture();
process.env.MAP_REGISTRY_PATH = fixture.registryPath;
process.env.EXTERNAL_TOOLS = JSON.stringify({
  'shared-canvas': { url: 'https://board.example/boards/workspace' },
});
process.env.VOICE_MAX_PEERS = '1';
process.env.VOICE_TURN_URLS = 'turn:turn.example.test:3478,turns:turn.example.test:5349';
process.env.VOICE_TURN_SHARED_SECRET = 'test-turn-shared-secret-with-at-least-32-chars';
const { server } = await import('../src/app.config.js');
const { db } = await import('../src/db.js');
const { setRole } = await import('../src/identity.js');
const endpoint = 'http://127.0.0.1:2568';
async function createIdentity() {
  const response = await fetch(endpoint + '/api/register', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `user_${randomUUID().replaceAll('-', '').slice(0, 16)}`, password: 'password1234', displayName: '访客' }) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
}
async function signIn(cookie: string) {
  const account = await me(cookie);
  const response = await fetch(endpoint + '/api/auth/sign-in/username', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, password: 'password1234' }) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
function sdk(cookie: string) { return new Client<typeof server>(endpoint, { headers: { Cookie: cookie } }); }
async function me(cookie: string) {
  const response = await fetch(endpoint + '/api/me', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return await response.json() as { id: string; name: string; avatar: string; username: string; appearance: object; role: 'member' | 'admin' };
}

async function until(predicate: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for room state');
    await delay(10);
  }
}

// This limit covers the whole serial suite, including real password hashing and timer waits.
describe('space room over real WebSocket connections', { timeout: 120_000 }, () => {
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
  async function join(name: string, avatar: 'mint' | 'amber' | 'violet' = 'mint', cookie?: string, spaceId = 'main') {
    const identityCookie = cookie ?? await createIdentity();
    if (!cookie) {
      const profile = await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: identityCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatar }) });
      assert.equal(profile.status, 200, await profile.clone().text());
    }
    const room = await sdk(identityCookie).joinOrCreate('space', { name, avatar, spaceId });
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
  test('voice config is public and includes bounded proximity and ICE settings', async () => {
    const response = await fetch(endpoint + '/api/voice-config');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      connectRadius: 160, disconnectRadius: 192, maxPeers: 1, scanIntervalMs: 1000 });
  });
  test('TURN credentials require an active login and are short-lived coturn REST credentials', async () => {
    const unauthenticated = await fetch(endpoint + '/api/voice-credentials');
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');

    const cookie = await createIdentity();
    const response = await fetch(endpoint + '/api/voice-credentials', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const value = await response.json() as { iceServers: { urls: string[]; username: string; credential: string }[]; expiresAt: number };
    assert.equal(value.iceServers.length, 1);
    const server = value.iceServers[0]!;
    const [expiry, userId] = server.username.split(':');
    assert.ok(Number(expiry) >= Math.floor(Date.now() / 1000) + 3590);
    assert.ok(userId);
    assert.equal(value.expiresAt, Number(expiry) * 1000);
    assert.deepEqual(server.urls, ['turn:turn.example.test:3478', 'turns:turn.example.test:5349']);
    assert.equal(server.credential, createHmac('sha1', process.env.VOICE_TURN_SHARED_SECRET!).update(server.username).digest('base64'));
    assert.equal(JSON.stringify(value).includes(process.env.VOICE_TURN_SHARED_SECRET!), false);
  });
  test('TURN credentials stop issuing after session revocation or account suspension', async () => {
    const revokedCookie = await createIdentity();
    const signedOut = await fetch(endpoint + '/api/auth/sign-out', { method: 'POST', headers: { Cookie: revokedCookie, Origin: endpoint,
      'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(signedOut.status, 200);
    assert.equal((await fetch(endpoint + '/api/voice-credentials', { headers: { Cookie: revokedCookie } })).status, 401);

    const suspendedCookie = await createIdentity();
    const suspendedProfile = await me(suspendedCookie);
    db.prepare('UPDATE auth_user SET suspended = 1 WHERE id = ?').run(suspendedProfile.id);
    const response = await fetch(endpoint + '/api/voice-credentials', { headers: { Cookie: suspendedCookie } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  test('voice signaling requires opt-in, server proximity, same map and pair capacity', async () => {
    const alice = await join('VoiceAlice');
    const bob = await join('VoiceBob');
    const carol = await join('VoiceCarol');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const a = authoritative.state.players.get(alice.sessionId)!;
    const b = authoritative.state.players.get(bob.sessionId)!;
    const c = authoritative.state.players.get(carol.sessionId)!;
    const [initiator, receiver] = alice.sessionId < bob.sessionId ? [alice, bob] : [bob, alice];
    const connectionId = '550e8400-e29b-41d4-a716-446655440000';
    const offer = { peerId: receiver.sessionId, connectionId, sdp: 'test-offer' };
    const receivedOffers: { sessionId: string; sdp: string }[] = [];
    const receivedCandidates: { sessionId: string; candidate: string }[] = [];
    const ended: string[] = [];
    receiver.onMessage('voiceOffer', value => receivedOffers.push(value));
    receiver.onMessage('voiceIceCandidate', value => receivedCandidates.push(value));
    receiver.onMessage('voiceEnd', value => ended.push(value.sessionId));
    initiator.onMessage('voiceAnswer', () => {});
    initiator.onMessage('voiceEnd', () => {});
    assert.equal(await initiator.request('voiceOffer', offer), false);
    assert.equal(await initiator.request('voiceEnabled', { enabled: true }), true);
    assert.equal(await receiver.request('voiceEnabled', { enabled: true }), true);
    assert.equal(await carol.request('voiceEnabled', { enabled: true }), true);
    assert.equal(await initiator.request('voiceOffer', { ...offer, peerId: 'missing' }), false);
    b.x = a.x + 500;
    assert.equal(await initiator.request('voiceOffer', offer), false);
    b.x = a.x; b.mapId = 'other-map';
    assert.equal(await initiator.request('voiceOffer', offer), false);
    b.mapId = a.mapId;
    assert.equal(await initiator.request('voiceOffer', offer), true);
    await until(() => receivedOffers.length === 1);
    assert.equal(receivedOffers[0]?.sessionId, initiator.sessionId);
    assert.equal(await receiver.request('voiceAnswer', { peerId: initiator.sessionId, connectionId, sdp: 'answer' }), true);
    initiator.send('voiceIceCandidate', { peerId: receiver.sessionId, connectionId, candidate: 'candidate:1',
      sdpMid: null, sdpMLineIndex: 0 });
    await until(() => receivedCandidates.length === 1);
    assert.equal(receivedCandidates[0]?.sessionId, initiator.sessionId);
    const thirdId = carol.sessionId;
    const [nextSender, nextTarget] = initiator.sessionId < thirdId ? [initiator, carol] : [carol, initiator];
    assert.equal(await nextSender.request('voiceOffer', { peerId: nextTarget.sessionId,
      connectionId: '550e8400-e29b-41d4-a716-446655440001', sdp: 'blocked' }), false);
    b.x = a.x + 175;
    await delay(1100);
    assert.equal(ended.length, 0);
    b.x = a.x + 500;
    await until(() => ended.includes(initiator.sessionId), 2500);
    assert.equal(await initiator.request('voiceOffer', offer), false);
    assert.equal(await initiator.request('voiceEnabled', { enabled: false }), true);
    assert.equal(authoritative.state.players.get(initiator.sessionId)?.voiceEnabled, false);
    assert.equal(c.voiceEnabled, true);
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
    await assert.rejects(client.joinOrCreate('space', { name: '', avatar: 'mint', spaceId: 'main' }));
    // The SDK's permissive overload allows malformed data; the server must reject it.
    await assert.rejects(client.joinOrCreate('space', { name: 'Alice', avatar: 'unknown', spaceId: 'main' }));
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
  for (const action of CHARACTER_ACTION_NAMES) {
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
  test('footprints outside anchor tiles perform sit in place', async () => {
    const alice = await join('AdjacentAction');
    const player = harness.getRoomById<SpaceRoom>(alice.roomId).state.players.get(alice.sessionId)!;
    player.x = 394; player.y = 392; player.facing = 'left';
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: false })).ok, true);
    assert.deepEqual([player.x, player.y, player.facing, player.actionTargetId, player.actionAnimated],
      [394, 392, 'left', '', false]);
  });
  test('wrong-facing anchors allow free actions without alignment or occupancy', async () => {
    const alice = await join('WrongFacing');
    const room = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = room.state.players.get(alice.sessionId)!;
    const object = room.state.worldObjects.get('lobby')!.objects.get('lobby-seat-1')!;
    for (const facing of ['down', 'left', 'right']) {
      player.x = 399.99; player.y = 392; player.facing = facing;
      const result = await alice.request('activateAction', { action: 'sit', facing: 'up' });
      assert.equal(result.ok, true); assert.match(result.message, /已原地坐下.*面向上方/);
      assert.deepEqual([player.x, player.y, player.facing, player.action, player.actionTargetId], [399.99, 392, facing, 'sit', '']);
      assert.equal(object.occupiedBy, ''); assert.equal(object.variant, 'empty');
      await delay(510);
    }
  });
  test('matching sit anchor requires facing, ignores forged context and retains occupancy', async () => {
    const alice = await join('SeatedAlice');
    const bob = await join('SeatedBob');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    const other = authoritative.state.players.get(bob.sessionId)!;
    player.x = 399.99; player.y = 386; player.facing = 'up';
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
    other.x = 408; other.y = 392; other.facing = 'up';
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
  test('action matching applies world-pixel offsets and keeps facing when the anchor has none', async () => {
    const alice = await join('Reader');
    const player = harness.getRoomById<SpaceRoom>(alice.roomId).state.players.get(alice.sessionId)!;
    player.x = 354; player.y = 434; player.facing = 'right';
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: false })).ok, true);
    assert.deepEqual([player.x, player.y, player.facing, player.action, player.actionTargetId],
      [362, 439, 'right', 'sit', 'reading-spot']);
    await delay(550);
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: true })).ok, true);
    assert.deepEqual([player.x, player.y], [362, 439]);
    assert.equal(player.actionAnimated, true);
  });
  test('non-zero movement cancels an action even when collision blocks the movement', async () => {
    const alice = await join('BlockedAction');
    const player = harness.getRoomById<SpaceRoom>(alice.roomId).state.players.get(alice.sessionId)!;
    player.x = 310; player.y = 250;
    assert.equal((await alice.request('activateAction', { action: 'sit', animated: true })).ok, true);
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
    player.x = 408; player.y = 392; player.facing = 'up';
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
    player.x = 408; player.y = 392; player.facing = 'up';
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
    bob.onMessage('chat', message => {
      received.push(message.text); assert.equal(message.name, 'Alice'); assert.equal(message.sessionId, alice.sessionId);
    });
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
  test('typing is a server-held hint that sending chat or expiry clears', async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const seen = () => bob.state.players.get(alice.sessionId)?.typing;
    alice.send('typing', { typing: true });
    await until(() => seen() === true);
    alice.send('typing', { typing: false });
    await until(() => seen() === false);
    alice.send('typing', { typing: true });
    await until(() => seen() === true);
    alice.send('chat', { text: 'done typing' });
    await until(() => seen() === false);
    alice.send('typing', { typing: true });
    await until(() => seen() === true);
    // Expire the hint without waiting the full timeout; the room's 1s clock clears it.
    (authoritative as unknown as { typingUntil: Map<string, number> }).typingUntil.set(alice.sessionId, Date.now() - 1);
    await until(() => seen() === false, 2500);
  });
  test('unexpected disconnect reconnects with the same identity and position', async () => {
    const alice = await join('Alice');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    const sessionId = alice.sessionId;
    assert.equal(await alice.request('voiceEnabled', { enabled: true }), true);
    assert.equal(player.voiceEnabled, true);
    alice.send('input', { x: 1, y: 0 });
    const initialX = player.x;
    await until(() => player.x > initialX);
    const position = { x: player.x, y: player.y };
    const reconnected = new Promise<void>(resolve => alice.onReconnect.once(resolve));
    authoritative.clients.find(client => client.sessionId === sessionId)!.leave(1001, 'test network drop');
    await until(() => player.connected === false);
    assert.equal(player.voiceEnabled, false);
    await delay(100);
    assert.deepEqual({ x: player.x, y: player.y }, position);
    await reconnected;
    await until(() => player.connected);
    assert.equal(player.voiceEnabled, false);
    assert.equal(alice.sessionId, sessionId);
    assert.equal(authoritative.state.players.get(sessionId), player);
    assert.deepEqual({ x: player.x, y: player.y }, position);
    assert.equal(authoritative.state.players.size, 1);

    const reconnectedAgain = new Promise<void>(resolve => alice.onReconnect.once(resolve));
    authoritative.clients.find(client => client.sessionId === sessionId)!.leave(1001, 'second test network drop');
    await until(() => player.connected === false);
    await reconnectedAgain;
    await until(() => player.connected);
    assert.equal(alice.sessionId, sessionId);
    assert.equal(authoritative.state.players.get(sessionId), player);
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

  test('persistent boards synchronize within a Space and survive room disposal', async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    assert.equal(alice.roomId, bob.roomId);
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

  test('pomodoro completes on the server clock, recovers after reconnect, and is isolated per Space', async () => {
    const alice = await join('Alice');
    place(alice, 100, 350);
    await alice.request('pomodoro', { resourceId: 'focus-corner', action: 'start', mode: 'focus' });
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const timer = authoritative.state.pomodoros.get('focus-corner')!;
    const bob = await join('Bob', 'mint', undefined, 'other');
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
    await assert.rejects(harness.sdk.joinOrCreate('space', { name: 'Forged', avatar: 'mint', userId: 'owner', role: 'admin', spaceId: 'main' }));
    await assert.rejects(sdk('better-auth.session_token=forged').joinOrCreate('space', { name: 'Forged', avatar: 'mint', spaceId: 'main' }));
    const response = await fetch(endpoint + '/api/me');
    assert.equal(response.status, 401);
    assert.equal((await fetch(endpoint + '/api/auth/sign-up/email', { method: 'POST' })).status, 404);
    assert.equal((await fetch(endpoint + '/api/auth/sign-up/username', { method: 'POST' })).status, 404);
    assert.equal((await fetch(endpoint + '/api/auth/sign-in/anonymous', { method: 'POST' })).status, 404);
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
    assert.equal(alice.state.players.get(alice.sessionId)?.name, 'Saved');
    const updated = await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Changed', avatar: 'amber' }) });
    assert.equal(updated.status, 200);
    await until(() => alice.state.players.get(alice.sessionId)?.name === 'Changed');
    await until(() => alice.state.players.get(alice.sessionId)?.avatar === 'amber');
    const currentAppearance = { ...DEFAULT_APPEARANCE, hair: { ...DEFAULT_APPEARANCE.hair, color: '#a24dcc' } };
    const aliased = await fetch(endpoint + '/api/me', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'AliasName', name: 'IgnoredName', currentAppearance, appearance: DEFAULT_APPEARANCE }) });
    assert.equal(aliased.status, 200);
    const aliasProfile = await aliased.json() as { name: string; displayName: string; currentAppearance: typeof DEFAULT_APPEARANCE };
    assert.equal(aliasProfile.name, 'AliasName');
    assert.equal(aliasProfile.displayName, 'AliasName');
    assert.deepEqual(aliasProfile.currentAppearance, currentAppearance);
    await until(() => alice.state.players.get(alice.sessionId)?.name === 'AliasName');
    await until(() => alice.state.players.get(alice.sessionId)?.appearance === JSON.stringify(currentAppearance));
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
    await assert.rejects(sdk(cookie).joinOrCreate('space', { name: 'revoked', avatar: 'mint', spaceId: 'main' }));
  });

  test('admin kick disconnects every Space session, invalidates reconnect tokens and allows a fresh join', async () => {
    const adminCookie = await createIdentity();
    const adminId = (await me(adminCookie)).id;
    assert.equal(setRole(adminId, 'admin'), true);
    const userCookie = await createIdentity();
    const account = await me(userCookie);
    const userId = account.id;
    const main = await join('跨空间访客', 'mint', userCookie, 'main');
    const other = await join('跨空间访客', 'mint', userCookie, 'other');
    const mainToken = main.reconnectionToken;
    const otherToken = other.reconnectionToken;
    main.reconnection.enabled = false;
    other.reconnection.enabled = false;
    const mainLeft = new Promise<number>(resolve => main.onLeave.once(resolve));
    const otherLeft = new Promise<number>(resolve => other.onLeave.once(resolve));
    const kicked = await fetch(`${endpoint}/api/admin/users/${encodeURIComponent(userId)}/kick`, { method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
    assert.equal(kicked.status, 200, await kicked.clone().text());
    assert.equal(await mainLeft, 4011);
    assert.equal(await otherLeft, 4011);
    await assert.rejects(sdk(userCookie).reconnect(mainToken));
    await assert.rejects(sdk(userCookie).reconnect(otherToken));
    const fresh = await join('跨空间访客', 'mint', userCookie);
    assert.equal(fresh.state.players.get(fresh.sessionId)?.userId, userId);
    await delay(1100);
    assert.equal(fresh.connection.isOpen, true);
    assert.equal(fresh.state.players.has(fresh.sessionId), true);
  });

  test('queued local CLI kick reaches every active Space without an in-process event', async () => {
    const cookie = await createIdentity();
    const account = await me(cookie);
    const main = await join('CLI target', 'mint', cookie, 'main');
    const other = await join('CLI target', 'mint', cookie, 'other');
    const mainLeft = new Promise<number>(resolve => main.onLeave.once(resolve));
    const otherLeft = new Promise<number>(resolve => other.onLeave.once(resolve));
    // A separate CLI process only writes this shared SQLite queue; it cannot emit server events.
    db.prepare('INSERT INTO moderation_commands (user_id, created_at) VALUES (?, ?)').run(account.id, Date.now());
    assert.equal(await mainLeft, 4011);
    assert.equal(await otherLeft, 4011);
    assert.equal((await me(cookie)).id, account.id);
    const fresh = await join('CLI target', 'mint', cookie);
    await delay(1100);
    assert.equal(fresh.connection.isOpen, true);
  });

  test('suspending an account disconnects live room sessions and blocks joins until unsuspended', async () => {
    const adminCookie = await createIdentity();
    const adminId = (await me(adminCookie)).id;
    assert.equal(setRole(adminId, 'admin'), true);
    const userCookie = await createIdentity();
    const account = await me(userCookie);
    const userId = account.id;
    const player = await join('被暂停成员', 'mint', userCookie);
    const left = new Promise<number>(resolve => player.onLeave.once(resolve));
    const suspended = await fetch(`${endpoint}/api/admin/users/${encodeURIComponent(userId)}/suspend`, { method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
    assert.equal(suspended.status, 200, await suspended.clone().text());
    assert.equal(await left, 4011);
    await assert.rejects(sdk(userCookie).joinOrCreate('space', { name: 'Paused', avatar: 'mint', spaceId: 'main' }));
    const unsuspended = await fetch(`${endpoint}/api/admin/users/${encodeURIComponent(userId)}/unsuspend`, { method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
    assert.equal(unsuspended.status, 200, await unsuspended.clone().text());
    const signedIn = await fetch(endpoint + '/api/auth/sign-in/username', { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.username, password: 'password1234' }) });
    assert.equal(signedIn.status, 200, await signedIn.clone().text());
    const fresh = await join('被暂停成员', 'mint', signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; '));
    assert.equal(fresh.state.players.get(fresh.sessionId)?.userId, userId);
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

  test('expired account sessions cannot join a room or read profiles', async () => {
    const cookie = await createIdentity();
    const owner = await me(cookie);
    db.prepare('UPDATE auth_session SET expiresAt = ? WHERE userId = ?').run(new Date(Date.now() - 1000).toISOString(), owner.id);
    assert.equal((await fetch(endpoint + '/api/me', { headers: { Cookie: cookie } })).status, 401);
    await assert.rejects(sdk(cookie).joinOrCreate('space', { name: 'Expired', avatar: 'mint', spaceId: 'main' }));
  });

  test('Space directory and runtime isolate players, chat, voice, boards and timers', async () => {
    const catalog = await (await fetch(endpoint + '/api/world')).json() as { spaces: { id: string; name: string }[] };
    assert.deepEqual(catalog.spaces.map(space => [space.id, space.name]), [['main', 'Main'], ['other', 'Other']]);
    const alice = await join('Alice'); const bob = await join('Bob');
    const carol = await join('Carol', 'mint', undefined, 'other');
    assert.equal(alice.roomId, bob.roomId); assert.notEqual(alice.roomId, carol.roomId);
    const first = harness.getRoomById<SpaceRoom>(alice.roomId);
    const other = harness.getRoomById<SpaceRoom>(carol.roomId);
    assert.equal(first.state.spaceId, 'main'); assert.equal(other.state.spaceId, 'other');
    assert.equal(first.state.players.size, 2); assert.equal(other.state.players.size, 1);
    assert.deepEqual([...first.state.worldObjects.keys()], ['lobby']);
    assert.deepEqual([...other.state.privateAreas.keys()], ['lobby']);
    const received: string[] = []; const outside: string[] = [];
    bob.onMessage('chat', message => received.push(message.text));
    carol.onMessage('chat', message => outside.push(message.text));
    alice.send('chat', { text: 'Only main' });
    await until(() => received.length === 1); await delay(100);
    assert.deepEqual(received, ['Only main']); assert.deepEqual(outside, []);
    assert.equal(await alice.request('voiceEnabled', { enabled: true }), true);
    assert.equal(await carol.request('voiceEnabled', { enabled: true }), true);
    const [sender, receiver] = alice.sessionId < carol.sessionId ? [alice, carol] : [carol, alice];
    assert.equal(await sender.request('voiceOffer', { peerId: receiver.sessionId,
      connectionId: '550e8400-e29b-41d4-a716-446655440099', sdp: 'cross-space' }), false);
    place(alice, 500, 350); place(carol, 500, 350);
    assert.equal((await alice.request('boardPost', { resourceId: 'message-wall', text: 'Main board' })).ok, true);
    await until(() => bob.state.notes.size === 1);
    assert.equal(other.state.notes.size, 0);
    assert.equal((await carol.request('boardPost', { resourceId: 'message-wall', text: 'Other board' })).ok, true);
    assert.deepEqual([...first.state.notes.values()].map(note => note.text), ['Main board']);
    assert.deepEqual([...other.state.notes.values()].map(note => note.text), ['Other board']);
    place(alice, 100, 350); await delay(550);
    assert.equal((await alice.request('pomodoro', { resourceId: 'focus-corner', action: 'start', mode: 'focus' })).ok, true);
    assert.equal(first.state.pomodoros.get('focus-corner')?.status, 'running');
    assert.equal(other.state.pomodoros.get('focus-corner')?.status, 'idle');
  });

  test('unknown or mismatched Space IDs cannot join and explicit create cannot duplicate an active Space', async () => {
    const cookie = await createIdentity(); const client = sdk(cookie);
    await assert.rejects(client.joinOrCreate('space', { name: 'Unknown', spaceId: 'unknown' }), /Unknown Space/);
    const alice = await join('Alice');
    await assert.rejects(client.joinById(alice.roomId, { name: 'Wrong', spaceId: 'other' }), /Space does not match/);
    await assert.rejects(client.create('space', { name: 'Duplicate', spaceId: 'main' }), /Space already active/);
    assert.equal((await matchMaker.query({ name: 'space' })).length, 1);
    const bob = await join('Bob'); assert.equal(bob.roomId, alice.roomId);
  });

  test('the newest same-account connection replaces its Space seat across sessions and concurrent joins', async () => {
    const cookie = await createIdentity();
    const alternateLogin = await signIn(cookie);
    const options = { name: 'Same account', avatar: 'mint' as const, spaceId: 'main' };
    const results = await Promise.allSettled([
      sdk(cookie).joinOrCreate('space', options),
      sdk(cookie).joinOrCreate('space', options),
    ]);
    const joined = results.filter((result): result is PromiseFulfilledResult<Room<SpaceRoom>> => result.status === 'fulfilled');
    assert.ok(joined.length >= 1);
    for (const result of joined) {
      const room = result.value;
      connections.push(room);
      room.onMessage('chat', () => {}); room.onError(() => {});
    }
    await Promise.allSettled(joined.map(result => result.value.waitForInitialState()));
    const authoritative = harness.getRoomById<SpaceRoom>(joined[0]!.value.roomId);
    await until(() => authoritative.state.players.size === 1);
    const main = joined.find(result => authoritative.state.players.has(result.value.sessionId))?.value;
    assert.ok(main);
    assert.equal(authoritative.state.players.size, 1);

    const otherSpace = await sdk(cookie).joinOrCreate('space', { ...options, spaceId: 'other' });
    connections.push(otherSpace);
    otherSpace.onMessage('chat', () => {}); otherSpace.onError(() => {});
    await otherSpace.waitForInitialState();
    assert.notEqual(otherSpace.roomId, main.roomId);
    assert.equal(otherSpace.connection.isOpen, true);

    const first = await sdk(cookie).joinOrCreate('space', options);
    connections.push(first);
    first.onMessage('chat', () => {}); first.onError(() => {});
    await first.waitForInitialState();
    const firstToken = first.reconnectionToken;
    const firstLeft = new Promise<number>(resolve => first.onLeave.once(resolve));
    const second = await sdk(alternateLogin).joinOrCreate('space', options);
    connections.push(second);
    second.onMessage('chat', () => {}); second.onError(() => {});
    await second.waitForInitialState();
    assert.notEqual(first.sessionId, second.sessionId);
    assert.equal(await firstLeft, 4012);
    await assert.rejects(sdk(cookie).reconnect(firstToken));
    await until(() => authoritative.state.players.size === 1 && authoritative.state.players.has(second.sessionId));
    assert.equal(otherSpace.connection.isOpen, true);

    // A later leave from a superseded connection must not release the current account seat.
    const secondLeft = new Promise<number>(resolve => second.onLeave.once(resolve));
    const third = await sdk(cookie).joinOrCreate('space', options);
    connections.push(third);
    third.onMessage('chat', () => {}); third.onError(() => {});
    await third.waitForInitialState();
    assert.equal(await secondLeft, 4012);
    await until(() => authoritative.state.players.size === 1 && authoritative.state.players.has(third.sessionId));
    assert.equal(third.state.players.size, 1);
    assert.equal(otherSpace.connection.isOpen, true);

  });

  test('a dropped same-account connection is replaced and its reconnect token is invalidated', async () => {
    const cookie = await createIdentity();
    const alternateLogin = await signIn(cookie);
    const alice = await join('Alice', 'mint', cookie);
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const token = alice.reconnectionToken;
    alice.reconnection.enabled = false;
    authoritative.clients.find(client => client.sessionId === alice.sessionId)!.leave(1001);
    await until(() => authoritative.state.players.get(alice.sessionId)?.connected === false);
    const replacement = await sdk(alternateLogin).joinOrCreate('space', { name: 'Returned', avatar: 'mint', spaceId: 'main' });
    connections.push(replacement);
    replacement.onMessage('chat', () => {}); replacement.onError(() => {});
    await replacement.waitForInitialState();
    await assert.rejects(sdk(cookie).reconnect(token));
    await until(() => !authoritative.state.players.has(alice.sessionId));
    assert.equal(replacement.state.players.size, 1);
  });

  test('Portal runtime rejects a globally registered map outside the current Space', async () => {
    const alice = await join('Alice'); const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    const world = authoritative['maps'].get('lobby')!.world;
    // Exercise the runtime guard independently of startup validation.
    world.zones.push({ id: 'outside', kind: 'Portal', resourceId: 'outside', x: 16, y: 16, width: 32, height: 32,
      properties: { targetMap: 'unused', targetSpawn: 'default' } });
    try {
      player.x = 24; player.y = 24;
      const result = await alice.request('portal', { zoneId: 'outside' });
      assert.equal(result.ok, false); assert.match(result.message, /当前 Space/);
      assert.equal(player.mapId, 'lobby'); assert.deepEqual([player.x, player.y], [24, 24]);
    } finally { world.zones.pop(); }
  });

  test('a full Space lets the same account replace its seat and still rejects another account', async () => {
    const cookie = await createIdentity();
    const alternateLogin = await signIn(cookie);
    const alice = await join('Alice', 'mint', cookie);
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    assert.equal(authoritative.maxClients, 32);
    authoritative.maxClients = 1;
    await assert.rejects(harness.sdk.joinById(alice.roomId, { name: 'Other', avatar: 'mint', spaceId: 'main' }));
    const oldClient = authoritative.clients.find(client => client.sessionId === alice.sessionId);
    assert.ok(oldClient instanceof WebSocketClient);
    const aliceLeft = new Promise<number>(resolve => alice.onLeave.once(resolve));
    try {
      // Pause incoming data so the server cannot receive the peer's close acknowledgement.
      oldClient.ref.pause();
      const ownerReplacement = await sdk(alternateLogin).joinOrCreate('space', { name: 'Replacement', avatar: 'mint', spaceId: 'main' });
      connections.push(ownerReplacement);
      ownerReplacement.onMessage('chat', () => {}); ownerReplacement.onError(() => {});
      await ownerReplacement.waitForInitialState();
      assert.equal(await aliceLeft, 4012);
      await until(() => authoritative.state.players.size === 1 && authoritative.state.players.has(ownerReplacement.sessionId));
      assert.equal(ownerReplacement.roomId, alice.roomId);
      await assert.rejects(join('Charlie'), /Space is full/);
      assert.equal((await matchMaker.query({ name: 'space' })).length, 1);
    } finally {
      oldClient.ref.terminate();
    }
  });
  test('a reconnect timeout releases the player and rejects the expired token', async () => {
    const cookie = await createIdentity();
    const alice = await join('Alice', 'mint', cookie);
    const bob = await join('Bob');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const player = authoritative.state.players.get(alice.sessionId)!;
    player.x = 408; player.y = 392; player.facing = 'up';
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
    const replacement = await join('Replacement', 'mint', cookie);
    assert.equal(replacement.roomId, bob.roomId);
    assert.equal(authoritative.state.players.size, 2);
  });
  for (const [name, type, payload] of [
    ['invalid direction', 'input', { x: 2, y: 0 }],
    ['wrong direction type', 'input', { x: '1', y: 0 }],
    ['fractional direction', 'input', { x: 0.5, y: 0 }],
    ['blank chat', 'chat', { text: '   ' }],
    ['oversized chat', 'chat', { text: 'x'.repeat(501) }],
    ['non-boolean typing', 'typing', { typing: 'yes' }],
  ] as const) test(`malformed ${name} disconnects the sender and releases their seat`, async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const authoritative = harness.getRoomById<SpaceRoom>(alice.roomId);
    const left = new Promise<number>(resolve => alice.onLeave.once(resolve));
    // Use the runtime wire path to test data that violates the static contract.
    if (type === 'input') {
      const input = inputSchemaTestPayload(payload);
      alice.send('input', input);
    } else if (type === 'typing') alice.send('typing', payload as unknown as { typing: boolean });
    else alice.send('chat', payload as { text: string });
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
