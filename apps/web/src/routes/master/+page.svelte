<script lang="ts">
  import type { RoomRecord } from '@hermes/core';
  import { goto } from '$app/navigation';
  import AuthBrand from '$lib/components/AuthBrand.svelte';
  import { getApiBaseUrl } from '$lib/base-url';
  import { getSession } from '$lib/client';
  import { onDestroy, onMount } from 'svelte';

  type Invite = {
    id: number;
    rooms: string[];
    maxUses: number;
    useCount: number;
    expiresAt: string;
    revoked: boolean;
  };

  type GuestRow = {
    username: string;
    displayName: string;
    status: 'waiting' | 'admitted';
    rooms: string[];
  };

  let checking = $state(true);
  let allowed = $state(false);
  let error = $state('');
  let notice = $state('');
  let open = $state(false);
  let closesAt = $state<string | null>(null);
  let openHours = $state(4);
  let port = $state(3010);
  let rooms = $state<RoomRecord[]>([]);
  let selected = $state<string[]>([]);
  let maxUses = $state(1);
  let expiresInHours = $state(24);
  let invites = $state<Invite[]>([]);
  let guests = $state<GuestRow[]>([]);
  let issuedUrl = $state('');
  let busy = $state(false);
  let confirming = $state('');
  let poll: ReturnType<typeof setInterval> | undefined;

  const session = getSession();

  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = session.getState().token;
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      throw new Error(data?.error || 'request failed');
    }
    return data as T;
  }

  async function refresh(): Promise<void> {
    const gateway = await api<{ open: boolean; port: number; closesAt: string | null }>('GET', '/gateway');
    open = gateway.open;
    closesAt = gateway.closesAt;
    port = gateway.port;
    const inviteList = await api<{ invites: Invite[] }>('GET', '/invites');
    invites = inviteList.invites;
    const guestList = await api<{ guests: GuestRow[] }>('GET', '/guests');
    guests = guestList.guests;
    rooms = (await session.listRooms()).filter((room) => room.type !== 'dm' && room.slug !== 'general');
  }

  onMount(async () => {
    if (!(await session.resume())) {
      await goto('/login');
      return;
    }
    const me = await session.getMe();
    if (me?.role !== 'master') {
      checking = false;
      allowed = false;
      return;
    }
    allowed = true;
    try {
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      checking = false;
    }
    poll = setInterval(() => {
      if (!allowed) {
        return;
      }
      void refresh().catch(() => undefined);
    }, 2000);
  });

  onDestroy(() => {
    if (poll) {
      clearInterval(poll);
    }
  });

  function toggleRoom(slug: string): void {
    selected = selected.includes(slug) ? selected.filter((item) => item !== slug) : [...selected, slug];
  }

  async function onCreate(event: Event): Promise<void> {
    event.preventDefault();
    error = '';
    notice = '';
    issuedUrl = '';
    if (selected.length === 0) {
      error = 'Choose at least one room.';
      return;
    }
    busy = true;
    try {
      const created = await api<{ token: string; joinPath: string }>('POST', '/invites', {
        rooms: selected,
        maxUses: Number(maxUses),
        expiresInHours: Number(expiresInHours),
      });
      issuedUrl = `http://127.0.0.1:${port}${created.joinPath}`;
      notice = 'Invite created. Copy this link on this host. It is shown once.';
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function closeLabel(iso: string): string {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) {
      return iso;
    }
    return when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async function setOpen(next: boolean): Promise<void> {
    error = '';
    try {
      const body = next ? { open: true, hours: Number(openHours) } : { open: false };
      const gateway = await api<{ open: boolean; port: number; closesAt: string | null }>('POST', '/gateway', body);
      open = gateway.open;
      closesAt = gateway.closesAt;
      port = gateway.port;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function revoke(id: number): Promise<void> {
    error = '';
    try {
      await api('POST', `/invites/${id}/revoke`);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function admit(username: string): Promise<void> {
    error = '';
    try {
      await api('POST', `/guests/${encodeURIComponent(username)}/admit`);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function remove(username: string): Promise<void> {
    error = '';
    confirming = '';
    try {
      await api('POST', `/guests/${encodeURIComponent(username)}/remove`);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function copyLink(): Promise<void> {
    if (!issuedUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(issuedUrl);
      notice = 'Link copied.';
    } catch {
      notice = 'Copy the link below.';
    }
  }
</script>

<div class="auth-page">
  <AuthBrand />
  <div class="auth-card panel">
    <h1>Guests</h1>
    {#if checking}
      <p class="lede">Loading…</p>
    {:else if !allowed}
      <p class="lede">Only the master can invite a guest.</p>
      <p class="alt"><a href="/">Back</a></p>
    {:else}
      {#if error}
        <p class="error">{error}</p>
      {/if}
      {#if notice}
        <p class="lede">{notice}</p>
      {/if}

      <p class="lede">The guest page listens on this host at port {port}. It is {open ? 'open' : 'closed'}.</p>
      {#if open && closesAt}
        <p class="lede">It closes {closeLabel(closesAt)}. People already inside stay until they are removed or their session ends.</p>
        <button type="button" onclick={() => void setOpen(false)}>Close guest page</button>
      {:else}
        <label for="open-hours">Hours the page stays open</label>
        <input id="open-hours" type="number" min="1" max="168" bind:value={openHours} />
        <button type="button" onclick={() => void setOpen(true)}>Open guest page</button>
      {/if}

      <form onsubmit={onCreate}>
        <h2>Invite</h2>
        {#if rooms.length === 0}
          <p class="lede">Create a group room first. Invites cannot use #general.</p>
        {:else}
          <ul class="pick">
            {#each rooms as room (room.slug)}
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(room.slug)}
                    onchange={() => toggleRoom(room.slug)}
                  />
                  {room.name}
                </label>
              </li>
            {/each}
          </ul>
        {/if}
        <label for="uses">Uses</label>
        <input id="uses" type="number" min="1" max="20" bind:value={maxUses} />
        <label for="hours">Hours until expiry</label>
        <input id="hours" type="number" min="1" max="168" bind:value={expiresInHours} />
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Create invite'}</button>
      </form>

      {#if issuedUrl}
        <p class="issued">{issuedUrl}</p>
        <button type="button" onclick={() => void copyLink()}>Copy link</button>
      {/if}

      <h2>Waiting</h2>
      {#if guests.length === 0}
        <p class="lede">No one is waiting.</p>
      {:else}
        <ul class="pick">
          {#each guests as guest (guest.username)}
            <li>
              <span>{guest.displayName}</span>
              <span class="account">{guest.username}</span>
              <span class="role-label">guest</span>
              <span>{guest.status}</span>
              {#if confirming === guest.username}
                <span>Delete {guest.displayName} and their messages?</span>
                <button type="button" onclick={() => void remove(guest.username)}>Delete</button>
                <button type="button" onclick={() => (confirming = '')}>Cancel</button>
              {:else}
                {#if guest.status === 'waiting'}
                  <button type="button" onclick={() => void admit(guest.username)}>Admit</button>
                {/if}
                <button type="button" onclick={() => (confirming = guest.username)}>Remove</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <h2>Invites</h2>
      {#if invites.length === 0}
        <p class="lede">None yet.</p>
      {:else}
        <ul class="pick">
          {#each invites as invite (invite.id)}
            <li>
              <span>{invite.useCount}/{invite.maxUses}</span>
              <span>{invite.revoked ? 'revoked' : 'active'}</span>
              {#if !invite.revoked}
                <button type="button" onclick={() => void revoke(invite.id)}>Revoke</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <p class="alt"><a href="/">Back</a></p>
    {/if}
  </div>
</div>

<style>
  .panel {
    width: min(36rem, 100%);
  }

  h2 {
    margin: 1.25rem 0 0.5rem;
    font-size: 1rem;
  }

  .pick {
    list-style: none;
    margin: 0 0 0.75rem;
    padding: 0;
  }

  .pick li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }

  .pick label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    color: var(--text);
  }

  .pick input[type='checkbox'] {
    width: auto;
    margin: 0;
    flex: 0 0 auto;
  }

  .account {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .issued {
    word-break: break-all;
    font-size: 0.85rem;
  }
</style>
