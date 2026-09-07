import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMessageBody } from './message-body.js';

test('parseMessageBody emits http(s) url parts and leaves trailing punctuation', () => {
  assert.deepEqual(parseMessageBody('see https://example.com/x and http://a.test.'), [
    { type: 'text', value: 'see ' },
    { type: 'url', value: 'https://example.com/x' },
    { type: 'text', value: ' and ' },
    { type: 'url', value: 'http://a.test' },
    { type: 'text', value: '.' },
  ]);
});

test('parseMessageBody does not linkify ftp or bare www', () => {
  assert.deepEqual(parseMessageBody('ftp://nope.example and www.example.com'), [
    { type: 'text', value: 'ftp://nope.example and www.example.com' },
  ]);
});

test('parseMessageBody highlights known @usernames', () => {
  assert.deepEqual(parseMessageBody('hi @alice and @bob!', ['alice', 'carol']), [
    { type: 'text', value: 'hi ' },
    { type: 'mention', username: 'alice' },
    { type: 'text', value: ' and @bob!' },
  ]);
});

test('parseMessageBody turns fenced regions into code and still autolinks after', () => {
  const parts = parseMessageBody('before\n```js\nhttps://nope.example\n```\nafter https://yes.example');
  assert.deepEqual(parts, [
    { type: 'text', value: 'before\n' },
    { type: 'code', value: 'https://nope.example\n' },
    { type: 'text', value: 'after ' },
    { type: 'url', value: 'https://yes.example' },
  ]);
});

test('parseMessageBody treats an unclosed fence as the rest of the message', () => {
  assert.deepEqual(parseMessageBody('go\n```\nconst x = 1;'), [
    { type: 'text', value: 'go\n' },
    { type: 'code', value: 'const x = 1;' },
  ]);
});

test('parseMessageBody treats inline backticks as code and does not linkify inside', () => {
  assert.deepEqual(parseMessageBody('use `https://nope.example` please'), [
    { type: 'text', value: 'use ' },
    { type: 'inline_code', value: 'https://nope.example' },
    { type: 'text', value: ' please' },
  ]);
});

test('parseMessageBody parses bold and italic', () => {
  assert.deepEqual(parseMessageBody('**bold** and *italic*'), [
    { type: 'bold', value: 'bold' },
    { type: 'text', value: ' and ' },
    { type: 'italic', value: 'italic' },
  ]);
});
