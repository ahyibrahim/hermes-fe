<script lang="ts">
  import type { MessageRecord, PublicUser, TranscriptRow } from '@hermes/core';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import MessageGroup from '$lib/components/MessageGroup.svelte';
  import { soft } from '$lib/motion';

  type TranscriptPhase = 'idle' | 'leaving' | 'entering';

  type Props = {
    displayMessages: MessageRecord[];
    transcriptRows: TranscriptRow<MessageRecord>[];
    transcriptPhase: TranscriptPhase;
    pendingRoom: string | null;
    banner: string;
    bannerError: boolean;
    showJump: boolean;
    directory: PublicUser[];
    username: string | null;
    me: PublicUser | null;
    onTranscriptScroll: () => void;
    onJumpToLatest: () => void;
    lookupUser: (name: string) => PublicUser | undefined;
    shouldAnimateEnter: (id: number) => boolean;
    onDownload: (message: MessageRecord) => void | Promise<void>;
    onUnsend: (message: MessageRecord) => void | Promise<void>;
    onResetPassword?: (user: PublicUser) => void | Promise<void>;
    onSetRole?: (user: PublicUser, role: 'member' | 'admin') => void | Promise<void>;
    onWatchTogether: (url: string) => void;
    scroller?: HTMLDivElement;
  };

  let {
    displayMessages,
    transcriptRows,
    transcriptPhase,
    pendingRoom,
    banner,
    bannerError,
    showJump,
    directory,
    username,
    me,
    onTranscriptScroll,
    onJumpToLatest,
    lookupUser,
    shouldAnimateEnter,
    onDownload,
    onUnsend,
    onResetPassword,
    onSetRole,
    onWatchTogether,
    scroller = $bindable(),
  }: Props = $props();
</script>

<div class="messages" bind:this={scroller} onscroll={onTranscriptScroll}>
  <div
    class="messages-body"
    class:scene-leaving={transcriptPhase === 'leaving'}
    class:scene-entering={transcriptPhase === 'entering'}
  >
    {#if banner}
      <p class="banner" class:error={bannerError}>{banner}</p>
    {/if}
    {#if displayMessages.length === 0 && transcriptPhase === 'idle' && !pendingRoom}
      <p class="empty-hint">No messages yet.</p>
    {:else}
      {#each transcriptRows as row (row.key)}
        {#if row.kind === 'date'}
          <div class="date-sep">{row.label}</div>
        {:else}
          <MessageGroup
            messages={row.group.messages}
            sender={row.group.messages[0] ? lookupUser(row.group.messages[0].sender) : undefined}
            users={directory}
            showName={row.group.showName}
            ownName={username}
            isAdmin={me?.role === 'admin'}
            {shouldAnimateEnter}
            {onDownload}
            onUnsend={onUnsend}
            onResetPassword={me?.role === 'admin' ? onResetPassword : undefined}
            onSetRole={me?.role === 'admin' ? onSetRole : undefined}
            {onWatchTogether}
          />
        {/if}
      {/each}
    {/if}
  </div>
</div>

{#if showJump}
  <div class="jump-latest" transition:soft>
    <IconButton label="Jump to latest" onclick={onJumpToLatest}>
      <IconGlyph name="jump" />
    </IconButton>
  </div>
{/if}
