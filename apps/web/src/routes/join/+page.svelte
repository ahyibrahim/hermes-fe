<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AuthBrand from '$lib/components/AuthBrand.svelte';
  import { ADDRESS_WARNING } from '$lib/voice/address-warning';
  import { GuestVoiceLink } from '$lib/voice/guest-link';
  import { VoiceMesh } from '$lib/voice/mesh';

  type GuestMessage = {
    id: number;
    sender: string;
    sender_name?: string;
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
  let account = $state('');
  let displayName = $state('');
  let error = $state('');
  let busy = $state(false);
  let status = $state<'join' | 'waiting' | 'admitted'>('join');
  let rooms = $state<GuestRoom[]>([]);
  let room = $state('');
  let messages = $state<GuestMessage[]>([]);
  let draft = $state('');
  let poll: ReturnType<typeof setInterval> | undefined;
  let socket: WebSocket | undefined;
  let link: GuestVoiceLink | undefined;
  let mesh: VoiceMesh | undefined;
  let inCall = $state(false);
  let addressPrompt = $state(false);
  let addressResolve: ((ok: boolean) => void) | null = null;

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
    const previous = socket;
    socket = undefined;
    previous?.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const next = new WebSocket(`${proto}//${location.host}/ws`);
    socket = next;
    link?.attach(next);
    next.addEventListener('open', () => {
      const active = currentRoom();
      if (active) {
        next.send(JSON.stringify({ type: 'join_room', room: active.slug }));
      }
    });
    next.addEventListener('close', () => {
      if (socket !== next || status !== 'admitted') {
        return;
      }
      window.setTimeout(() => {
        if (socket === next && status === 'admitted') {
          connectSocket();
        }
      }, 1000);
    });
    next.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as {
          type?: string;
          message?: GuestMessage & { room?: string };
        };
        if (frame.type === 'message' && frame.message && frame.message.room === room) {
          void loadMessages().catch(() => undefined);
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
      await leaveCall();
      return;
    }
    const data = await readJson(res);
    const body = data as { user?: { status?: string; displayName?: string; username?: string }; rooms?: GuestRoom[] };
    if (body.user?.username) {
      account = body.user.username;
    }
    if (body.user?.displayName) {
      displayName = body.user.displayName;
    }
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
    await leaveCall();
  }

  function askAddress(): Promise<boolean> {
    return new Promise((resolve) => {
      addressResolve = resolve;
      addressPrompt = true;
    });
  }

  function answerAddress(ok: boolean): void {
    addressPrompt = false;
    const resolve = addressResolve;
    addressResolve = null;
    resolve?.(ok);
  }

  async function leaveCall(): Promise<void> {
    const current = mesh;
    mesh = undefined;
    inCall = false;
    if (current) {
      await current.leave();
    }
  }

  async function joinCall(): Promise<void> {
    const active = currentRoom();
    if (!active || !socket || !account || mesh || addressPrompt) {
      return;
    }
    error = '';
    const ok = await askAddress();
    if (!ok || !socket) {
      return;
    }
    link = new GuestVoiceLink(() => socket, account);
    link.attach(socket);
    const next = new VoiceMesh(link, { confirmAddresses: () => askAddress() });
    mesh = next;
    await next.join(active.slug, { addressesReleased: true });
    inCall = next.state.room === active.slug;
    if (!inCall) {
      error = next.state.error ?? 'Could not join the call.';
      mesh = undefined;
    }
  }

  async function onRoomChange(): Promise<void> {
    await leaveCall();
    await loadMessages();
    const active = currentRoom();
    if (active && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'join_room', room: active.slug }));
    }
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
      await readJson(res);
      await loadMessages();
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
      await readJson(res);
      await loadMessages();
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
    void leaveCall();
    socket?.close();
  });
</script>

<div class="auth-page">
  <AuthBrand />
  <div class="auth-card panel">
    <h1>Guest</h1>
    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if status === 'join'}
      <p class="lede">Choose the name people will see. You will wait until the master lets you in.</p>
      <form onsubmit={onJoin}>
        <label for="guest-name">Name</label>
        <input id="guest-name" autocomplete="username" autocapitalize="none" spellcheck="false" bind:value={username} />
        <button type="submit" disabled={busy || !token}>{busy ? 'Please wait…' : 'Join'}</button>
      </form>
      {#if !token}
        <p class="lede">This page needs the invite link, opened on this host.</p>
      {/if}
    {:else if status === 'waiting'}
      <p class="lede">Waiting for the master. You will appear as {displayName || username}. Nothing from the room is visible yet.</p>
    {:else}
      <p class="lede"><span class="role-label">guest</span> {displayName || username || 'You'}</p>
      {#if rooms.length > 1}
        <label for="guest-room">Room</label>
        <select id="guest-room" bind:value={room} onchange={() => void onRoomChange()}>
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
            <span class="who">{message.sender_name || message.sender}</span>
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
      {#if inCall}
        <p class="lede">In the call.</p>
        <button type="button" onclick={() => void leaveCall()}>Leave call</button>
      {:else}
        <button type="button" onclick={() => void joinCall()}>Join call</button>
      {/if}
      {#if addressPrompt}
        <div class="address-warning" role="dialog" aria-modal="true">
          <p>{ADDRESS_WARNING}</p>
          <button type="button" onclick={() => answerAddress(true)}>Join call</button>
          <button type="button" onclick={() => answerAddress(false)}>Stay out</button>
        </div>
      {/if}
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

  .address-warning {
    margin-top: 0.75rem;
  }

  .address-warning p {
    margin: 0 0 0.5rem;
  }
</style>
