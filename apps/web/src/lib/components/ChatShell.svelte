<script lang="ts">
  import type { ConnectionStatus, MessageRecord, PublicUser, RoomRecord } from '@hermes/core';
  import { goto } from '$app/navigation';
  import { downloadAttachment, getFileIO, getSession, signOut } from '$lib/client';
  import { onMount } from 'svelte';

  let rooms = $state<RoomRecord[]>([]);
  let directory = $state<PublicUser[]>([]);
  let online = $state<string[]>([]);
  let messages = $state<MessageRecord[]>([]);
  let users = $state<string[]>([]);
  let status = $state<ConnectionStatus>('idle');
  let currentRoom = $state<string | null>(null);
  let username = $state<string | null>(null);
  let banner = $state('');
  let bannerError = $state(false);
  let draft = $state('');
  let newRoomName = $state('');
  let pendingFile = $state<File | null>(null);
  let sending = $state(false);
  let creatingRoom = $state(false);
  let startingDm = $state<number | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let scroller: HTMLDivElement | undefined = $state();

  const session = getSession();

  function isDm(room: RoomRecord | undefined): boolean {
    if (!room) {
      return false;
    }
    return room.type === 'dm' || room.slug.startsWith('dm:');
  }

  function roomTitle(room: RoomRecord | undefined): string {
    if (!room) {
      return '';
    }
    if (isDm(room)) {
      const fromName = (room.name ?? '')
        .split(',')
        .map((part) => part.trim())
        .find((part) => part && part !== username);
      if (fromName) {
        return fromName;
      }
      const fromSlug = room.slug
        .split(':')
        .slice(1)
        .find((part) => part && part !== username);
      if (fromSlug) {
        return fromSlug;
      }
    }
    return room.name || room.slug;
  }

  function currentRoomRecord(): RoomRecord | undefined {
    return rooms.find((room) => room.slug === currentRoom);
  }

  function composerHint(): string {
    const room = currentRoomRecord();
    if (!room) {
      return 'Pick a room first';
    }
    return isDm(room) ? `Message ${roomTitle(room)}` : `Message #${roomTitle(room)}`;
  }

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

  async function loadDirectory(): Promise<void> {
    try {
      const [people, onlineUsers] = await Promise.all([session.listUsers(), session.listOnlineUsers()]);
      directory = people;
      online = onlineUsers;
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
      directory = [];
      online = [];
    }
  }

  async function createGroup(): Promise<void> {
    const name = newRoomName.trim();
    if (!name || creatingRoom) {
      return;
    }
    creatingRoom = true;
    try {
      const room = await session.createRoom(name);
      newRoomName = '';
      await loadRooms();
      await selectRoom(room.slug);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      creatingRoom = false;
    }
  }

  async function startDm(user: PublicUser): Promise<void> {
    if (user.username === username || startingDm != null) {
      return;
    }
    startingDm = user.id;
    try {
      const room = await session.createDm(user.id);
      await loadRooms();
      await selectRoom(room.slug);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      startingDm = null;
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
      session.on('presence', () => {
        syncFromSession();
        void loadDirectory();
      }),
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
      await Promise.all([loadRooms(), loadDirectory()]);
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
              {#if isDm(room)}
                <span class="hash">@</span>{roomTitle(room)}
              {:else}
                <span class="hash">#</span>{roomTitle(room)}
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <form
      class="new-room"
      onsubmit={(event) => {
        event.preventDefault();
        void createGroup();
      }}
    >
      <input
        type="text"
        placeholder="New room"
        bind:value={newRoomName}
        disabled={creatingRoom}
        maxlength="80"
      />
      <button type="submit" disabled={creatingRoom || !newRoomName.trim()}>Create</button>
    </form>
  </aside>

  <section class="center">
    <header class="top-bar">
      <h2>
        {#if currentRoomRecord()}
          {#if isDm(currentRoomRecord())}
            <span class="hash">@</span>{roomTitle(currentRoomRecord())}
          {:else}
            <span class="hash">#</span>{roomTitle(currentRoomRecord())}
          {/if}
        {:else}
          Hermes
        {/if}
      </h2>
      <span class="status {status}">
        <span class="status-dot"></span>
        {statusLabel(status)}
      </span>
      {#if username}
        <a class="whoami" href="/profile">{username}</a>
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
        placeholder={composerHint()}
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
    {#if directory.length === 0}
      <p class="empty-hint">Nobody here yet.</p>
    {:else}
      <ul class="people-list">
        {#each directory as person (person.id)}
          <li>
            {#if person.username === username}
              <span class="self">
                <span class="status-dot" class:open={online.includes(person.username)}></span>
                {person.username}
                <span class="you">you</span>
              </span>
            {:else}
              <button
                type="button"
                class:active={currentRoomRecord() && isDm(currentRoomRecord()) && roomTitle(currentRoomRecord()) === person.username}
                disabled={startingDm != null}
                onclick={() => startDm(person)}
              >
                <span class="status-dot" class:open={online.includes(person.username) || users.includes(person.username)}></span>
                {person.username}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
</div>
