const YT_HOST =
  /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
const YT_SHORT = /^youtu\.be$/i;
const VIDEO_ID = /^[\w-]{11}$/;

/**
 * Extract an 11-character YouTube video id from common watch / short / embed URLs.
 */
export function parseYouTubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname;

  if (YT_SHORT.test(host)) {
    const id = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }

  if (!YT_HOST.test(host)) {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/, '') || '/';

  if (path === '/watch' || path === '/watch/') {
    const id = parsed.searchParams.get('v') ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }

  const shorts = /^\/shorts\/([\w-]{11})$/i.exec(path);
  if (shorts) {
    return shorts[1];
  }

  const embed = /^\/(?:embed|live|v)\/([\w-]{11})$/i.exec(path);
  if (embed) {
    return embed[1];
  }

  // Rare: /watch/VIDEO_ID
  const watchPath = /^\/watch\/([\w-]{11})$/i.exec(path);
  if (watchPath) {
    return watchPath[1];
  }

  return null;
}

export function isYouTubeUrl(url: string): boolean {
  return parseYouTubeVideoId(url) !== null;
}
