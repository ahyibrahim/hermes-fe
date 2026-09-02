<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import type { VoicePeer } from '$lib/voice/mesh';
  import UserChip from '$lib/components/UserChip.svelte';

  let {
    roomLabel,
    viewingCallRoom,
    muted,
    joining,
    peers,
    directory = [],
    error,
    onMute,
    onLeave,
    onShowRoom,
  }: {
    roomLabel: string;
    viewingCallRoom: boolean;
    muted: boolean;
    joining: boolean;
    peers: VoicePeer[];
    directory?: PublicUser[];
    error: string | null;
    onMute: (muted: boolean) => void;
    onLeave: () => void;
    onShowRoom: () => void;
  } = $props();

  function lookup(name: string): PublicUser | undefined {
    return directory.find((person) => person.username === name);
  }
</script>

<div class="call-bar">
  <div class="call-meta">
    <span class="call-live">In call</span>
    {#if viewingCallRoom}
      <span class="call-room">{roomLabel}</span>
    {:else}
      <button type="button" class="call-room-link" onclick={onShowRoom}>{roomLabel}</button>
    {/if}
  </div>
  <ul class="call-peers">
    {#each peers as peer (peer.username)}
      {@const person = lookup(peer.username)}
      <li class:speaking={peer.speaking}>
        {#if person}
          <UserChip user={person} size="sm" />
        {:else}
          {peer.username}
        {/if}
      </li>
    {/each}
  </ul>
  <div class="call-actions">
    <button type="button" class="call-btn" disabled={joining} onclick={() => onMute(!muted)}>
      {muted ? 'Unmute' : 'Mute'}
    </button>
    <button type="button" class="call-btn leave" disabled={joining} onclick={onLeave}>Leave</button>
  </div>
  {#if error}
    <p class="call-error">{error}</p>
  {/if}
</div>
