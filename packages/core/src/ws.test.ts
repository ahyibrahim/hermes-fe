import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSocketUrl } from './ws.js';

test('toSocketUrl maps http and https origins', () => {
  assert.equal(toSocketUrl('http://ying-1:3000'), 'ws://ying-1:3000');
  assert.equal(toSocketUrl('https://s1:3000/'), 'wss://s1:3000');
});

test('toSocketUrl turns an empty base into the page origin', () => {
  assert.equal(toSocketUrl('', 'http://ying-1:3000'), 'ws://ying-1:3000');
  assert.equal(toSocketUrl('', 'https://s1:3443/'), 'wss://s1:3443');
});

test('toSocketUrl prefixes a relative path with the page origin', () => {
  assert.equal(toSocketUrl('/chat', 'http://ying-1:3000'), 'ws://ying-1:3000/chat');
});
