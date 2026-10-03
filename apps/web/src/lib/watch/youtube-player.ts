/** Watch together player. The YouTube script is not loaded in this page. */

export type YtPlayerState = -1 | 0 | 1 | 2 | 3 | 5;

export const YOUTUBE_WIDGET_ORIGIN = 'https://www.youtube-nocookie.com';

export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): YtPlayerState;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  setSize(width: number, height: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}

export function youtubeEmbedSrc(videoId: string, pageOrigin: string): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    origin: pageOrigin,
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    autoplay: '0',
  });
  return `${YOUTUBE_WIDGET_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params}`;
}

export function isYouTubeWidgetOrigin(origin: string): boolean {
  return origin === YOUTUBE_WIDGET_ORIGIN;
}

export function parseWidgetMessage(data: unknown): { event: string; info: unknown } | null {
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const event = (parsed as { event?: unknown }).event;
  if (typeof event !== 'string' || event.length === 0) {
    return null;
  }
  return { event, info: (parsed as { info?: unknown }).info };
}

export interface WatchPlaybackState {
  playing: boolean;
  position: number;
  rate: number;
  updatedAt: number;
}

/** Live position accounting for time since the last server snapshot. */
export function livePosition(state: WatchPlaybackState, now = Date.now()): number {
  if (!state.playing) {
    return state.position;
  }
  const elapsed = Math.max(0, (now - state.updatedAt) / 1000) * (state.rate || 1);
  return state.position + elapsed;
}

const SEEK_EPSILON = 1.25;

/**
 * Apply a server watch snapshot to a player.
 * Returns true when play() was attempted (may still be blocked by autoplay policy).
 */
export function applyWatchState(
  player: YtPlayer,
  state: WatchPlaybackState,
  opts?: { now?: number }
): { playAttempted: boolean } {
  const target = livePosition(state, opts?.now);
  const current = player.getCurrentTime();
  if (Math.abs(current - target) > SEEK_EPSILON) {
    player.seekTo(target, true);
  }

  if (typeof state.rate === 'number' && state.rate > 0) {
    try {
      if (Math.abs(player.getPlaybackRate() - state.rate) > 0.01) {
        player.setPlaybackRate(state.rate);
      }
    } catch {
      // Some embeds reject arbitrary rates.
    }
  }

  const ytState = player.getPlayerState();
  const playing = ytState === 1 || ytState === 3;
  if (state.playing && !playing) {
    player.playVideo();
    return { playAttempted: true };
  }
  if (!state.playing && playing) {
    player.pauseVideo();
  }
  return { playAttempted: false };
}

function widgetMessage(id: string, event: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ event, channel: 'widget', id, ...extra });
}

function asState(value: unknown): YtPlayerState | null {
  if (value === -1 || value === 0 || value === 1 || value === 2 || value === 3 || value === 5) {
    return value;
  }
  return null;
}

export async function createYouTubePlayer(
  mount: HTMLElement,
  videoId: string,
  handlers: {
    onReady?: (player: YtPlayer) => void;
    onStateChange?: (state: YtPlayerState, player: YtPlayer) => void;
    /** Element whose client box drives setSize (defaults to mount.parentElement ?? mount). */
    sizeBox?: HTMLElement;
  } = {}
): Promise<YtPlayer & { disconnectResize?: () => void }> {
  const sizeBox = handlers.sizeBox ?? mount.parentElement ?? mount;
  const widgetId = `hermes-yt-${videoId}`;
  mount.replaceChildren();
  const iframe = document.createElement('iframe');
  iframe.id = widgetId;
  iframe.title = 'YouTube';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.setAttribute('allowfullscreen', '');
  iframe.style.border = '0';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.src = youtubeEmbedSrc(videoId, window.location.origin);
  mount.appendChild(iframe);

  let currentTime = 0;
  let playerState: YtPlayerState = -1;
  let playbackRate = 1;
  let muted = false;
  let settled = false;

  const command = (func: string, args: unknown[] = []) => {
    iframe.contentWindow?.postMessage(
      widgetMessage(widgetId, 'command', { func, args }),
      YOUTUBE_WIDGET_ORIGIN
    );
  };

  const listen = () => {
    iframe.contentWindow?.postMessage(widgetMessage(widgetId, 'listening'), YOUTUBE_WIDGET_ORIGIN);
  };

  const player: YtPlayer & { disconnectResize?: () => void } = {
    playVideo() {
      command('playVideo');
    },
    pauseVideo() {
      command('pauseVideo');
    },
    seekTo(seconds: number) {
      command('seekTo', [seconds, true]);
    },
    getCurrentTime() {
      return currentTime;
    },
    getPlayerState() {
      return playerState;
    },
    getPlaybackRate() {
      return playbackRate;
    },
    setPlaybackRate(rate: number) {
      playbackRate = rate;
      command('setPlaybackRate', [rate]);
    },
    setSize(width: number, height: number) {
      iframe.width = String(Math.max(1, Math.round(width)));
      iframe.height = String(Math.max(1, Math.round(height)));
    },
    mute() {
      muted = true;
      command('mute');
    },
    unMute() {
      muted = false;
      command('unMute');
    },
    isMuted() {
      return muted;
    },
    destroy() {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };

  const onMessage = (event: MessageEvent) => {
    if (!isYouTubeWidgetOrigin(event.origin) || event.source !== iframe.contentWindow) {
      return;
    }
    const message = parseWidgetMessage(event.data);
    if (!message) {
      return;
    }
    if (message.event === 'initialDelivery' || message.event === 'infoDelivery' || message.event === 'onReady') {
      listen();
    }
    const info = message.info;
    if (message.event === 'onStateChange') {
      const state = asState(info);
      if (state != null) {
        playerState = state;
        handlers.onStateChange?.(state, player);
      }
    }
    if (info && typeof info === 'object') {
      const record = info as { currentTime?: unknown; playerState?: unknown; playbackRate?: unknown; muted?: unknown };
      if (typeof record.currentTime === 'number') {
        currentTime = record.currentTime;
      }
      const state = asState(record.playerState);
      if (state != null && state !== playerState) {
        playerState = state;
        handlers.onStateChange?.(state, player);
      }
      if (typeof record.playbackRate === 'number' && record.playbackRate > 0) {
        playbackRate = record.playbackRate;
      }
      if (typeof record.muted === 'boolean') {
        muted = record.muted;
      }
    }
    if (message.event === 'onReady' && !settled) {
      settled = true;
      player.setSize(sizeBox.clientWidth || 640, sizeBox.clientHeight || 360);
      handlers.onReady?.(player);
      resolveReady(player);
    }
  };

  let resolveReady: (player: YtPlayer & { disconnectResize?: () => void }) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<YtPlayer & { disconnectResize?: () => void }>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  window.addEventListener('message', onMessage);
  iframe.addEventListener('load', () => listen());

  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => player.setSize(sizeBox.clientWidth, sizeBox.clientHeight))
      : null;
  ro?.observe(sizeBox);
  player.disconnectResize = () => ro?.disconnect();

  const timer = window.setTimeout(() => {
    if (!settled) {
      player.destroy();
      rejectReady(new Error('YouTube player did not become ready'));
    }
  }, 15000);

  try {
    const created = await ready;
    window.clearTimeout(timer);
    return created;
  } catch (error) {
    window.clearTimeout(timer);
    throw error;
  }
}
