import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../../src/core/kit.ts';

test('seeded randomness repeats exactly', () => {
  const a = K.rng(7);
  const b = K.rng(7);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
  assert.equal(K.hash(12, 3), K.hash(12, 3));
  assert.notEqual(K.hash(12, 3), K.hash(13, 3));
});

test('random values stay inside 0..1 and noise inside -1..1', () => {
  const r = K.rng(1);
  for (let i = 0; i < 500; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
    const n = K.noise2(i * 0.37, i * 0.11, 2);
    assert.ok(n >= -1 && n <= 1);
  }
});

test('tween, pulse and keys hit their end points', () => {
  assert.equal(K.tween(0, 1, 2), 0);
  assert.equal(K.tween(3, 1, 2), 1);
  assert.equal(K.pulse(0, 1, 5), 0);
  assert.equal(K.pulse(3, 1, 5), 1);
  assert.equal(K.pulse(6, 1, 5), 0);
  const k = K.keys([[0, 0], [2, 10, 'linear'], [4, 10]]);
  assert.equal(k(-1), 0);
  assert.equal(k(1), 5);
  assert.equal(k(9), 10);
});

test('stagger finishes every item by the end', () => {
  for (let i = 0; i < 6; i++) {
    assert.equal(K.stagger(2, 0, 2, i, 6), 1);
    assert.ok(K.stagger(0, 0, 2, i, 6) === 0);
  }
});

test('colour helpers', () => {
  assert.equal(K.rgba('#83b8e3', 0.5), 'rgba(131,184,227,0.5)');
  assert.equal(K.blend('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(K.blend('#03060c', '#83b8e3', 0), '#03060c');
});

test('formatting', () => {
  assert.equal(K.mmss(75), '1:15');
  assert.equal(K.num(2688), '2,688');
  assert.equal(K.pad(7), '07');
});
