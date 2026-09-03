<script lang="ts">
  import type { MessageRecord, PublicUser } from '@hermes/core';
  import ImagePreview from '$lib/components/ImagePreview.svelte';
  import MessageBody from '$lib/components/MessageBody.svelte';

  let {
    message,
    users,
    own,
    onDownload,
    onUnsend,
  }: {
    message: MessageRecord;
    users: PublicUser[];
    own: boolean;
    onDownload: (message: MessageRecord) => void;
    onUnsend: (message: MessageRecord) => void;
  } = $props();

  const deleted = $derived(Boolean(message.deleted_at));
  const hasFile = $derived(!deleted && message.file_id != null && message.file_id !== '');
</script>

<div class="msg-item" class:own>
  {#if deleted}
    <div class="msg-item-body tombstone">Message deleted</div>
  {:else}
    {#if !hasFile}
      <div class="msg-item-body">
        <MessageBody content={message.content} {users} />
      </div>
    {/if}
    {#if hasFile && message.file_id != null && message.file_id !== ''}
      <ImagePreview
        fileId={message.file_id}
        name={message.content || `file ${message.file_id}`}
        onDownload={() => onDownload(message)}
      />
    {/if}
    {#if own}
      <button type="button" class="unsend" title="Unsend" onclick={() => onUnsend(message)}>Unsend</button>
    {/if}
  {/if}
</div>
