<script lang="ts">
  import type { MessageRecord, PublicUser } from '@hermes/core';
  import MessageItem from '$lib/components/MessageItem.svelte';
  import UserChip from '$lib/components/UserChip.svelte';
  import { colorClass, formatMessageTime } from '$lib/ui';

  let {
    messages,
    sender,
    users,
    showName,
    ownName,
    onDownload,
    onUnsend,
    onResetPassword,
  }: {
    messages: MessageRecord[];
    sender: PublicUser | undefined;
    users: PublicUser[];
    showName: boolean;
    ownName: string | null;
    onDownload: (message: MessageRecord) => void;
    onUnsend: (message: MessageRecord) => void;
    onResetPassword?: (user: PublicUser) => void;
  } = $props();

  const first = $derived(messages[0]);
</script>

{#if first}
  <section
    class="msg-cluster {colorClass(sender?.color)}"
    class:continued={!showName}
    aria-label="Messages from {first.sender}"
  >
    <div class="msg-cluster-avatar">
      {#if showName && sender}
        <UserChip
          user={sender}
          showName={false}
          size="md"
          onResetPassword={ownName === sender.username ? undefined : onResetPassword}
        />
      {/if}
    </div>
    <header class="msg-group-meta">
      {#if showName}
        {#if sender}
          <UserChip
            user={sender}
            showAvatar={false}
            onResetPassword={ownName === sender.username ? undefined : onResetPassword}
          />
        {:else}
          <span class="sender">{first.sender}</span>
        {/if}
      {/if}
      <time datetime={first.created_at}>{formatMessageTime(first.created_at)}</time>
    </header>
    <div class="msg-group">
      {#each messages as message (message.id)}
        <MessageItem {message} {users} own={ownName === message.sender} {onDownload} {onUnsend} />
      {/each}
    </div>
  </section>
{/if}
