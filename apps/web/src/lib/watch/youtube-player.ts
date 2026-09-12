/** Minimal YouTube IFrame Player API helpers for Watch together. */

export type YtPlayerState = -1 | 0 | 1 | 2 | 3 | 5;

export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): YtPlayerState;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}

interface YtNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YtPlayer }) => void;
        onStateChange?: (event: { data: YtPlayerState; target: YtPlayer }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YtPlayer;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SCRIPT_SRC = 'https://www.youtube.com/iframe_api';
let apiPromise: Promise<YtNamespace> | null = null;

export function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube API requires a browser'));
  }
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (apiPromise) {
    return apiPromise;
  }

  apiPromise = new Promise((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube API failed to load'));
      }
    };

    if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onerror = () => {
        apiPromise = null;
        reject(new Error('Could not load YouTube IFrame API'));
      };
      document.head.appendChild(script);
    }
  });

  return apiPromise;
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

export async function createYouTubePlayer(
  mount: HTMLElement,
  videoId: string,
  handlers: {
    onReady?: (player: YtPlayer) => void;
    onStateChange?: (state: YtPlayerState, player: YtPlayer) => void;
  } = {}
): Promise<YtPlayer> {
  const YT = await loadYouTubeApi();
  return new Promise((resolve, reject) => {
    try {
      const player = new YT.Player(mount, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            handlers.onReady?.(event.target);
            resolve(event.target);
          },
          onStateChange: (event) => {
            handlers.onStateChange?.(event.data, event.target);
          },
          onError: () => {
            // Keep the promise resolved if ready already fired; otherwise fail soft.
          },
        },
      });
      // If onReady never fires, surface after a while for callers that await.
      window.setTimeout(() => {
        // Player instance exists even before ready; resolve only via onReady.
      }, 0);
      void player;
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
