<script lang="ts">
  import type { ConnectionStatus, MessageRecord, PublicUser, RoomRecord } from '@hermes/core';
  import { groupTranscript } from '@hermes/core';
  import { downloadAttachment, getFileIO, getSession } from '$lib/client';
  import Avatar from '$lib/components/Avatar.svelte';
  import CallBar from '$lib/components/CallBar.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import MessageGroup from '$lib/components/MessageGroup.svelte';
  import UserChip from '$lib/components/UserChip.svelte';
  import {
    clearDraft,
    colorClass,
    formatUnread,
    isSystemUser,
    loadDraft,
    PHONE_MAX_WIDTH_MQ,
    RAIL_PEOPLE_KEY,
    RAIL_ROOMS_KEY,
    readCollapsed,
    readNotifyMuted,
    saveDraft,
    writeCollapsed,
    writeNotifyMuted,
  } from '$lib/ui';
  import { bindSfxUnlock, playSfx, unlockSfx } from '$lib/sfx';
  import { VoiceMesh, type VoiceState } from '$lib/voice/mesh';
  import { onMount, tick } from 'svelte';

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
  let leaving = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let scroller: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);
  let showJump = $state(false);
  let ignoreScroll = false;
  let roomsCollapsed = $state(false);
  let peopleCollapsed = $state(false);
  let phoneViewport = $state(false);
  let inviteeIds = $state<number[]>([]);
  let notifyPerm = $state<'default' | 'granted' | 'denied' | 'unsupported'>('unsupported');
  let notifyMuted = $state(false);
  let callToast = $state<{ room: string; user: string } | null>(null);
  let voice = $state<VoiceState>({
    room: null,
    joining: false,
    muted: false,
    peers: [],
    mics: [],
    inputDeviceId: null,
    error: null,
  });
  let mesh: VoiceMesh | undefined;

  const session = getSession();
  const unreadTotal = $derived(rooms.reduce((sum, room) => sum + (room.unread_count ?? 0), 0));
  const tabTitle = $derived(unreadTotal > 0 ? `(${unreadTotal}) Hermes` : 'Hermes');
  const me = $derived(directory.find((person) => person.username === username) ?? null);
  const groupRooms = $derived(rooms.filter((room) => !isDm(room)));
  const dmRooms = $derived(rooms.filter((room) => isDm(room)));
  const people = $derived(
    [...directory]
      .filter((person) => !isSystemUser(person))
      .sort((a, b) => {
        const ao = isOnline(a.username) ? 0 : 1;
        const bo = isOnline(b.username) ? 0 : 1;
        if (ao !== bo) {
          return ao - bo;
        }
        return a.username.localeCompare(b.username);
      })
  );
  const notifyOn = $derived(notifyPerm === 'granted' && !notifyMuted);
  const transcriptRows = $derived(groupTranscript(messages));
  const inviteCandidates = $derived(
    people.filter((person) => person.username !== username && person.username !== 'hermes')
  );

  function isDm(room: RoomRecord | undefined): boolean {
    if (!room) {
      return false;
    }
    return room.type === 'dm' || room.slug.startsWith('dm:');
  }

  function isOnline(name: string): boolean {
    return online.includes(name) || users.includes(name);
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

  function callRoomRecord(): RoomRecord | undefined {
    return rooms.find((room) => room.slug === voice.room);
  }

  function callRoomLabel(): string {
    const room = callRoomRecord();
    if (!room) {
      return voice.room ?? '';
    }
    return isDm(room) ? `@${roomTitle(room)}` : `#${roomTitle(room)}`;
  }

  function lookupUser(name: string): PublicUser | undefined {
    return directory.find((person) => person.username === name);
  }

  function setCollapsed(which: 'rooms' | 'people', value: boolean): void {
    if (phoneViewport) {
      if (value) {
        if (which === 'rooms') {
          roomsCollapsed = true;
        } else {
          peopleCollapsed = true;
        }
      } else if (which === 'rooms') {
        roomsCollapsed = false;
        peopleCollapsed = true;
      } else {
        peopleCollapsed = false;
        roomsCollapsed = true;
      }
      return;
    }
    if (which === 'rooms') {
      roomsCollapsed = value;
      writeCollapsed(RAIL_ROOMS_KEY, value);
    } else {
      peopleCollapsed = value;
      writeCollapsed(RAIL_PEOPLE_KEY, value);
    }
  }

  function applyPhoneRails(next: boolean): void {
    if (next) {
      roomsCollapsed = true;
      peopleCollapsed = true;
      return;
    }
    roomsCollapsed = readCollapsed(RAIL_ROOMS_KEY);
    peopleCollapsed = readCollapsed(RAIL_PEOPLE_KEY);
  }

  function isCaughtUp(slug: string | null | undefined): boolean {
    if (!slug || slug !== currentRoom) {
      return false;
    }
    if (typeof document !== 'undefined' && document.hidden) {
      return false;
    }
    return stickToBottom;
  }

  function shouldCountUnread(slug: string, message: MessageRecord): boolean {
    if (message.sender === username) {
      return false;
    }
    if (message.deleted_at) {
      return false;
    }
    return !isCaughtUp(slug);
  }

  function bumpUnread(slug: string): void {
    rooms = rooms.map((room) =>
      room.slug === slug ? { ...room, unread_count: (room.unread_count ?? 0) + 1 } : room
    );
  }

  function clearUnread(slug: string): void {
    rooms = rooms.map((room) => (room.slug === slug ? { ...room, unread_count: 0 } : room));
  }

  function shouldAlertIncoming(roomSlug: string, message: MessageRecord): boolean {
    if (!roomSlug || message.sender === username || message.deleted_at) {
      return false;
    }
    if (notifyMuted) {
      return false;
    }
    return !isCaughtUp(roomSlug);
  }

  function maybeReceiveCue(roomSlug: string, message: MessageRecord): void {
    if (shouldAlertIncoming(roomSlug, message)) {
      playSfx('receive');
    }
  }

  function maybeNotify(roomSlug: string, message: MessageRecord): void {
    if (!shouldAlertIncoming(roomSlug, message)) {
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }
    const room = rooms.find((entry) => entry.slug === roomSlug);
    const label = room ? roomTitle(room) : roomSlug;
    const body = (message.content || '').slice(0, 120);
    try {
      new Notification(`${message.sender} · ${label}`, { body, tag: `hermes:${roomSlug}` });
    } catch {
      // Some browsers still throw even after a granted check.
    }
  }

  async function askNotify(): Promise<void> {
    if (typeof Notification === 'undefined') {
      return;
    }
    notifyPerm = await Notification.requestPermission();
  }

  async function onNotifyClick(): Promise<void> {
    unlockSfx();
    if (notifyPerm === 'unsupported' || notifyPerm === 'denied') {
      return;
    }
    if (notifyPerm === 'default') {
      await askNotify();
      return;
    }
    notifyMuted = !notifyMuted;
    writeNotifyMuted(notifyMuted);
  }

  function notifyLabel(): string {
    if (notifyPerm === 'denied') {
      return 'Notifications blocked in the browser';
    }
    if (notifyPerm === 'default') {
      return 'Enable notifications';
    }
    return notifyOn ? 'Mute notifications' : 'Unmute notifications';
  }

  async function joinCall(room = currentRoom): Promise<void> {
    if (!room || !mesh || voice.joining) {
      return;
    }
    unlockSfx();
    await mesh.join(room);
    if (mesh.state.room === room) {
      playSfx('join');
    }
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

  function atBottom(): boolean {
    if (!scroller) {
      return true;
    }
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  function onTranscriptScroll(): void {
    if (!scroller || ignoreScroll) {
      return;
    }
    const wasCaughtUp = stickToBottom;
    stickToBottom = atBottom();
    showJump = !stickToBottom;
    if (!wasCaughtUp && stickToBottom) {
      void markFocusedRead();
    }
  }

  function pinToLatest(): void {
    if (!scroller || !stickToBottom) {
      return;
    }
    ignoreScroll = true;
    const apply = (): void => {
      if (scroller && stickToBottom) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    };
    apply();
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(() => {
        apply();
        ignoreScroll = false;
        showJump = false;
      });
    });
  }

  function jumpToLatest(): void {
    stickToBottom = true;
    showJump = false;
    pinToLatest();
    void markFocusedRead();
  }

  async function markFocusedRead(): Promise<void> {
    if (!currentRoom || !isCaughtUp(currentRoom)) {
      return;
    }
    try {
      await session.markRoomRead(currentRoom);
      clearUnread(currentRoom);
    } catch {
      // Unread can catch up on the next room list fetch.
    }
  }

  function growComposer(): void {
    if (!composer) {
      return;
    }
    composer.style.height = 'auto';
    const max = 8 * 16;
    composer.style.height = `${Math.min(composer.scrollHeight, max)}px`;
  }

  function onDraftInput(): void {
    if (currentRoom) {
      saveDraft(currentRoom, draft);
    }
    growComposer();
  }

  async function selectRoom(slug: string): Promise<void> {
    if (!slug) {
      return;
    }
    banner = '';
    stickToBottom = true;
    showJump = false;
    if (currentRoom && currentRoom !== slug) {
      saveDraft(currentRoom, draft);
    }
    try {
      if (slug !== currentRoom) {
        await session.enterRoom(slug);
        syncFromSession();
        draft = loadDraft(slug);
        queueMicrotask(growComposer);
      }
      clearUnread(slug);
      await session.markRoomRead(slug);
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
      const [peopleList, onlineUsers] = await Promise.all([session.listUsers(), session.listOnlineUsers()]);
      directory = peopleList;
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
      const room = await session.createRoom(name, inviteeIds);
      newRoomName = '';
      inviteeIds = [];
      await loadRooms();
      await selectRoom(room.slug);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      creatingRoom = false;
    }
  }

  function toggleInvitee(id: number): void {
    inviteeIds = inviteeIds.includes(id) ? inviteeIds.filter((entry) => entry !== id) : [...inviteeIds, id];
  }

  async function startDm(user: PublicUser): Promise<void> {
    if (user.username === username || startingDm != null || isSystemUser(user)) {
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

  async function hideSlug(slug: string): Promise<void> {
    if (!slug || slug === 'general' || leaving) {
      return;
    }
    leaving = true;
    try {
      await session.hideRoom(slug);
      const remaining = rooms.filter((room) => room.slug !== slug);
      rooms = remaining;
      if (currentRoom === slug) {
        const next = remaining.find((room) => room.slug === 'general') ?? remaining[0];
        if (next) {
          await selectRoom(next.slug);
        } else {
          currentRoom = null;
          messages = [];
        }
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      leaving = false;
    }
  }

  async function leaveSlug(slug: string): Promise<void> {
    if (!slug || slug === 'general' || leaving) {
      return;
    }
    leaving = true;
    try {
      await session.leaveRoom(slug);
      const remaining = rooms.filter((room) => room.slug !== slug);
      rooms = remaining;
      if (currentRoom === slug) {
        const next = remaining.find((room) => room.slug === 'general') ?? remaining[0];
        if (next) {
          await selectRoom(next.slug);
        } else {
          currentRoom = null;
          messages = [];
        }
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      leaving = false;
    }
  }

  function previewLine(room: RoomRecord): string {
    const last = room.last_message;
    if (!last) {
      return '';
    }
    if (last.deleted) {
      return `${last.sender}: Message deleted`;
    }
    if (last.file && !last.content) {
      return `${last.sender}: file`;
    }
    return `${last.sender}: ${last.content}`;
  }

  async function unsend(message: MessageRecord): Promise<void> {
    try {
      await session.unsendMessage(message.id);
      syncFromSession();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function resetPasswordFor(user: PublicUser): Promise<void> {
    try {
      const issued = await session.issuePasswordReset(user.username);
      const text = issued.token;
      try {
        await navigator.clipboard.writeText(text);
        flash(`Reset token copied. Valid until ${issued.expires_at}.`);
      } catch {
        window.prompt('Reset token (1 hour). Copy it now:', text);
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
  }

  function takePendingFile(file: File | null | undefined): void {
    if (!file) {
      return;
    }
    pendingFile = file;
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
      if (currentRoom) {
        clearDraft(currentRoom);
      }
      growComposer();
      unlockSfx();
      playSfx('send');
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      sending = false;
      composer?.focus();
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
    takePendingFile(input.files?.[0] ?? null);
  }

  function onComposerDrop(event: DragEvent): void {
    event.preventDefault();
    takePendingFile(event.dataTransfer?.files?.[0]);
  }

  function onComposerPaste(event: ClipboardEvent): void {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      takePendingFile(file);
    }
  }

  function clearPendingFile(): void {
    pendingFile = null;
    if (fileInput) {
      fileInput.value = '';
    }
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

  async function joinToast(): Promise<void> {
    const toast = callToast;
    callToast = null;
    if (!toast) {
      return;
    }
    await selectRoom(toast.room);
    await joinCall(toast.room);
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

  $effect(() => {
    messages;
    if (!scroller) {
      return;
    }
    if (stickToBottom) {
      void tick().then(pinToLatest);
    } else {
      showJump = true;
    }
  });

  $effect(() => {
    const root = scroller;
    if (!root) {
      return;
    }
    const inner = root.firstElementChild;
    if (!(inner instanceof HTMLElement)) {
      return;
    }
    const ro = new ResizeObserver(() => {
      if (stickToBottom) {
        pinToLatest();
      }
    });
    ro.observe(inner);
    ro.observe(root);
    return () => ro.disconnect();
  });

  onMount(() => {
    const media = window.matchMedia(PHONE_MAX_WIDTH_MQ);
    phoneViewport = media.matches;
    applyPhoneRails(phoneViewport);
    const onPhoneChange = (): void => {
      const next = media.matches;
      if (next === phoneViewport) {
        return;
      }
      phoneViewport = next;
      applyPhoneRails(next);
    };
    media.addEventListener('change', onPhoneChange);
    const unbindSfx = bindSfxUnlock();

    notifyPerm =
      typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as 'default' | 'granted' | 'denied');
    notifyMuted = readNotifyMuted();

    mesh = new VoiceMesh(session);
    const offVoice = mesh.subscribe((next) => {
      const previousError = voice.error;
      voice = next;
      if (next.error && next.error !== previousError) {
        flash(next.error, true);
      }
    });
    syncFromSession();
    const offs = [
      session.on('history', () => {
        stickToBottom = true;
        showJump = false;
        syncFromSession();
        if (currentRoom) {
          clearUnread(currentRoom);
        }
      }),
      session.on('message', (message) => {
        syncFromSession();
        if (message.room) {
          if (shouldCountUnread(message.room, message)) {
            bumpUnread(message.room);
          } else if (isCaughtUp(message.room)) {
            void session.markRoomRead(message.room);
          }
        }
        if (message.room) {
          rooms = rooms.map((entry) =>
            entry.slug === message.room
              ? {
                  ...entry,
                  last_message: {
                    id: message.id,
                    sender: message.sender,
                    content: message.content.slice(0, 80),
                    deleted: false,
                    file: message.file_id != null && message.file_id !== '',
                  },
                }
              : entry
          );
        }
        maybeNotify(message.room, message);
        maybeReceiveCue(message.room, message);
      }),
      session.on('roomActivity', ({ room, message }) => {
        if (message.deleted_at) {
          rooms = rooms.map((entry) =>
            entry.slug === room
              ? {
                  ...entry,
                  last_message: {
                    id: message.id,
                    sender: message.sender,
                    content: '',
                    deleted: true,
                    file: false,
                  },
                }
              : entry
          );
          return;
        }
        if (!rooms.some((entry) => entry.slug === room)) {
          void loadRooms();
        } else {
          if (shouldCountUnread(room, message)) {
            bumpUnread(room);
          }
          rooms = rooms.map((entry) =>
            entry.slug === room
              ? {
                  ...entry,
                  last_message: {
                    id: message.id,
                    sender: message.sender,
                    content: message.content.slice(0, 80),
                    deleted: false,
                    file: message.file_id != null && message.file_id !== '',
                  },
                }
              : entry
          );
        }
        maybeNotify(room, message);
        maybeReceiveCue(room, message);
      }),
      session.on('messageDeleted', () => {
        syncFromSession();
      }),
      session.on('userUpdated', (user) => {
        directory = directory.map((entry) =>
          entry.id === user.id || entry.username === user.username ? { ...entry, ...user } : entry
        );
      }),
      session.on('callStarted', ({ room, user }) => {
        if (user === session.getState().username) {
          return;
        }
        if (room === session.getState().room) {
          return;
        }
        callToast = { room, user };
      }),
      session.on('presence', () => {
        const state = session.getState();
        users = [...state.roomUsers].sort((a, b) => a.localeCompare(b));
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

    const onVisibility = () => {
      if (!document.hidden) {
        void markFocusedRead();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

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
      media.removeEventListener('change', onPhoneChange);
      unbindSfx();
      offVoice();
      void mesh?.destroy();
      mesh = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
      for (const off of offs) {
        off();
      }
    };
  });
</script>

<svelte:head>
  <title>{tabTitle}</title>
</svelte:head>

<div
  class="shell"
  class:rooms-collapsed={roomsCollapsed}
  class:people-collapsed={peopleCollapsed}
>
  <aside class="rail rooms-rail">
    <div class="rail-heading">
      <button
        type="button"
        class="rail-toggle"
        aria-expanded={!roomsCollapsed}
        onclick={() => setCollapsed('rooms', !roomsCollapsed)}
      >
        {roomsCollapsed ? '›' : '‹'}
      </button>
      {#if !roomsCollapsed}
        <span>rooms</span>
      {/if}
    </div>
    {#if !roomsCollapsed}
      <div class="rail-heading sub">Rooms</div>
      {#if groupRooms.length === 0}
        <p class="empty-hint">No rooms yet.</p>
      {:else}
        <ul class="room-list">
          {#each groupRooms as room (room.id)}
            <li>
              <button
                type="button"
                class:active={room.slug === currentRoom}
                onclick={() => selectRoom(room.slug)}
              >
                <span class="room-copy">
                  <span class="room-label"><span class="hash">#</span>{roomTitle(room)}</span>
                  {#if previewLine(room)}
                    <span class="room-preview">{previewLine(room)}</span>
                  {/if}
                </span>
                {#if formatUnread(room.unread_count)}
                  <span class="unread">{formatUnread(room.unread_count)}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="rail-heading sub">Direct messages</div>
      {#if dmRooms.length === 0}
        <p class="empty-hint">No DMs yet.</p>
      {:else}
        <ul class="room-list">
          {#each dmRooms as room (room.id)}
            {@const peer = lookupUser(roomTitle(room))}
            <li class="dm-row">
              <button
                type="button"
                class:active={room.slug === currentRoom}
                onclick={() => selectRoom(room.slug)}
              >
                {#if peer}
                  <Avatar user={peer} size="sm" />
                {/if}
                <span class="room-copy">
                  <span class="room-label"><span class="hash">@</span>{roomTitle(room)}</span>
                  {#if previewLine(room)}
                    <span class="room-preview">{previewLine(room)}</span>
                  {/if}
                </span>
                {#if formatUnread(room.unread_count)}
                  <span class="unread">{formatUnread(room.unread_count)}</span>
                {/if}
              </button>
              <button
                type="button"
                class="row-x"
                title="Close DM"
                disabled={leaving}
                onclick={() => hideSlug(room.slug)}
              >
                ×
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
        <div class="new-room-row">
          <input
            type="text"
            placeholder="New room"
            bind:value={newRoomName}
            disabled={creatingRoom}
            maxlength="80"
          />
          <IconButton
            type="submit"
            label="Create room"
            tone="accent"
            disabled={creatingRoom || !newRoomName.trim()}
            busy={creatingRoom}
          >
            <IconGlyph name="plus" />
          </IconButton>
        </div>
        {#if inviteCandidates.length > 0}
          <div class="invite-picker">
            <div class="invite-picker-label">Invite</div>
            {#each inviteCandidates as person (person.id)}
              <label>
                <input
                  type="checkbox"
                  checked={inviteeIds.includes(person.id)}
                  disabled={creatingRoom}
                  onchange={() => toggleInvitee(person.id)}
                />
                <span class={colorClass(person.color)}>{person.username}</span>
              </label>
            {/each}
          </div>
        {/if}
      </form>
    {/if}
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
      {#if currentRoom && currentRoom !== 'general' && !isDm(currentRoomRecord())}
        <button type="button" class="leave-room" disabled={leaving} onclick={() => leaveSlug(currentRoom as string)}>
          Leave
        </button>
      {/if}
      {#if currentRoom && !voice.room}
        <IconButton
          label="Join call"
          disabled={voice.joining || status !== 'open'}
          busy={voice.joining}
          onclick={() => joinCall()}
        >
          <IconGlyph name="call" />
        </IconButton>
      {/if}
      {#if notifyPerm !== 'unsupported'}
        <IconButton
          label={notifyLabel()}
          title={notifyLabel()}
          pressed={notifyOn}
          disabled={notifyPerm === 'denied'}
          onclick={() => onNotifyClick()}
        >
          <IconGlyph name={notifyOn ? 'bell' : 'bell-off'} />
        </IconButton>
      {/if}
      <span class="status {status}">
        <span class="status-dot"></span>
        {statusLabel(status)}
      </span>
      {#if me}
        <a class="whoami" href="/profile">
          <Avatar user={me} size="sm" />
          <span class={colorClass(me.color)}>{me.username}</span>
        </a>
      {:else if username}
        <a class="whoami" href="/profile">{username}</a>
      {/if}
    </header>

    {#if voice.room}
      <CallBar
        roomLabel={callRoomLabel()}
        viewingCallRoom={voice.room === currentRoom}
        muted={voice.muted}
        joining={voice.joining}
        peers={voice.peers}
        directory={directory}
        mics={voice.mics}
        inputDeviceId={voice.inputDeviceId}
        error={voice.error}
        onMute={(muted) => {
          mesh?.setMuted(muted);
          playSfx(muted ? 'mute' : 'unmute');
        }}
        onLeave={() => {
          void mesh?.leave();
          playSfx('leave');
        }}
        onPickMic={(deviceId) => mesh?.setInputDevice(deviceId)}
        onShowRoom={() => {
          if (voice.room) {
            void selectRoom(voice.room);
          }
        }}
      />
    {/if}

    <div class="messages" bind:this={scroller} onscroll={onTranscriptScroll}>
      <div class="messages-body">
        {#if banner}
          <p class="banner" class:error={bannerError}>{banner}</p>
        {/if}
        {#if messages.length === 0}
          <p class="empty-hint">No messages yet.</p>
        {:else}
          {#each transcriptRows as row (row.key)}
            {#if row.kind === 'date'}
              <div class="date-sep">{row.label}</div>
            {:else}
              <MessageGroup
                messages={row.group.messages}
                sender={row.group.messages[0] ? lookupUser(row.group.messages[0].sender) : undefined}
                users={directory}
                showName={row.group.showName}
                ownName={username}
                {onDownload}
                onUnsend={unsend}
                onResetPassword={me?.role === 'admin' ? resetPasswordFor : undefined}
              />
            {/if}
          {/each}
        {/if}
      </div>
    </div>

    {#if showJump}
      <div class="jump-latest">
        <IconButton label="Jump to latest" onclick={jumpToLatest}>
          <IconGlyph name="jump" />
        </IconButton>
      </div>
    {/if}

    <form
      class="composer"
      onsubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      ondragover={(event) => event.preventDefault()}
      ondrop={onComposerDrop}
    >
      <input type="file" hidden bind:this={fileInput} onchange={onFilePicked} />
      <IconButton
        label="Attach file"
        disabled={sending || !currentRoom}
        onclick={() => fileInput?.click()}
      >
        <IconGlyph name="attach" />
      </IconButton>
      <textarea
        rows="1"
        placeholder={composerHint()}
        bind:this={composer}
        bind:value={draft}
        disabled={!currentRoom}
        oninput={onDraftInput}
        onkeydown={onComposerKey}
        onpaste={onComposerPaste}
      ></textarea>
      <IconButton
        type="submit"
        label="Send"
        tone="accent"
        disabled={sending || !currentRoom || (!draft.trim() && !pendingFile)}
      >
        <IconGlyph name="send" />
      </IconButton>
      {#if pendingFile}
        <span class="attach-chip">
          {pendingFile.name}
          <button type="button" class="row-x" onclick={clearPendingFile} title="Remove file">×</button>
        </span>
      {/if}
    </form>
  </section>

  <aside class="rail people">
    <div class="rail-heading">
      {#if !peopleCollapsed}
        <span>people</span>
      {/if}
      <button
        type="button"
        class="rail-toggle"
        aria-expanded={!peopleCollapsed}
        onclick={() => setCollapsed('people', !peopleCollapsed)}
      >
        {peopleCollapsed ? '‹' : '›'}
      </button>
    </div>
    {#if !peopleCollapsed}
      {#if people.length === 0}
        <p class="empty-hint">Nobody here yet.</p>
      {:else}
        <ul class="people-list">
          {#each people as person (person.id)}
            <li>
              {#if person.username === username}
                <span class="self">
                  <span class="status-dot" class:open={isOnline(person.username)}></span>
                  <UserChip user={person} />
                  <span class="role-label">{person.role ?? 'member'}</span>
                  <span class="you">you</span>
                </span>
              {:else}
                <div class="person-row">
                  <button
                    type="button"
                    class="person-open"
                    class:active={currentRoomRecord() &&
                      isDm(currentRoomRecord()) &&
                      roomTitle(currentRoomRecord()) === person.username}
                    disabled={startingDm != null}
                    onclick={() => startDm(person)}
                  >
                    <span class="status-dot" class:open={isOnline(person.username)}></span>
                    <UserChip user={person} />
                    <span class="role-label">{person.role ?? 'member'}</span>
                  </button>
                  {#if me?.role === 'admin' && !isSystemUser(person)}
                    <IconButton
                      label="Reset password for {person.username}"
                      title="Reset password"
                      onclick={() => resetPasswordFor(person)}
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <circle cx="6" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5" />
                        <path
                          d="M8.2 8h5.3M11.2 8v2.2M13.5 8v1.4"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                        />
                      </svg>
                    </IconButton>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </aside>
</div>

{#if callToast}
  <div class="call-toast">
    <p>
      {callToast.user} started a call in
      {#if isDm(rooms.find((room) => room.slug === callToast?.room))}
        @{roomTitle(rooms.find((room) => room.slug === callToast?.room))}
      {:else}
        #{roomTitle(rooms.find((room) => room.slug === callToast?.room)) || callToast.room}
      {/if}
    </p>
    <div class="call-toast-actions">
      <button type="button" onclick={() => joinToast()}>Join</button>
      <button type="button" class="secondary" onclick={() => (callToast = null)}>Dismiss</button>
    </div>
  </div>
{/if}
