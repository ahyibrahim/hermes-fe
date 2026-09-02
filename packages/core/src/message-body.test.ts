import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMessageBody } from './message-body.js';

test('parseMessageBody linkifies http(s) in plain text', () => {
  assert.deepEqual(parseMessageBody('see https://example.com/x and http://a.test.'), [
    { type: 'text', value: 'see ' },
    { type: 'url', href: 'https://example.com/x' },
    { type: 'text', value: ' and ' },
    { type: 'url', href: 'http://a.test' },
    { type: 'text', value: '.' },
  ]);
});

test('parseMessageBody highlights known @usernames', () => {
  assert.deepEqual(parseMessageBody('hi @alice and @bob!', ['alice', 'carol']), [
    { type: 'text', value: 'hi ' },
    { type: 'mention', username: 'alice' },
    { type: 'text', value: ' and @bob!' },
  ]);
});

test('parseMessageBody turns fenced regions into code and skips inner urls', () => {
  const parts = parseMessageBody('before\n```js\nhttps://nope.example\n```\nafter https://yes.example');
  assert.deepEqual(parts, [
    { type: 'text', value: 'before\n' },
    { type: 'code', value: 'https://nope.example\n' },
    { type: 'text', value: 'after ' },
    { type: 'url', href: 'https://yes.example' },
  ]);
});

test('parseMessageBody treats an unclosed fence as the rest of the message', () => {
  assert.deepEqual(parseMessageBody('go\n```\nconst x = 1;'), [
    { type: 'text', value: 'go\n' },
    { type: 'code', value: 'const x = 1;' },
  ]);
});

test('parseMessageBody does not treat inline backticks as code', () => {
  assert.deepEqual(parseMessageBody('use `code` please'), [{ type: 'text', value: 'use `code` please' }]);
});
