import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACINGS } from '@virtual-workspace/shared';
import { avatars, avatarDefinition, characterFrame } from '../../frontend/src/characters.js';

test('configured character frames fit the supplied sheet and are independent from map tiles', () => {
  const image = readFileSync(new URL('../../../assets/characters/walk.png', import.meta.url));
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  assert.deepEqual([width, height], [64, 96]);
  for (const avatar of Object.values(avatars)) {
    assert.equal(avatar.frameWidth, 16); assert.equal(avatar.frameHeight, 24);
    assert.equal(width % avatar.frameWidth, 0); assert.equal(height % avatar.frameHeight, 0);
    const count = width / avatar.frameWidth * height / avatar.frameHeight;
    assert.equal(count, 16);
    for (const [row, facing] of FACINGS.entries()) {
      assert.equal(avatar.walk[facing].length, 4);
      assert.deepEqual(avatar.walk[facing], [row * 4, row * 4 + 1, row * 4 + 2, row * 4 + 3]);
      assert.equal(avatar.idle[facing], row * 4);
      for (const frame of [...avatar.walk[facing], avatar.idle[facing]]) assert.ok(frame >= 0 && frame < count);
    }
  }
  assert.equal(avatarDefinition('missing'), avatars.mint);
});

test('clients choose walking frames locally and freeze directional idle/sit poses', () => {
  for (const facing of FACINGS) {
    const avatar = avatars.mint;
    assert.equal(characterFrame('mint', facing, 'walk', 'none', 0), avatar.walk[facing][0]);
    assert.equal(characterFrame('mint', facing, 'walk', 'none', 120), avatar.walk[facing][1]);
    assert.equal(characterFrame('mint', facing, 'walk', 'none', 480), avatar.walk[facing][0]);
    assert.equal(characterFrame('mint', facing, 'idle', 'none', 9999), avatar.idle[facing]);
    assert.equal(characterFrame('mint', facing, 'walk', 'sit', 9999), avatar.idle[facing]);
  }
});
