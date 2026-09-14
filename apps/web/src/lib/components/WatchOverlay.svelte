<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import {
    applyWatchState,
    createYouTubePlayer,
    type YtPlayer,
    type YtPlayerState,
  } from '$lib/watch/youtube-player';

  let {
    videoId,
    host,
    users,
    playing,
    position,
    rate,
    updatedAt,
    canControl,
    deniedHint = '',
    onLeave,
    onEnd,
    onControl,
  }: {
    videoId: string;
    host: string;
    users: string[];
    playing: boolean;
    position: number;
    rate: number;
    updatedAt: number;
    canControl: boolean;
    deniedHint?: string;
    onLeave: () => void;
    onEnd: () => void;
    onControl: (action: 'play' | 'pause' | 'seek' | 'rate', opts?: { position?: number; rate?: number }) => void;
  } = $props();

  let mountEl: HTMLDivElement | undefined = $state();
  let player: YtPlayer | null = null;
  let ready = $state(false);
  let needsGesture = $state(false);
  let applyingRemote = false;
  let lastAppliedAt = 0;
  let destroyPlayer: (() => void) | null = null;
  let disconnectResize: (() => void) | null = null;

  const peerLabel = $derived(
    users.length === 0 ? 'No one yet' : users.join(', ')
  );

  function snapshot() {
    return { playing, position, rate, updatedAt };
  }

  function pushRemote(): void {
    if (!player || !ready) {
      return;
    }
    applyingRemote = true;
    lastAppliedAt = Date.now();
    try {
      const result = applyWatchState(player, snapshot());
      if (result.playAttempted && playing) {
        // Detect blocked autoplay shortly after.
        window.setTimeout(() => {
          if (!player || !playing) {
            return;
          }
          const state = player.getPlayerState();
          if (state !== 1 && state !== 3) {
            needsGesture = true;
          }
        }, 400);
      }
    } finally {
      window.setTimeout(() => {
        applyingRemote = false;
      }, 350);
    }
  }

  function onPlayerState(state: YtPlayerState, target: YtPlayer): void {
    if (!canControl || applyingRemote) {
      return;
    }
    // Ignore churn right after a remote apply.
    if (Date.now() - lastAppliedAt < 400) {
      return;
    }
    const pos = target.getCurrentTime();
    if (state === 1) {
      needsGesture = false;
      onControl('play', { position: pos });
    } else if (state === 2) {
      onControl('pause', { position: pos });
    } else if (state === 0) {
      onControl('pause', { position: pos });
    }
  }

  async function tapToSync(): Promise<void> {
    if (!player) {
      return;
    }
    needsGesture = false;
    try {
      player.unMute();
      applyWatchState(player, snapshot());
    } catch {
      needsGesture = true;
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onLeave();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    let cancelled = false;
    void (async () => {
      if (!mountEl) {
        return;
      }
      const hostEl = document.createElement('div');
      hostEl.className = 'watch-player-host';
      mountEl.appendChild(hostEl);
      try {
        const created = await createYouTubePlayer(hostEl, videoId, {
          sizeBox: mountEl,
          onStateChange: (state, target) => {
            if (cancelled) {
              return;
            }
            onPlayerState(state, target);
          },
        });
        if (cancelled) {
          created.disconnectResize?.();
          created.destroy();
          return;
        }
        player = created;
        disconnectResize = created.disconnectResize ?? null;
        destroyPlayer = () => {
          try {
            created.disconnectResize?.();
            created.destroy();
          } catch {
            // ignore
          }
        };
        ready = true;
        pushRemote();
      } catch {
        needsGesture = true;
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      disconnectResize?.();
      disconnectResize = null;
      destroyPlayer?.();
      destroyPlayer = null;
      player = null;
    };
  });

  onDestroy(() => {
    disconnectResize?.();
    destroyPlayer?.();
  });

  $effect(() => {
    // Re-apply when server snapshot fields change.
    void playing;
    void position;
    void rate;
    void updatedAt;
    void videoId;
    if (ready && player) {
      // Spectators always follow; controllers follow when remote (others) update.
      // Controllers still apply on join / late sync via updatedAt bumps from server.
      pushRemote();
    }
  });
</script>

<div class="watch-overlay" role="dialog" aria-modal="true" aria-label="Watch together">
  <div class="watch-overlay-panel">
    <header class="watch-overlay-bar">
      <div class="watch-overlay-meta">
        <p class="watch-overlay-title">Watch together</p>
        <p class="watch-overlay-host">Host {host}</p>
        <p class="watch-overlay-peers" title={peerLabel}>{peerLabel}</p>
      </div>
      <div class="watch-overlay-actions">
        {#if canControl}
          <IconButton label="End watch" title="End watch" tone="danger" onclick={onEnd}>
            <IconGlyph name="close" size={16} />
          </IconButton>
        {/if}
        <IconButton label="Leave watch" title="Leave watch" onclick={onLeave}>
          <IconGlyph name="leave" size={16} />
        </IconButton>
      </div>
    </header>

    {#if deniedHint}
      <p class="watch-overlay-hint error">{deniedHint}</p>
    {/if}

    <div class="watch-player-wrap">
      <div class="watch-player" bind:this={mountEl}></div>
      {#if needsGesture}
        <button type="button" class="watch-sync-gate" onclick={() => void tapToSync()}>
          Tap to sync
        </button>
      {/if}
      {#if !canControl}
        <p class="watch-spectator-note">Spectating — host or admin controls playback</p>
      {/if}
    </div>
  </div>
</div>
