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
  assert.deepEqual(parts[0], { type: 'text', value: 'before\n' });
  assert.deepEqual(parts[1], { type: 'code', value: 'https://nope.example\n', lang: 'js' });
  assert.deepEqual(parts.slice(2), [
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

test('parseMessageBody parses ~~strike~~ but not inside inline code', () => {
  assert.deepEqual(parseMessageBody('was ~~wrong~~ and `~~kept~~`'), [
    { type: 'text', value: 'was ' },
    { type: 'strike', value: 'wrong' },
    { type: 'text', value: ' and ' },
    { type: 'inline_code', value: '~~kept~~' },
  ]);
  assert.deepEqual(parseMessageBody('~~~~ and ~~open'), [{ type: 'text', value: '~~~~ and ~~open' }]);
});

test('parseMessageBody turns consecutive - and * lines into one bullet list', () => {
  assert.deepEqual(parseMessageBody('todo:\n- milk\n* **eggs**\nthanks'), [
    { type: 'text', value: 'todo:' },
    {
      type: 'list',
      ordered: false,
      items: [[{ type: 'text', value: 'milk' }], [{ type: 'bold', value: 'eggs' }]],
    },
    { type: 'text', value: 'thanks' },
  ]);
});

test('parseMessageBody numbers lists and keeps a non-1 start', () => {
  assert.deepEqual(parseMessageBody('3. three\n4. four'), [
    {
      type: 'list',
      ordered: true,
      start: 3,
      items: [[{ type: 'text', value: 'three' }], [{ type: 'text', value: 'four' }]],
    },
  ]);
  assert.deepEqual(parseMessageBody('1. one\n- dash'), [
    { type: 'list', ordered: true, items: [[{ type: 'text', value: 'one' }]] },
    { type: 'list', ordered: false, items: [[{ type: 'text', value: 'dash' }]] },
  ]);
});

test('parseMessageBody leaves emphasis, dashes without a space, and fences alone', () => {
  assert.deepEqual(parseMessageBody('*not a list*\n-nope\n2026.'), [
    { type: 'italic', value: 'not a list' },
    { type: 'text', value: '\n-nope\n2026.' },
  ]);
  const fenced = parseMessageBody('```\n- inside\n```\n- after');
  assert.deepEqual(fenced, [
    { type: 'code', value: '- inside\n' },
    { type: 'list', ordered: false, items: [[{ type: 'text', value: 'after' }]] },
  ]);
});

test('parseMessageBody still finds urls and mentions inside list items', () => {
  assert.deepEqual(parseMessageBody('- watch https://youtu.be/dQw4w9WgXcQ\n- ping @alice', ['alice']), [
    {
      type: 'list',
      ordered: false,
      items: [
        [
          { type: 'text', value: 'watch ' },
          { type: 'url', value: 'https://youtu.be/dQw4w9WgXcQ' },
        ],
        [
          { type: 'text', value: 'ping ' },
          { type: 'mention', username: 'alice' },
        ],
      ],
    },
  ]);
});
