import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACINGS } from '@virtual-workspace/shared';
import { avatars, avatarDefinition, characterFrame } from '../../frontend/src/characters.js';

test('configured character frames fit the supplied sheet and are independent from map tiles', () => {
  const image = readFileSync(new URL('../../../assets/characters/body/walk.png', import.meta.url));
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  for (const avatar of Object.values(avatars)) {
    assert.ok(avatar.frameWidth > 0); assert.ok(avatar.frameHeight > 0);
    assert.equal(width % avatar.frameWidth, 0); assert.equal(height % avatar.frameHeight, 0);
    const count = width / avatar.frameWidth * height / avatar.frameHeight;
    const walkingFrames = FACINGS.flatMap(facing => avatar.walk[facing]);
    assert.equal(walkingFrames.length, 16);
    assert.equal(new Set(walkingFrames).size, walkingFrames.length);
    assert.ok(Math.max(...walkingFrames) < count);
    assert.ok(Number.isFinite(avatar.groundAnchor.x) && avatar.groundAnchor.x >= 0 && avatar.groundAnchor.x <= avatar.frameWidth);
    assert.ok(Number.isFinite(avatar.groundAnchor.y) && avatar.groundAnchor.y >= 0 && avatar.groundAnchor.y <= avatar.frameHeight);
    for (const facing of FACINGS) {
      assert.equal(avatar.walk[facing].length, 4);
      for (const frame of [...avatar.walk[facing], avatar.idle[facing]]) assert.ok(frame >= 0 && frame < count);
    }
  }
  assert.equal(avatarDefinition('missing'), avatars.mint);
});

test('walk frames loop locally and idle stays on the directional first frame', () => {
  for (const facing of FACINGS) {
    const avatar = avatars.mint;
    assert.equal(characterFrame('mint', facing, 'walk', 'none', false, 0), avatar.walk[facing][0]);
    assert.equal(characterFrame('mint', facing, 'walk', 'none', false, 120), avatar.walk[facing][1]);
    assert.equal(characterFrame('mint', facing, 'walk', 'none', false, 360), avatar.walk[facing][3]);
    assert.equal(characterFrame('mint', facing, 'walk', 'none', false, 480), avatar.walk[facing][0]);
    assert.equal(characterFrame('mint', facing, 'idle', 'none', false, 9999), avatar.idle[facing]);
  }
});

test('configured actions use four directional rows with static and animated columns', () => {
  const avatar = avatars.mint;
  for (const [row, facing] of FACINGS.entries()) {
    const first = 16 + row * 4;
    assert.equal(avatar.actions.sit[facing], first);
    assert.equal(characterFrame('mint', facing, 'walk', 'sit', false, 9999), first);
    // An animated action takes precedence over motion and cycles columns 1–3 only.
    assert.equal(characterFrame('mint', facing, 'idle', 'sit', true, 0), first + 1);
    assert.equal(characterFrame('mint', facing, 'walk', 'sit', true, 120), first + 2);
    assert.equal(characterFrame('mint', facing, 'walk', 'sit', true, 240), first + 3);
    assert.equal(characterFrame('mint', facing, 'walk', 'sit', true, 360), first + 1);
    assert.equal(characterFrame('mint', facing, 'walk', 'sit', true, -1), first + 1);
  }
  // The supplied PNG currently contains walk rows only; the configured sit row awaits matching art.
});

test('unknown actions fall back to directional walk idle regardless of motion', () => {
  for (const facing of FACINGS) {
    const idle = avatars.mint.idle[facing];
    assert.equal(characterFrame('mint', facing, 'walk', 'wave', true, 120), idle);
    assert.equal(characterFrame('mint', facing, 'idle', 'wave', false, 0), idle);
  }
});
