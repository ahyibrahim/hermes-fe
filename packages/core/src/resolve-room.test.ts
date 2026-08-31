import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRoom } from './resolve-room.js';
import { RoomRecord } from './types.js';

const rooms: RoomRecord[] = [
  { id: 1, slug: 'general', name: 'General', members: ['alice', 'bob'] },
  { id: 2, slug: 'random', name: 'Random Chat', members: ['carol'] },
];

test('resolveRoom matches a slug exactly', () => {
  assert.deepEqual(resolveRoom('general', rooms), { slug: 'general', members: ['alice', 'bob'] });
});

test('resolveRoom matches a room name case-insensitively', () => {
  assert.deepEqual(resolveRoom('random chat', rooms), { slug: 'random', members: ['carol'] });
});

test('resolveRoom matches a numeric id', () => {
  assert.deepEqual(resolveRoom('2', rooms), { slug: 'random', members: ['carol'] });
});

test('resolveRoom falls back to the trimmed input when nothing matches', () => {
  assert.deepEqual(resolveRoom('  mystery  ', rooms), { slug: 'mystery', members: [] });
});
