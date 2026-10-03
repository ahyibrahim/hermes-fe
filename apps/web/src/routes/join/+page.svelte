<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  type GuestMessage = {
    id: number;
    sender: string;
    content: string;
    created_at: string;
  };

  type GuestRoom = {
    slug: string;
    name: string;
    members?: string[];
  };

  let token = $state('');
  let username = $state('');
  let error = $state('');
  let busy = $state(false);
  let status = $state<'join' | 'waiting' | 'admitted'>('join');
  let rooms = $state<GuestRoom[]>([]);
  let room = $state('');
  let messages = $state<GuestMessage[]>([]);
  let draft = $state('');
  let poll: ReturnType<typeof setInterval> | undefined;
  let socket: WebSocket | undefined;

  async function readJson(res: Response): Promise<{ error?: string; [key: string]: unknown }> {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      throw new Error(data?.error || 'request failed');
    }
    return (data ?? {}) as { error?: string; [key: string]: unknown };
  }

  function currentRoom(): GuestRoom | undefined {
    return rooms.find((item) => item.slug === room) ?? rooms[0];
  }

  async function loadMessages(): Promise<void> {
    const active = currentRoom();
    if (!active) {
      messages = [];
      return;
    }
    room = active.slug;
    const res = await fetch(`/messages?room=${encodeURIComponent(active.slug)}`);
    const data = await readJson(res);
    const page = data as { messages?: GuestMessage[] };
    messages = page.messages ?? [];
  }

  function connectSocket(): void {
    socket?.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const next = new WebSocket(`${proto}//${location.host}/ws`);
    socket = next;
    next.addEventListener('open', () => {
      const active = currentRoom();
      if (active) {
        next.send(JSON.stringify({ type: 'join_room', room: active.slug }));
      }
    });
    next.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as {
          type?: string;
          message?: GuestMessage & { room?: string };
        };
        if (frame.type === 'message' && frame.message && frame.message.room === room) {
          if (!messages.some((item) => item.id === frame.message!.id)) {
            messages = [...messages, frame.message];
          }
        }
      } catch {
        // Ignore a frame this page does not render.
      }
    });
  }

  async function refreshMe(): Promise<void> {
    const res = await fetch('/me');
    if (res.status === 401) {
      status = 'join';
      return;
    }
    const data = await readJson(res);
    const body = data as { user?: { status?: string }; rooms?: GuestRoom[] };
    if (body.user?.status === 'admitted') {
      const became = status !== 'admitted';
      status = 'admitted';
      rooms = body.rooms ?? [];
      await loadMessages();
      if (became) {
        connectSocket();
      }
      return;
    }
    status = 'waiting';
    rooms = [];
    messages = [];
  }

  async function onJoin(event: Event): Promise<void> {
    event.preventDefault();
    error = '';
    const name = username.trim().toLowerCase();
    if (!token || !name) {
      error = 'Name and invite are required.';
      return;
    }
    busy = true;
    try {
      const res = await fetch('/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username: name }),
      });
      await readJson(res);
      history.replaceState(null, '', location.pathname);
      token = '';
      await refreshMe();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function onFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const active = currentRoom();
    input.value = '';
    if (!file || !active) {
      return;
    }
    error = '';
    const form = new FormData();
    form.set('room', active.slug);
    form.set('file', file);
    try {
      const res = await fetch('/files', { method: 'POST', body: form });
      const data = await readJson(res);
      const message = (data as { message?: GuestMessage }).message;
      if (message?.id && !messages.some((item) => item.id === message.id)) {
        messages = [...messages, message];
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function onSend(event: Event): Promise<void> {
    event.preventDefault();
    const content = draft.trim();
    const active = currentRoom();
    if (!content || !active) {
      return;
    }
    error = '';
    draft = '';
    try {
      const res = await fetch('/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: active.slug, content }),
      });
      const data = await readJson(res);
      const message = data as GuestMessage;
      if (message.id && !messages.some((item) => item.id === message.id)) {
        messages = [...messages, message];
      }
    } catch (err) {
      draft = content;
      error = err instanceof Error ? err.message : String(err);
    }
  }

  onMount(async () => {
    token = location.hash.replace(/^#/, '');
    try {
      const res = await fetch('/me');
      if (res.ok) {
        await refreshMe();
      }
    } catch {
      // The guest page may be closed.
    }
    poll = setInterval(() => {
      if (status === 'waiting' || status === 'admitted') {
        void refreshMe().catch(() => undefined);
      }
    }, 2000);
  });

  onDestroy(() => {
    if (poll) {
      clearInterval(poll);
    }
    socket?.close();
  });
</script>

<div class="auth-page">
  <div class="auth-card panel">
    <h1>Guest</h1>
    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if status === 'join'}
      <p class="lede">Choose a name. You will wait until the master lets you in.</p>
      <form onsubmit={onJoin}>
        <label for="guest-name">Name</label>
        <input id="guest-name" autocomplete="username" autocapitalize="none" spellcheck="false" bind:value={username} />
        <button type="submit" disabled={busy || !token}>{busy ? 'Please wait…' : 'Join'}</button>
      </form>
      {#if !token}
        <p class="lede">This page needs the invite link, opened on this host.</p>
      {/if}
    {:else if status === 'waiting'}
      <p class="lede">Waiting for the master. You are marked as a guest. Nothing from the room is visible yet.</p>
    {:else}
      <p class="lede"><span class="role-label">guest</span> {username || 'You'}</p>
      {#if rooms.length > 1}
        <label for="guest-room">Room</label>
        <select id="guest-room" bind:value={room} onchange={() => void loadMessages()}>
          {#each rooms as item (item.slug)}
            <option value={item.slug}>{item.name}</option>
          {/each}
        </select>
      {:else if rooms[0]}
        <h2>{rooms[0].name}</h2>
      {/if}
      <ul class="transcript">
        {#each messages as message (message.id)}
          <li>
            <span class="who">{message.sender}</span>
            <span>{message.content}</span>
          </li>
        {/each}
      </ul>
      <form onsubmit={onSend}>
        <label for="guest-draft">Message</label>
        <input id="guest-draft" bind:value={draft} />
        <button type="submit">Send</button>
      </form>
      <label class="file" for="guest-file">Upload</label>
      <input id="guest-file" type="file" onchange={(event) => void onFile(event)} />
    {/if}
  </div>
</div>

<style>
  .panel {
    width: min(36rem, 100%);
  }

  .transcript {
    list-style: none;
    margin: 0.75rem 0;
    padding: 0;
    max-height: 18rem;
    overflow: auto;
  }

  .transcript li {
    margin-bottom: 0.35rem;
  }

  .who {
    font-weight: 600;
    margin-right: 0.4rem;
  }

  h2 {
    margin: 0.5rem 0;
    font-size: 1rem;
  }
</style>
