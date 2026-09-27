<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import CallBar from '$lib/components/CallBar.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import type { SfxName } from '$lib/sfx';
  import type { VoiceMesh, VoiceState } from '$lib/voice/mesh';

  type Props = {
    voice: VoiceState;
    mesh: VoiceMesh | undefined;
    currentRoom: string | null;
    username: string | null;
    directory: PublicUser[];
    roomLabel: string;
    showWatchBanner: boolean;
    onSelectRoom: (slug: string) => void | Promise<void>;
    onOpenWatch: () => void | Promise<void>;
    onLeaveWatch: () => void | Promise<void>;
    playSfx: (name: SfxName) => void;
  };

  let {
    voice,
    mesh,
    currentRoom,
    username,
    directory,
    roomLabel,
    showWatchBanner,
    onSelectRoom,
    onOpenWatch,
    onLeaveWatch,
    playSfx,
  }: Props = $props();
</script>

{#if voice.room}
  <CallBar
    {roomLabel}
    viewingCallRoom={voice.room === currentRoom}
    muted={voice.muted}
    joining={voice.joining}
    peers={voice.peers}
    directory={directory}
    mics={voice.mics}
    inputDeviceId={voice.inputDeviceId}
    sharing={voice.sharing}
    preview={voice.preview}
    selfName={username}
    error={voice.error}
    onMute={(muted) => {
      mesh?.setMuted(muted);
      playSfx(muted ? 'mute' : 'unmute');
    }}
    onLeave={() => {
      void mesh?.leave();
      playSfx('leave');
    }}
    onPickMic={(deviceId) => mesh?.setInputDevice(deviceId)}
    onShowRoom={() => {
      if (voice.room) {
        void onSelectRoom(voice.room);
      }
    }}
    onShare={() => {
      void mesh?.startShare();
    }}
    onStopShare={() => {
      void mesh?.stopShare();
    }}
  />
{/if}

{#if showWatchBanner}
  <div class="watch-banner">
    <span>Watching together</span>
    <span class="watch-banner-actions">
      <IconButton label="Open watch" title="Open watch" onclick={() => void onOpenWatch()}>
        <IconGlyph name="watch" size={14} />
      </IconButton>
      <IconButton label="Leave watch" title="Leave watch" onclick={() => void onLeaveWatch()}>
        <IconGlyph name="leave" size={14} />
      </IconButton>
    </span>
  </div>
{/if}
