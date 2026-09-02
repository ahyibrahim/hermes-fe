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
    onDownload,
  }: {
    messages: MessageRecord[];
    sender: PublicUser | undefined;
    users: PublicUser[];
    showName: boolean;
    onDownload: (message: MessageRecord) => void;
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
        <UserChip user={sender} showName={false} size="md" />
      {/if}
    </div>
    <header class="msg-group-meta">
      {#if showName}
        {#if sender}
          <UserChip user={sender} showAvatar={false} />
        {:else}
          <span class="sender">{first.sender}</span>
        {/if}
      {/if}
      <time datetime={first.created_at}>{formatMessageTime(first.created_at)}</time>
    </header>
    <div class="msg-group">
      {#each messages as message (message.id)}
        <MessageItem {message} {users} {onDownload} />
      {/each}
    </div>
  </section>
{/if}
