<script lang="ts">
  import type { MessageRecord, PublicUser } from '@hermes/core';
  import ImagePreview from '$lib/components/ImagePreview.svelte';
  import MessageBody from '$lib/components/MessageBody.svelte';

  let {
    message,
    users,
    onDownload,
  }: {
    message: MessageRecord;
    users: PublicUser[];
    onDownload: (message: MessageRecord) => void;
  } = $props();

  const hasFile = $derived(message.file_id != null && message.file_id !== '');
</script>

<div class="msg-item">
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
</div>
