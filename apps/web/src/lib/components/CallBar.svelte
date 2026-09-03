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
    error,
    onMute,
    onLeave,
    onPickMic,
    onShowRoom,
  }: {
    roomLabel: string;
    viewingCallRoom: boolean;
    muted: boolean;
    joining: boolean;
    peers: VoicePeer[];
    directory?: PublicUser[];
    mics?: VoiceMic[];
    inputDeviceId?: string | null;
    error: string | null;
    onMute: (muted: boolean) => void;
    onLeave: () => void;
    onPickMic: (deviceId: string) => void;
    onShowRoom: () => void;
  } = $props();

  function lookup(name: string): PublicUser | undefined {
    return directory.find((person) => person.username === name);
  }
</script>

<div class="call-drawer">
  <div class="call-drawer-inner">
    <div class="call-main">
      <div class="call-meta">
        <span class="call-live">In call</span>
        {#if viewingCallRoom}
          <span class="call-room">{roomLabel}</span>
        {:else}
          <button type="button" class="call-room-link" onclick={onShowRoom}>{roomLabel}</button>
        {/if}
      </div>
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
      <div class="call-actions">
        <IconButton
          label={muted ? 'Unmute' : 'Mute'}
          disabled={joining}
          pressed={muted}
          onclick={() => onMute(!muted)}
        >
          <IconGlyph name={muted ? 'mic-off' : 'mic'} />
        </IconButton>
        {#if mics.length > 0}
          <label class="call-mic-pick">
            <span class="visually-hidden">Microphone</span>
            <select
              value={inputDeviceId ?? mics[0]?.deviceId ?? ''}
              disabled={joining}
              onchange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                if (value) {
                  onPickMic(value);
                }
              }}
            >
              {#each mics as mic (mic.deviceId)}
                <option value={mic.deviceId}>{mic.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        <IconButton label="Leave call" tone="danger" disabled={joining} onclick={onLeave}>
          <IconGlyph name="hangup" />
        </IconButton>
      </div>
    </div>
    <!-- Reserved for a later screen-share preview row. Do not put a fake Share button here. -->
    <div class="call-preview" aria-hidden="true"></div>
    {#if error}
      <p class="call-error">{error}</p>
    {/if}
  </div>
</div>
