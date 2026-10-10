import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVATARS, joinSchema, inputSchema, chatSchema } from '@virtual-workspace/shared';

test('guest names are trimmed, default avatar is valid, and all available avatars are accepted', () => {
  assert.deepEqual(joinSchema.parse({ name: ' Alice ' }), { name: 'Alice', avatar: 'mint' });
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
