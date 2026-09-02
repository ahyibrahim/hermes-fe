import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTranscriptTimestamp, groupConsecutiveBySender, MESSAGE_BUBBLE_GAP_MS } from './message-groups.js';

function at(minute: number, second = 0): string {
  return `2026-09-02T12:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
}

test('groupConsecutiveBySender returns no groups for an empty transcript', () => {
  assert.deepEqual(groupConsecutiveBySender([]), []);
});

test('groupConsecutiveBySender keeps a single-sender run together', () => {
  assert.deepEqual(
    groupConsecutiveBySender([
      { id: 1, sender: 'ada', created_at: at(0) },
      { id: 2, sender: 'ada', created_at: at(1) },
      { id: 3, sender: 'ada', created_at: at(2) },
    ]),
    [
      {
        messages: [
          { id: 1, sender: 'ada', created_at: at(0) },
          { id: 2, sender: 'ada', created_at: at(1) },
          { id: 3, sender: 'ada', created_at: at(2) },
        ],
        showName: true,
      },
    ]
  );
});

test('groupConsecutiveBySender starts a new group when the sender changes', () => {
  assert.deepEqual(
    groupConsecutiveBySender([
      { id: 1, sender: 'ada', created_at: at(0) },
      { id: 2, sender: 'ada', created_at: at(1) },
      { id: 3, sender: 'bob', created_at: at(1, 10) },
      { id: 4, sender: 'ada', created_at: at(1, 20) },
    ]),
    [
      {
        messages: [
          { id: 1, sender: 'ada', created_at: at(0) },
          { id: 2, sender: 'ada', created_at: at(1) },
        ],
        showName: true,
      },
      {
        messages: [{ id: 3, sender: 'bob', created_at: at(1, 10) }],
        showName: true,
      },
      {
        messages: [{ id: 4, sender: 'ada', created_at: at(1, 20) }],
        showName: true,
      },
    ]
  );
});

test('groupConsecutiveBySender splits the same sender after more than three minutes', () => {
  assert.equal(MESSAGE_BUBBLE_GAP_MS, 3 * 60 * 1000);
  assert.deepEqual(
    groupConsecutiveBySender([
      { id: 1, sender: 'ada', created_at: at(0) },
      { id: 2, sender: 'ada', created_at: at(3) },
      { id: 3, sender: 'ada', created_at: at(6, 1) },
    ]),
    [
      {
        messages: [
          { id: 1, sender: 'ada', created_at: at(0) },
          { id: 2, sender: 'ada', created_at: at(3) },
        ],
        showName: true,
      },
      {
        messages: [{ id: 3, sender: 'ada', created_at: at(6, 1) }],
        showName: false,
      },
    ]
  );
});

test('formatTranscriptTimestamp uses time only on the same local day', () => {
  const now = new Date(2026, 8, 2, 18, 0, 0);
  assert.equal(
    formatTranscriptTimestamp(new Date(2026, 8, 2, 5, 47, 0).toISOString(), now, 'en-US').replace(
      /\u202f/g,
      ' '
    ),
    '5:47 AM'
  );
});

test('formatTranscriptTimestamp includes the date on a different local day', () => {
  const now = new Date(2026, 8, 2, 18, 0, 0);
  assert.equal(
    formatTranscriptTimestamp(new Date(2026, 8, 1, 17, 30, 0).toISOString(), now, 'en-US').replace(
      /\u202f/g,
      ' '
    ),
    'Sep 1, 5:30 PM'
  );
});
