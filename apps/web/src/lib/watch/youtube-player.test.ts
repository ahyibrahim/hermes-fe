import { describe, expect, test } from 'vitest';
import {
  isYouTubeWidgetOrigin,
  parseWidgetMessage,
  youtubeEmbedSrc,
  YOUTUBE_WIDGET_ORIGIN,
} from './youtube-player';

const ID = 'dQw4w9WgXcQ';

describe('youtube embed', () => {
  test('points at the nocookie origin and names this page as origin', () => {
    const src = youtubeEmbedSrc(ID, 'https://ying-1.tail18942a.ts.net');
    const url = new URL(src);
    expect(url.origin).toBe(YOUTUBE_WIDGET_ORIGIN);
    expect(url.pathname).toBe(`/embed/${ID}`);
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('https://ying-1.tail18942a.ts.net');
  });

  test('accepts only the nocookie origin', () => {
    expect(isYouTubeWidgetOrigin(YOUTUBE_WIDGET_ORIGIN)).toBe(true);
    expect(isYouTubeWidgetOrigin('https://www.youtube.com')).toBe(false);
    expect(isYouTubeWidgetOrigin('https://evil.example')).toBe(false);
  });

  test('parses a widget postMessage and ignores anything else', () => {
    expect(parseWidgetMessage(JSON.stringify({ event: 'onStateChange', info: 1 }))).toEqual({
      event: 'onStateChange',
      info: 1,
    });
    expect(parseWidgetMessage('not-json')).toBeNull();
    expect(parseWidgetMessage({ event: '' })).toBeNull();
  });
});
