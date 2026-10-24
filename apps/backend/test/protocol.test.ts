import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVATARS, DEFAULT_APPEARANCE, joinSchema, spaceJoinSchema, inputSchema, chatSchema, typingSchema, webToolOpenSchema, boardPostSchema,
  boardDeleteSchema, pomodoroActionSchema, activateActionSchema, CHARACTER_ACTION_NAMES,
  selectVariantSchema, canHear, canConnectVoice, voiceOfferSchema, voiceIceCandidateSchema, voiceConfigSchema, voiceCredentialsSchema } from '@impartation/shared';

test('voice payloads bound signaling size and reject malformed targets and ICE configuration', () => {
  const connectionId = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(voiceOfferSchema.safeParse({ peerId: 'peer', connectionId, sdp: 'offer' }).success, true);
  for (const value of [{ peerId: '', connectionId, sdp: 'offer' },
    { peerId: 'peer', connectionId: 'bad', sdp: 'offer' },
    { peerId: 'peer', connectionId, sdp: 'x'.repeat(65_537) }]) {
    assert.equal(voiceOfferSchema.safeParse(value).success, false);
  }
  assert.equal(voiceIceCandidateSchema.safeParse({ peerId: 'peer', connectionId, candidate: 'candidate:1',
    sdpMid: null, sdpMLineIndex: 0 }).success, true);
  assert.equal(voiceIceCandidateSchema.safeParse({ peerId: 'peer', connectionId, candidate: 'x'.repeat(4097),
    sdpMid: null, sdpMLineIndex: 0 }).success, false);
  assert.equal(voiceConfigSchema.safeParse({ iceServers: [{ urls: 'https://not-ice.example' }],
    connectRadius: 160, disconnectRadius: 192, maxPeers: 6, scanIntervalMs: 1000 }).success, false);
  assert.equal(voiceConfigSchema.safeParse({ iceServers: [], connectRadius: 192,
    disconnectRadius: 160, maxPeers: 6, scanIntervalMs: 1000 }).success, false);
  assert.equal(voiceCredentialsSchema.safeParse({ iceServers: [{ urls: 'turn:relay.example.test', username: '1:user', credential: 'mac' }], expiresAt: 1000 }).success, true);
  assert.equal(voiceCredentialsSchema.safeParse({ iceServers: [{ urls: 'https://relay.example.test', username: '1:user', credential: 'mac' }], expiresAt: 1000 }).success, false);
});

test('voice eligibility is directional for public and private audiences', () => {
  const a = { x: 0, y: 0, mapId: 'a', privateAreaId: '', connected: true, voiceEnabled: true };
  const b = { ...a, x: 159 };
  assert.equal(canHear(a, b, 160), true);
  assert.equal(canHear(a, { ...b, x: 161 }, 160), false);
  assert.equal(canHear(a, { ...b, mapId: 'b' }, 160), false);
  assert.equal(canHear(a, { ...b, connected: false }, 160), false);
  assert.equal(canHear(a, { ...b, voiceEnabled: false }, 160), false);
  const privatePlayer = { ...b, privateAreaId: '30' };
  assert.equal(canHear(a, privatePlayer, 160), true, 'private listener hears public speaker');
  assert.equal(canHear(privatePlayer, a, 160), false, 'public listener cannot hear private speaker');
  assert.equal(canConnectVoice(a, privatePlayer, 160), true, 'WebRTC pair can carry the permitted direction');
  assert.equal(canHear({ ...a, privateAreaId: '30' }, { ...b, privateAreaId: '30' }, 160), true);
  assert.equal(canHear({ ...a, privateAreaId: '30' }, { ...b, privateAreaId: '31' }, 160), false);
  assert.equal(canHear({ ...a, privateAreaId: '30' }, { ...b, mapId: 'b', privateAreaId: '' }, 160), false);
});

test('guest names are trimmed, default avatar is valid, and all available avatars are accepted', () => {
  assert.deepEqual(joinSchema.parse({ name: ' Alice ' }), { name: 'Alice', avatar: 'mint', appearance: DEFAULT_APPEARANCE });
  for (const avatar of AVATARS) assert.equal(joinSchema.parse({ name: '访客', avatar }).avatar, avatar);
  assert.equal(joinSchema.parse({ name: 'x'.repeat(24) }).name.length, 24);
});
for (const [name, value] of [
  ['missing', {}], ['empty', { name: '' }], ['whitespace', { name: '   ' }],
  ['too long', { name: 'x'.repeat(25) }], ['wrong name type', { name: 1 }],
  ['unknown avatar', { name: 'Alice', avatar: 'unknown' }], ['null', null],
] as const) test(`guest validation rejects ${name}`, () => assert.equal(joinSchema.safeParse(value).success, false));

