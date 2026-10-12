import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACINGS } from '@virtual-workspace/shared';
import { avatars, avatarDefinition, characterFrame } from '../../frontend/src/characters.js';

test('configured character frames fit the supplied sheet and are independent from map tiles', () => {
  const image = readFileSync(new URL('../../../assets/characters/walk.png', import.meta.url));
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  for (const avatar of Object.values(avatars)) {
    assert.ok(avatar.frameWidth > 0); assert.ok(avatar.frameHeight > 0);
    assert.equal(width % avatar.frameWidth, 0); assert.equal(height % avatar.frameHeight, 0);
    const count = width / avatar.frameWidth * height / avatar.frameHeight;
    const walkingFrames = FACINGS.flatMap(facing => avatar.walk[facing]);
    assert.equal(walkingFrames.length, 16);
    assert.equal(new Set(walkingFrames).size, walkingFrames.length);
    assert.ok(Number.isFinite(avatar.groundAnchor.x) && avatar.groundAnchor.x >= 0 && avatar.groundAnchor.x <= avatar.frameWidth);
    assert.ok(Number.isFinite(avatar.groundAnchor.y) && avatar.groundAnchor.y >= 0 && avatar.groundAnchor.y <= avatar.frameHeight);
    for (const facing of FACINGS) {
      assert.equal(avatar.walk[facing].length, 4);
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
