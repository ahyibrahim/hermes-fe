<script lang="ts">
  import type { ConnectionStatus, MessageRecord, RoomRecord } from '@hermes/core';
  import { goto } from '$app/navigation';
  import { downloadAttachment, getFileIO, getSession, signOut } from '$lib/client';
  import { onMount } from 'svelte';

  let rooms = $state<RoomRecord[]>([]);
  let messages = $state<MessageRecord[]>([]);
  let users = $state<string[]>([]);
  let status = $state<ConnectionStatus>('idle');
  let currentRoom = $state<string | null>(null);
  let username = $state<string | null>(null);
  let banner = $state('');
  let bannerError = $state(false);
  let draft = $state('');
  let pendingFile = $state<File | null>(null);
  let sending = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let scroller: HTMLDivElement | undefined = $state();

  const session = getSession();

  function syncFromSession(): void {
    const state = session.getState();
    messages = [...state.messages];
    users = [...state.roomUsers].sort((a, b) => a.localeCompare(b));
    currentRoom = state.room;
    username = state.username;
    status = session.getConnectionStatus();
  }

  function flash(message: string, isError = false): void {
    banner = message;
    bannerError = isError;
  }

  async function selectRoom(slug: string): Promise<void> {
    if (!slug || slug === currentRoom) {
      return;
    }
    banner = '';
    try {
      await session.enterRoom(slug);
      syncFromSession();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function loadRooms(): Promise<void> {
    try {
      rooms = await session.listRooms();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
      rooms = [];
    }
  }

  async function send(): Promise<void> {
    const text = draft.trim();
    const file = pendingFile;
    if (!text && !file) {
      return;
    }
    if (!currentRoom) {
      flash('Pick a room first.', true);
      return;
    }

    sending = true;
    try {
      if (file) {
        const path = await getFileIO().ingest(file);
        await session.sendFile(path);
        pendingFile = null;
        if (fileInput) {
          fileInput.value = '';
        }
      }
      if (text) {
        await session.sendMessage(text);
        draft = '';
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      sending = false;
    }
  }

  function onComposerKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function onFilePicked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    pendingFile = input.files?.[0] ?? null;
  }

  async function onDownload(message: MessageRecord): Promise<void> {
    if (message.file_id == null || message.file_id === '') {
      return;
    }
    try {
      await downloadAttachment(String(message.file_id), message.content);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function onSignOut(): Promise<void> {
    await signOut();
    await goto('/login');
  }

  function statusLabel(value: ConnectionStatus): string {
    if (value === 'open') {
      return 'connected';
    }
    if (value === 'closed' || value === 'idle') {
      return 'offline';
    }
    return value;
  }

  function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  $effect(() => {
    messages;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  });

  onMount(() => {
    syncFromSession();
    const offs = [
      session.on('history', () => syncFromSession()),
      session.on('message', () => syncFromSession()),
      session.on('presence', () => syncFromSession()),
      session.on('status', ({ status: next }) => {
        status = next;
      }),
      session.on('info', ({ message }) => flash(message, false)),
      session.on('error', ({ message }) => flash(message, true)),
      session.on('joined', ({ room }) => {
        currentRoom = room;
      }),
    ];

    void (async () => {
      await loadRooms();
      const first = rooms[0]?.slug;
      if (first && !session.getState().room) {
        await selectRoom(first);
      } else {
        syncFromSession();
      }
    })();

    return () => {
      for (const off of offs) {
        off();
      }
    };
  });
</script>

<div class="shell">
  <aside class="rail">
    <div class="rail-heading">rooms</div>
    {#if rooms.length === 0}
      <p class="empty-hint">No rooms yet.</p>
    {:else}
      <ul class="room-list">
        {#each rooms as room (room.id)}
          <li>
            <button
              type="button"
              class:active={room.slug === currentRoom}
              onclick={() => selectRoom(room.slug)}
            >
              <span class="hash">#</span>{room.slug}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="center">
    <header class="top-bar">
      <h2>
        {#if currentRoom}
          <span class="hash">#</span>{currentRoom}
        {:else}
          Hermes
        {/if}
      </h2>
      <span class="status {status}">
        <span class="status-dot"></span>
        {statusLabel(status)}
      </span>
      {#if username}
        <span class="whoami">{username}</span>
      {/if}
      <button type="button" class="sign-out" onclick={onSignOut}>Sign out</button>
    </header>

    <div class="messages" bind:this={scroller}>
      {#if banner}
        <p class="banner" class:error={bannerError}>{banner}</p>
      {/if}
      {#if messages.length === 0}
        <p class="empty-hint">No messages yet.</p>
      {:else}
        {#each messages as message (message.id)}
          <article class="message">
            <div class="meta">
              <span class="sender">{message.sender}</span>
              <time datetime={message.created_at}>{formatTime(message.created_at)}</time>
            </div>
            <p class="body">{message.content}</p>
            {#if message.file_id != null && message.file_id !== ''}
              <button type="button" class="file-action" onclick={() => onDownload(message)}>
                Download {message.content || `file ${message.file_id}`}
              </button>
            {/if}
          </article>
        {/each}
      {/if}
    </div>

    <form
      class="composer"
      onsubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <input type="file" hidden bind:this={fileInput} onchange={onFilePicked} />
      <button
        type="button"
        class="icon-btn"
        disabled={sending || !currentRoom}
        onclick={() => fileInput?.click()}
      >
        Attach
      </button>
      <textarea
        rows="1"
        placeholder={currentRoom ? `Message #${currentRoom}` : 'Pick a room first'}
        bind:value={draft}
        disabled={sending || !currentRoom}
        onkeydown={onComposerKey}
      ></textarea>
      <button class="send" type="submit" disabled={sending || !currentRoom || (!draft.trim() && !pendingFile)}>
        Send
      </button>
      {#if pendingFile}
        <span class="attach-name">{pendingFile.name}</span>
      {/if}
    </form>
  </section>

  <aside class="rail people">
    <div class="rail-heading">people</div>
    {#if users.length === 0}
      <p class="empty-hint">Nobody here yet.</p>
    {:else}
      <ul class="people-list">
        {#each users as name (name)}
          <li>{name}</li>
        {/each}
      </ul>
    {/if}
  </aside>
</div>
