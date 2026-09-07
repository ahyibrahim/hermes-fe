<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import type { VoiceMic, VoicePeer } from '$lib/voice/mesh';
  import Avatar from '$lib/components/Avatar.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';

  let {
    roomLabel,
    viewingCallRoom,
    muted,
    joining,
    peers,
    directory = [],
    mics = [],
    inputDeviceId = null,
    sharing = null,
    preview = null,
    selfName = null,
    error,
    onMute,
    onLeave,
    onPickMic,
    onShowRoom,
    onShare,
    onStopShare,
  }: {
    roomLabel: string;
    viewingCallRoom: boolean;
    muted: boolean;
    joining: boolean;
    peers: VoicePeer[];
    directory?: PublicUser[];
    mics?: VoiceMic[];
    inputDeviceId?: string | null;
    sharing?: string | null;
    preview?: MediaStream | null;
    selfName?: string | null;
    error: string | null;
    onMute: (muted: boolean) => void;
    onLeave: () => void;
    onPickMic: (deviceId: string) => void;
    onShowRoom: () => void;
    onShare: () => void;
    onStopShare: () => void;
  } = $props();

  let expanded = $state(false);
  let showSettings = $state(false);
  let lightbox = $state(false);
  let showMicPicker = $state(false);
  const sharingSelf = $derived(Boolean(sharing && selfName && sharing === selfName));
  const selectedMic = $derived(
    mics.find((mic) => mic.deviceId === inputDeviceId) ?? mics[0] ?? null
  );
  const inputLabel = $derived(selectedMic?.label?.trim() || 'Choose input');

  function bindStream(node: HTMLVideoElement, stream: MediaStream | null) {
    node.srcObject = stream;
    return {
      update(next: MediaStream | null) {
        node.srcObject = next;
      },
    };
  }

  function closeLightbox(event?: KeyboardEvent) {
    if (event && event.key !== 'Escape') {
      return;
    }
    lightbox = false;
  }

  $effect(() => {
    if (!lightbox) {
      return;
    }
    const onKey = (event: KeyboardEvent) => closeLightbox(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    if (!showSettings && !showMicPicker) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (showMicPicker) {
        showMicPicker = false;
        return;
      }
      showSettings = false;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function lookup(name: string): PublicUser | undefined {
    return directory.find((person) => person.username === name);
  }

  function pickMic(deviceId: string): void {
    onPickMic(deviceId);
    showMicPicker = false;
  }

  function toggleSettings(): void {
    showSettings = !showSettings;
    if (!showSettings) {
      showMicPicker = false;
    }
  }
</script>

<div class="call-drawer" class:open={expanded}>
  <div class="call-drawer-inner">
    <div class="call-strip">
      <div class="call-main">
        <div class="call-meta">
          <span class="call-live">In call</span>
          {#if viewingCallRoom}
            <span class="call-room">{roomLabel}</span>
          {:else}
            <button type="button" class="call-room-link" onclick={onShowRoom}>{roomLabel}</button>
          {/if}
        </div>
        <div class="call-actions">
          <IconButton
            label={muted ? 'Unmute' : 'Mute'}
            disabled={joining}
            pressed={muted}
            onclick={() => onMute(!muted)}
          >
            <IconGlyph name={muted ? 'mic-off' : 'mic'} />
          </IconButton>
          <IconButton
            label={sharingSelf ? 'Stop share' : sharing ? `${sharing} is sharing` : 'Share screen'}
            disabled={joining || Boolean(sharing && !sharingSelf)}
            pressed={sharingSelf}
            onclick={() => (sharingSelf ? onStopShare() : onShare())}
          >
            <IconGlyph name={sharingSelf ? 'share-off' : 'share'} />
          </IconButton>
          <IconButton label="Leave call" tone="danger" disabled={joining} onclick={onLeave}>
            <IconGlyph name="hangup" />
          </IconButton>
          <IconButton
            label="Call settings"
            disabled={joining}
            pressed={showSettings}
            onclick={toggleSettings}
          >
            <IconGlyph name="cog" />
          </IconButton>
        </div>
      </div>
      <button
        type="button"
        class="call-drawer-tab"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse call drawer' : 'Expand call drawer'}
        onclick={() => (expanded = !expanded)}
      >
        <IconGlyph name={expanded ? 'chevron-up' : 'chevron-down'} />
      </button>
    </div>

    {#if showSettings}
      <div class="call-settings" role="region" aria-label="Call settings">
        <p class="call-settings-title">Call settings</p>
        {#if mics.length > 0}
          <div class="call-mic-pick">
            <button
              type="button"
              class="call-input-btn"
              disabled={joining}
              aria-expanded={showMicPicker}
              aria-haspopup="listbox"
              onclick={() => (showMicPicker = !showMicPicker)}
            >
              <IconGlyph name="mic-pick" />
              <span class="call-input-label">{inputLabel}</span>
            </button>
            {#if showMicPicker}
              <div class="call-mic-popup" role="listbox" aria-label="Input device">
                {#each mics as mic (mic.deviceId)}
                  <button
                    type="button"
                    class="call-mic-option"
                    class:active={mic.deviceId === (inputDeviceId ?? mics[0]?.deviceId)}
                    role="option"
                    aria-selected={mic.deviceId === (inputDeviceId ?? mics[0]?.deviceId)}
                    onclick={() => pickMic(mic.deviceId)}
                  >
                    {mic.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <p class="call-settings-empty">No microphones found.</p>
        {/if}
      </div>
    {/if}

    {#if expanded}
      <div class="call-panel" role="region" aria-label="Call details">
        <ul class="call-avatars">
          {#each peers as peer (peer.username)}
            {@const person = lookup(peer.username)}
            <li class:speaking={peer.speaking} title={peer.username}>
              {#if person}
                <Avatar user={person} size="sm" />
              {:else}
                <span class="avatar-face placeholder sm" aria-hidden="true">
                  {(peer.username.slice(0, 1) || '?').toUpperCase()}
                </span>
              {/if}
              <span class="call-avatar-name">{peer.username}</span>
            </li>
          {/each}
        </ul>
        {#if sharing}
          <div class="call-preview">
            <p class="call-share-label">{sharingSelf ? 'You are sharing' : `${sharing} is sharing`}</p>
            {#if preview}
              <button type="button" class="call-share-frame" onclick={() => (lightbox = true)}>
                <video use:bindStream={preview} autoplay playsinline muted={sharingSelf}></video>
                <span class="visually-hidden">Expand screen share</span>
              </button>
            {/if}
          </div>
        {/if}
        {#if error}
          <p class="call-error">{error}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if lightbox && preview}
  <button
    type="button"
    class="call-share-expand"
    aria-label="Close screen share"
    onclick={() => (lightbox = false)}
  >
    <video use:bindStream={preview} autoplay playsinline muted={sharingSelf}></video>
  </button>
{/if}