test('all nine direction inputs are allowed and extra fields cannot set authoritative identity or position', () => {
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) assert.deepEqual(inputSchema.parse({ x, y }), { x, y });
  assert.deepEqual(inputSchema.parse({ x: 0, y: 1, sessionId: 'other-player', position: { x: 9000 } }), { x: 0, y: 1 });
});

test('character action requests accept only catalog actions and strip client authority', () => {
  assert.deepEqual(activateActionSchema.parse({ action: ' sit ', animated: true,
    objectId: 'seat-1', sessionId: 'other', x: 100, y: 200, facing: 'up', variant: 'occupied' }),
  { action: 'sit', animated: true });
  for (const action of CHARACTER_ACTION_NAMES) {
    assert.deepEqual(activateActionSchema.parse({ action }), { action, animated: false });
  }
  for (const value of [{}, null, { action: 'wave' }, { action: 'read' }, { action: '' }, { action: ' ' }, { action: 'none' },
    { action: 'a'.repeat(33) }, { action: 1 }, { action: 'sit', animated: 'yes' }, { action: 'sit', animated: 1 }]) {
    assert.equal(activateActionSchema.safeParse(value).success, false);
  }
});

test('variant selection accepts a named choice or explicit clear and rejects client authority', () => {
  assert.deepEqual(selectVariantSchema.parse({ selectorId: '204', variant: ' book ' }),
    { selectorId: '204', variant: 'book' });
  assert.deepEqual(selectVariantSchema.parse({ selectorId: '204', variant: null }),
    { selectorId: '204', variant: null });
  for (const value of [
    { selectorId: '204' },
    { selectorId: '204', variant: '' },
    { selectorId: '204', variant: '  ' },
    { selectorId: '204', variant: 1 },
    { selectorId: '204', variant: false },
    { selectorId: '204', variant: {} },
    { selectorId: '204', variant: null, sessionId: 'forged' },
    { selectorId: '204', variant: null, mapId: 'other-map' },
    { selectorId: '204', variant: null, targetObjectId: '501' },
  ]) assert.equal(selectVariantSchema.safeParse(value).success, false);
});

for (const [name, value] of [
  ['out of range', { x: 2, y: 0 }], ['negative out of range', { x: 0, y: -2 }],
  ['fractional', { x: 0.5, y: 0 }], ['string', { x: '1', y: 0 }],
  ['missing direction', { x: 1 }], ['NaN', { x: Number.NaN, y: 0 }],
  ['Infinity', { x: 0, y: Infinity }], ['null', null],
] as const) test(`movement validation rejects ${name}`, () => assert.equal(inputSchema.safeParse(value).success, false));

test('chat trims whitespace, allows 500 characters and keeps markup as plain text', () => {
  assert.deepEqual(chatSchema.parse({ text: ' <b>你好</b> ' }), { text: '<b>你好</b>' });
  assert.deepEqual(typingSchema.parse({ typing: true }), { typing: true });
  assert.equal(typingSchema.safeParse({ typing: 1 }).success, false);
  assert.equal(typingSchema.safeParse({ typing: true, sessionId: 'forged' }).success, false);
  assert.deepEqual(webToolOpenSchema.parse({ open: true }), { open: true });
  assert.equal(webToolOpenSchema.safeParse({ open: true, zoneId: 'forged' }).success, false);
  assert.equal(chatSchema.parse({ text: 'x'.repeat(500) }).text.length, 500);
});
for (const [name, value] of [
  ['empty', { text: '' }], ['whitespace', { text: '\n\t ' }], ['too long', { text: 'x'.repeat(501) }],
  ['missing', {}], ['wrong type', { text: false }], ['null', null],
] as const) test(`chat validation rejects ${name}`, () => assert.equal(chatSchema.safeParse(value).success, false));

