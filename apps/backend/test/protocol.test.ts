import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVATARS, DEFAULT_APPEARANCE, joinSchema, inputSchema, chatSchema, boardPostSchema,
  boardDeleteSchema, pomodoroActionSchema, activateActionSchema } from '@virtual-workspace/shared';

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

test('character action requests accept future names and strip client authority', () => {
  assert.deepEqual(activateActionSchema.parse({ action: ' sit ', animated: true,
    objectId: 'seat-1', sessionId: 'other', x: 100, y: 200, facing: 'up', variant: 'occupied' }),
  { action: 'sit', animated: true });
  for (const action of ['sit', 'wave', 'exercise', 'sleep', 'read']) {
    assert.deepEqual(activateActionSchema.parse({ action }), { action, animated: false });
  }
  for (const value of [{}, null, { action: '' }, { action: ' ' }, { action: 'none' },
    { action: 'a'.repeat(33) }, { action: 1 }, { action: 'sit', animated: 'yes' }, { action: 'sit', animated: 1 }]) {
    assert.equal(activateActionSchema.safeParse(value).success, false);
  }
});
for (const [name, value] of [
  ['out of range', { x: 2, y: 0 }], ['negative out of range', { x: 0, y: -2 }],
  ['fractional', { x: 0.5, y: 0 }], ['string', { x: '1', y: 0 }],
  ['missing direction', { x: 1 }], ['NaN', { x: Number.NaN, y: 0 }],
  ['Infinity', { x: 0, y: Infinity }], ['null', null],
] as const) test(`movement validation rejects ${name}`, () => assert.equal(inputSchema.safeParse(value).success, false));

test('chat trims whitespace, allows 500 characters and keeps markup as plain text', () => {
  assert.deepEqual(chatSchema.parse({ text: ' <b>你好</b> ' }), { text: '<b>你好</b>' });
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
