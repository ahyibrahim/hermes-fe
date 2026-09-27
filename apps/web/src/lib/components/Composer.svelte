<script lang="ts">
  import type { ConnectionStatus } from '@hermes/core';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import { motionMs, prefersReducedMotion, soft } from '$lib/motion';

  type Props = {
    currentRoom: string | null;
    status: ConnectionStatus;
    draft: string;
    hint: string;
    typingUsers: string[];
    pendingFile: File | null;
    pendingFileUrl: string | null;
    sending: boolean;
    sendFlash: boolean;
    phoneViewport: boolean;
    onSend: () => void;
    onDraftInput: () => void;
    onTypingBlur: () => void;
    onFileSelected: (file: File | null | undefined) => void;
    onClearFile: () => void;
  };

  let {
    currentRoom,
    status,
    draft = $bindable(),
    hint,
    typingUsers,
    pendingFile,
    pendingFileUrl,
    sending,
    sendFlash,
    phoneViewport,
    onSend,
    onDraftInput,
    onTypingBlur,
    onFileSelected,
    onClearFile,
  }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();

  $effect(() => {
    if (!pendingFile && fileInput) {
      fileInput.value = '';
    }
  });

  export function focus(): void {
    composer?.focus();
  }

  export function growComposer(): void {
    if (!composer) {
      return;
    }
    const el = composer;
    const prev = el.offsetHeight;
    el.style.height = 'auto';
    const max = 8 * 16;
    const next = Math.min(el.scrollHeight, max);
    if (prefersReducedMotion() || prev === next) {
      el.style.transition = '';
      el.style.height = `${next}px`;
      return;
    }
    el.style.transition = '';
    el.style.height = `${prev}px`;
    void el.offsetHeight;
    el.style.transition = `height ${motionMs.base}ms var(--ease-out)`;
    el.style.height = `${next}px`;
  }

  function typingLabel(names: string[]): string {
    if (names.length === 0) {
      return '';
    }
    if (names.length === 1) {
      return `${names[0]} is typing`;
    }
    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing`;
    }
    return `${names[0]} and ${names.length - 1} others are typing`;
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileBadgeLabel(name: string): string {
    const ext = name.split('.').pop()?.toUpperCase();
    return ext && ext.length <= 4 ? ext : 'FILE';
  }

  function onComposerKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !phoneViewport) {
      event.preventDefault();
      onSend();
    }
  }

  function onFilePicked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    onFileSelected(input.files?.[0] ?? null);
  }

  function onComposerDrop(event: DragEvent): void {
    event.preventDefault();
    onFileSelected(event.dataTransfer?.files?.[0]);
  }

  function onComposerPaste(event: ClipboardEvent): void {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      onFileSelected(file);
    }
  }
</script>

<div class="composer-presence" class:active={typingUsers.length > 0} aria-live="polite">
  {#if typingUsers.length > 0}
    <div class="typing-indicator" transition:soft>
      <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>{typingLabel(typingUsers)}</span>
    </div>
  {/if}
</div>

{#if pendingFile}
  <div class="composer-attachment-strip" transition:soft>
    <div class="attach-preview-chip">
      {#if pendingFileUrl}
        <img class="attach-thumb" src={pendingFileUrl} alt="" />
      {:else}
        <span class="attach-badge">{fileBadgeLabel(pendingFile.name)}</span>
      {/if}
      <div class="attach-meta">
        <span class="attach-name" title={pendingFile.name}>{pendingFile.name}</span>
        <span class="attach-size">{formatFileSize(pendingFile.size)}</span>
      </div>
      <button
        type="button"
        class="attach-remove-btn"
        onclick={onClearFile}
        aria-label="Remove attachment"
        title="Remove file"
      >
        ×
      </button>
    </div>
  </div>
{/if}

<form
  class="composer"
  class:conn-soft={status !== 'open'}
  data-status={status}
  onsubmit={(event) => {
    event.preventDefault();
    onSend();
  }}
  ondragover={(event) => event.preventDefault()}
  ondrop={onComposerDrop}
>
  <input type="file" hidden bind:this={fileInput} onchange={onFilePicked} />
  <div class="composer-attach">
    <IconButton
      label="Attach file"
      disabled={sending || !currentRoom}
      onclick={() => fileInput?.click()}
    >
      <IconGlyph name="attach" />
    </IconButton>
  </div>
  <textarea
    rows="1"
    placeholder={hint}
    bind:this={composer}
    bind:value={draft}
    disabled={!currentRoom}
    oninput={onDraftInput}
    onkeydown={onComposerKey}
    onpaste={onComposerPaste}
    onblur={onTypingBlur}
  ></textarea>
  <span class="composer-send" class:flash={sendFlash}>
    <IconButton
      type="submit"
      label="Send"
      tone="accent"
      disabled={sending || !currentRoom || (!draft.trim() && !pendingFile)}
    >
      <IconGlyph name="send" />
    </IconButton>
  </span>
</form>
