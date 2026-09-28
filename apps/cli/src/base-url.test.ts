import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeBaseUrl } from './base-url.js';

test('isSafeBaseUrl accepts https and loopback http only', () => {
  assert.equal(isSafeBaseUrl('https://ying-1.tail18942a.ts.net'), true);
  assert.equal(isSafeBaseUrl('http://127.0.0.1:3000'), true);
  assert.equal(isSafeBaseUrl('http://localhost:3000'), true);
  assert.equal(isSafeBaseUrl('http://[::1]:3000'), true);
  assert.equal(isSafeBaseUrl('http://ying-1:3000'), false);
  assert.equal(isSafeBaseUrl('http://192.168.100.13:3000'), false);
  assert.equal(isSafeBaseUrl('not a url'), false);
});
