import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isYouTubeUrl, parseYouTubeVideoId } from './youtube.js';

const ID = 'dQw4w9WgXcQ';

test('parseYouTubeVideoId accepts watch, short, shorts, and embed URLs', () => {
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseYouTubeVideoId(`https://youtube.com/watch?v=${ID}&t=12`), ID);
  assert.equal(parseYouTubeVideoId(`https://m.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${ID}`), ID);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${ID}?t=30`), ID);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/embed/${ID}`), ID);
  assert.equal(parseYouTubeVideoId(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
});

test('parseYouTubeVideoId rejects non-YouTube and malformed ids', () => {
  assert.equal(parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(parseYouTubeVideoId('not a url'), null);
  assert.equal(parseYouTubeVideoId(''), null);
});

test('isYouTubeUrl mirrors parseYouTubeVideoId', () => {
  assert.equal(isYouTubeUrl(`https://youtu.be/${ID}`), true);
  assert.equal(isYouTubeUrl('https://example.com'), false);
});
