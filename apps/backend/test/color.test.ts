import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOFT_COLOR_ZONE, clampSoftColor, hexToHsv, hsvToHex, isSoftColor } from '@virtual-workspace/shared';

test('hex and HSV conversions round-trip six-digit colors', () => {
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#a3827a', '#c3dcf5', '#7d6a83']) assert.equal(hsvToHex(hexToHsv(hex)), hex);
});

test('soft range keeps hue and pulls loud colors into the top-left of the picker field', () => {
  assert.equal(isSoftColor('#ffd3e1'), true);
  assert.equal(isSoftColor('#ff0000'), false);
  assert.equal(isSoftColor('#3f3550'), false);
  const clamped = hexToHsv(clampSoftColor('#ff0000'));
  assert.ok(Math.abs(clamped.h - 0) < 1);
  assert.ok(clamped.s <= SOFT_COLOR_ZONE.maxSaturation + 0.01 && clamped.v >= SOFT_COLOR_ZONE.minValue - 0.01);
  assert.equal(isSoftColor(clampSoftColor('#123456')), true);
  assert.equal(clampSoftColor('#f6e1c3'), '#f6e1c3');
});