test('board posts trim text and resource IDs, accept 128-character IDs, and strip client identity fields', () => {
  assert.deepEqual(boardPostSchema.parse({
    resourceId: ` ${'r'.repeat(128)} `,
    text: '  hello board  ',
    authorSessionId: 'forged-session',
    name: 'Forged name',
  }), { resourceId: 'r'.repeat(128), text: 'hello board' });
});
for (const [name, value] of [
  ['empty text', { resourceId: 'board-1', text: '' }],
  ['whitespace text', { resourceId: 'board-1', text: ' \n ' }],
  ['oversized text', { resourceId: 'board-1', text: 'x'.repeat(501) }],
  ['empty resource ID', { resourceId: ' ', text: 'note' }],
  ['oversized resource ID', { resourceId: 'r'.repeat(129), text: 'note' }],
  ['missing resource ID', { text: 'note' }],
  ['missing text', { resourceId: 'board-1' }],
  ['null', null],
] as const) test(`board post validation rejects ${name}`, () => assert.equal(boardPostSchema.safeParse(value).success, false));

test('board deletion accepts UUIDs and strips client supplied author identity', () => {
  assert.deepEqual(boardDeleteSchema.parse({
    resourceId: 'board-1',
    id: '550e8400-e29b-41d4-a716-446655440000',
    authorSessionId: 'forged-session',
  }), { resourceId: 'board-1', id: '550e8400-e29b-41d4-a716-446655440000' });
});
for (const [name, value] of [
  ['malformed UUID', { resourceId: 'board-1', id: 'not-a-uuid' }],
  ['missing UUID', { resourceId: 'board-1' }],
  ['empty resource ID', { resourceId: '', id: '550e8400-e29b-41d4-a716-446655440000' }],
  ['oversized resource ID', { resourceId: 'r'.repeat(129), id: '550e8400-e29b-41d4-a716-446655440000' }],
  ['missing resource ID', { id: '550e8400-e29b-41d4-a716-446655440000' }],
  ['null', null],
] as const) test(`board delete validation rejects ${name}`, () => assert.equal(boardDeleteSchema.safeParse(value).success, false));

test('pomodoro accepts every supported action and strips forged timer state', () => {
  const cases = [
    { resourceId: 'timer-1', action: 'start', mode: 'focus' },
    { resourceId: 'timer-1', action: 'start', mode: 'break' },
    { resourceId: 'timer-1', action: 'pause' },
    { resourceId: 'timer-1', action: 'resume' },
    { resourceId: 'timer-1', action: 'reset', mode: 'focus' },
    { resourceId: 'timer-1', action: 'reset', mode: 'break' },
  ] as const;
  for (const value of cases) {
    assert.deepEqual(pomodoroActionSchema.parse({
      ...value, endsAt: 123, status: 'completed', name: 'Forged name',
    }), value);
  }
  assert.deepEqual(pomodoroActionSchema.parse({ resourceId: 'timer-1', action: 'pause', mode: 'focus' }),
    { resourceId: 'timer-1', action: 'pause' });
  assert.deepEqual(pomodoroActionSchema.parse({ resourceId: 'timer-1', action: 'resume', mode: 'break' }),
    { resourceId: 'timer-1', action: 'resume' });
});
for (const [name, value] of [
  ['unknown action', { resourceId: 'timer-1', action: 'skip' }],
  ['unknown mode', { resourceId: 'timer-1', action: 'start', mode: 'long-break' }],
  ['start without mode', { resourceId: 'timer-1', action: 'start' }],
  ['reset without mode', { resourceId: 'timer-1', action: 'reset' }],
  ['missing action', { resourceId: 'timer-1' }],
  ['missing resource ID', { action: 'pause' }],
  ['empty resource ID', { resourceId: '', action: 'pause' }],
  ['oversized resource ID', { resourceId: 'r'.repeat(129), action: 'pause' }],
  ['null', null],
] as const) test(`pomodoro validation rejects ${name}`, () => assert.equal(pomodoroActionSchema.safeParse(value).success, false));


test('Space join requires a stable spaceId while profile editing keeps its original contract', () => {
  assert.equal(spaceJoinSchema.safeParse({ name: 'Alice' }).success, false);
  assert.equal(spaceJoinSchema.parse({ name: 'Alice', spaceId: 'main' }).spaceId, 'main');
  for (const spaceId of ['', ' main ', 'Main', '../other']) {
    assert.equal(spaceJoinSchema.safeParse({ name: 'Alice', spaceId }).success, false);
  }
  assert.deepEqual(joinSchema.parse({ name: 'Alice', spaceId: 'main' }), joinSchema.parse({ name: 'Alice' }));
});
