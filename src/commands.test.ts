import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChatLine } from './commands.js';

test('parseChatLine treats blank input as empty', () => {
  assert.deepEqual(parseChatLine('   '), { kind: 'empty' });
});

test('parseChatLine keeps the full message body including spaces', () => {
  assert.deepEqual(parseChatLine('hello there world'), {
    kind: 'message',
    text: 'hello there world',
  });
});

test('parseChatLine parses slash commands and preserves rest', () => {
  assert.deepEqual(parseChatLine('/join general chat'), {
    kind: 'command',
    command: 'join',
    args: ['general', 'chat'],
    rest: 'general chat',
  });
});

test('parseChatLine lowercases the slash command name', () => {
  assert.deepEqual(parseChatLine('/HELP'), {
    kind: 'command',
    command: 'help',
    args: [],
    rest: '',
  });
});
