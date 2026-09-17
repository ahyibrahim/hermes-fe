<script lang="ts">
  import type { MessageRecord, PublicUser } from '@hermes/core';
  import IconButton from '$lib/components/IconButton.svelte';
  import ImagePreview from '$lib/components/ImagePreview.svelte';
  import MdPreview from '$lib/components/MdPreview.svelte';
  import MessageBody from '$lib/components/MessageBody.svelte';
  import { msgEnter, soft } from '$lib/motion';

  let {
    message,
    users,
    own,
    canDelete = own,
    animateEnter = false,
    onDownload,
    onUnsend,
    onWatchTogether,
  }: {
    message: MessageRecord;
    users: PublicUser[];
    own: boolean;
    canDelete?: boolean;
    /** Live append only — never true for room-history remounts. */
    animateEnter?: boolean;
    onDownload: (message: MessageRecord) => void;
    onUnsend: (message: MessageRecord) => void;
    onWatchTogether?: (url: string) => void;
  } = $props();

  const deleted = $derived(Boolean(message.deleted_at));
  const hasFile = $derived(!deleted && message.file_id != null && message.file_id !== '');
  const fileName = $derived(message.content || `file ${message.file_id}`);
  const isMarkdown = $derived(/\.(md|markdown)$/i.test(fileName));
</script>

<div
  class="msg-item"
  class:own
  class:can-delete={canDelete}
  in:msgEnter={{ enabled: animateEnter, own }}
>
  {#if deleted}
    <div class="msg-item-body tombstone" in:soft|local>Message deleted</div>
  {:else}
    {#if !hasFile}
      <div class="msg-item-body" out:soft|local>
        <MessageBody content={message.content} {users} {onWatchTogether} />
      </div>
    {/if}
    {#if hasFile && message.file_id != null && message.file_id !== ''}
      <div class="msg-item-file" out:soft|local>
        {#if isMarkdown}
          <MdPreview
            fileId={message.file_id}
            name={fileName}
            onDownload={() => onDownload(message)}
          />
        {:else}
          <ImagePreview
            fileId={message.file_id}
            name={fileName}
            onDownload={() => onDownload(message)}
          />
        {/if}
      </div>
    {/if}
    {#if canDelete}
      <span class="unsend">
        <IconButton
          label={own ? 'Unsend' : 'Delete'}
          title={own ? 'Unsend' : 'Delete message'}
          tone="danger"
          onclick={() => onUnsend(message)}
        >
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
