<script lang="ts">
  import type { MessageRecord, PublicUser } from '@hermes/core';
  import IconButton from '$lib/components/IconButton.svelte';
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
      <span class="unsend">
        <IconButton label="Unsend" title="Unsend" tone="danger" onclick={() => onUnsend(message)}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3.5 4.5h9M6.2 4.5V3.2h3.6v1.3M4.6 4.5l.6 8.2h5.6l.6-8.2"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M6.8 6.6v4.4M9.2 6.6v4.4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </IconButton>
      </span>
    {/if}
  {/if}
</div>
