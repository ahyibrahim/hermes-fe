<script lang="ts">
  import type { ConnectionStatus, MessageRecord, PublicUser, RoomRecord } from '@hermes/core';
  import { groupTranscript, parseYouTubeVideoId } from '@hermes/core';
  import { goto } from '$app/navigation';
  import { downloadAttachment, getFileIO, getSession, signOut } from '$lib/client';
  import Avatar from '$lib/components/Avatar.svelte';
  import CallOverlay from '$lib/components/CallOverlay.svelte';
  import Composer from '$lib/components/Composer.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import MemberStack from '$lib/components/MemberStack.svelte';
  import RoomMenu from '$lib/components/RoomMenu.svelte';
  import SideRailDrawer from '$lib/components/SideRailDrawer.svelte';
  import TranscriptView from '$lib/components/TranscriptView.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';
  import WatchOverlay from '$lib/components/WatchOverlay.svelte';
  import { backdrop, motionMs, prefersReducedMotion, soft, toast } from '$lib/motion';
  import {
    clearDraft,
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
  import { ScrollPin } from '$lib/chat/scroll-pin.svelte';
  import { bindSessionListeners, type WatchView } from '$lib/chat/session-listeners';
  import { TranscriptBuffer } from '$lib/chat/transcript-buffer.svelte';
  import { VoiceMesh, type VoiceState } from '$lib/voice/mesh';
  import { onMount } from 'svelte';

  let rooms = $state<RoomRecord[]>([]);
  let directory = $state<PublicUser[]>([]);
  let online = $state<string[]>([]);
  let users = $state<string[]>([]);
  let status = $state<ConnectionStatus>('idle');
  let currentRoom = $state<string | null>(null);
  let username = $state<string | null>(null);
  let banner = $state('');
  let bannerError = $state(false);
  let draft = $state('');
  let typingUsers = $state<string[]>([]);
  let typingSent = false;
  let lastTypingSentAt = 0;
  let typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let newRoomName = $state('');
  let pendingFile = $state<File | null>(null);
  let pendingFileUrl = $state<string | null>(null);
  let draggingFile = $state(false);
  let dragDepth = 0;
  let sending = $state(false);
  let creatingRoom = $state(false);
  let showCreateRoom = $state(false);
  let startingDm = $state<number | null>(null);
  let leaving = $state(false);
  let deletingRoom = $state(false);
  let kickingId = $state<number | null>(null);
  let composerComponent: Composer | undefined = $state();
  let roomsCollapsed = $state(false);
  let peopleCollapsed = $state(false);
  let phoneViewport = $state(false);
  /** Lags phoneViewport going narrow so open rails slide shut before the drawer layout applies. */
  let phoneLayout = $state(false);
  let phoneLayoutTimer: ReturnType<typeof setTimeout> | null = null;
  let addInviteeIds = $state<number[]>([]);
  let showAddPicker = $state(false);
  let showRoomMenu = $state(false);
  let showUserMenu = $state(false);
  let addingMembers = $state(false);
  let roomMenuWrap: HTMLDivElement | undefined = $state();
  let userMenuWrap: HTMLDivElement | undefined = $state();
  let notifyPerm = $state<'default' | 'granted' | 'denied' | 'unsupported'>('unsupported');
  let notifyMuted = $state(false);
  let callToast = $state<{ room: string; user: string } | null>(null);
  let sendFlash = $state(false);
  let sendFlashTimer: ReturnType<typeof setTimeout> | null = null;
  let watch = $state<WatchView | null>(null);
  let watchDenied = $state('');
  let watchDeniedTimer: ReturnType<typeof setTimeout> | undefined;
  let watchIntent = $state<'start' | 'join' | null>(null);
  let voice = $state<VoiceState>({
    room: null,
    joining: false,
    muted: false,
    peers: [],
    mics: [],
    inputDeviceId: null,
    sharing: null,
    preview: null,
    error: null,
  });
  let mesh = $state.raw<VoiceMesh | undefined>();

  const session = getSession();
  const pin = new ScrollPin(() => void markFocusedRead());
  const buffer = new TranscriptBuffer(pin);
  const unreadTotal = $derived(rooms.reduce((sum, room) => sum + (room.unread_count ?? 0), 0));
  const tabTitle = $derived(unreadTotal > 0 ? `(${unreadTotal}) Hermes` : 'Hermes');
  const me = $derived(directory.find((person) => person.username === username) ?? null);
  const groupRooms = $derived(
    [...rooms.filter((room) => !isDm(room))].sort((a, b) => {
      if (a.slug === 'general') {
        return -1;
      }
      if (b.slug === 'general') {
        return 1;
      }
      return (a.id ?? 0) - (b.id ?? 0);
    })
  );
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
  const notifyOn = $derived(!notifyMuted);
  const transcriptRows = $derived(groupTranscript(buffer.displayMessages));
  const addCandidates = $derived(
    people.filter(
      (person) =>
        person.username !== username && !(currentRoomRecord()?.members ?? []).includes(person.username)
    )
  );
  const memberNames = $derived(
    !isDm(currentRoomRecord()) ? (currentRoomRecord()?.members ?? []) : []
  );
  const roomMembers = $derived(
    memberNames.map(
      (name) => directory.find((person) => person.username === name) ?? { id: 0, username: name }
    )
  );
  const roomMenuOpen = $derived(Boolean(currentRoomRecord() && !isDm(currentRoomRecord())));
  const roomWatchActive = $derived(
    Boolean(watch && currentRoom && watch.room === currentRoom && !watch.open)
  );
  const canControlWatch = $derived(
    Boolean(
      watch &&
        username &&
        (watch.host === username || me?.role === 'admin')
    )
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
    return pin.stickToBottom;
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
    if (Notification.permission !== 'default') {
      notifyPerm = Notification.permission as 'granted' | 'denied';
      return;
    }
    notifyPerm = await Notification.requestPermission();
  }

  async function onNotifyClick(): Promise<void> {
    unlockSfx();
    notifyMuted = !notifyMuted;
    writeNotifyMuted(notifyMuted);
    if (!notifyMuted) {
      await askNotify();
    }
  }

  function notifyLabel(): string {
    return notifyOn ? 'Mute notifications and sounds' : 'Unmute notifications and sounds';
  }

  async function joinCall(room = currentRoom): Promise<void> {
    if (!room || !mesh || voice.joining) {
      return;
    }
    unlockSfx();
    await mesh.join(room);
    if (mesh.state.room === room) {
      playSfx('join');
      const sharer = mesh.state.sharing;
      if (sharer && sharer !== username) {
        playSfx('share-join');
      }
    }
  }

  function syncMetaFromSession(): void {
    const state = session.getState();
    users = [...state.roomUsers].sort((a, b) => a.localeCompare(b));
    currentRoom = state.room;
    username = state.username;
    status = session.getConnectionStatus();
  }

  function syncFromSession(): void {
    syncMetaFromSession();
    const state = session.getState();
    // Hold the outgoing transcript while a room switch is in flight (session may
    // still briefly expose empty or stale messages until history applies).
    if (buffer.pendingRoom) {
      return;
    }
    buffer.liveEnterIds.clear();
    buffer.displayMessages = [...state.messages];
  }

  function flash(message: string, isError = false): void {
    banner = message;
    bannerError = isError;
  }

  function flashWatchDenied(message: string): void {
    watchDenied = message;
    flash(message, true);
    clearTimeout(watchDeniedTimer);
    watchDeniedTimer = setTimeout(() => {
      watchDenied = '';
    }, 3200);
  }

  function applyWatchSnapshot(
    payload: {
      room: string;
      videoId: string;
      url: string;
      host: string;
      playing: boolean;
      position: number;
      rate: number;
      updatedAt: number;
      users: string[];
    },
    open?: boolean
  ): void {
    watch = {
      room: payload.room,
      videoId: payload.videoId,
      url: payload.url,
      host: payload.host,
      playing: payload.playing,
      position: payload.position,
      rate: payload.rate,
      updatedAt: payload.updatedAt,
      users: [...payload.users],
      open: open ?? watch?.open ?? false,
    };
  }

  async function openWatchOverlay(room = currentRoom): Promise<void> {
    if (!room || !watch || watch.room !== room) {
      return;
    }
    unlockSfx();
    watchIntent = 'join';
    try {
      await session.joinWatch(room);
      if (watch && watch.room === room) {
        watch = { ...watch, open: true };
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function leaveWatchSession(opts?: { end?: boolean }): Promise<void> {
    const active = watch;
    if (!active) {
      return;
    }
    const room = active.room;
    const wasOpen = active.open;
    const inSession = Boolean(username && active.users.includes(username));
    try {
      if (opts?.end) {
        session.watchControl(room, 'end');
        return;
      }
      if (inSession || wasOpen) {
        await session.leaveWatch(room);
        if (wasOpen) {
          playSfx('watch-leave');
        }
      }
      if (watch?.room === room) {
        if (inSession || wasOpen) {
          watch = {
            ...watch,
            open: false,
            users: watch.users.filter((name) => name !== username),
          };
        } else {
          // Saw the session banner but never joined — dismiss local awareness.
          watch = null;
        }
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function onWatchTogether(url: string): Promise<void> {
    if (!currentRoom) {
      flash('Join a room first.', true);
      return;
    }
    const videoId = parseYouTubeVideoId(url);
    if (!videoId) {
      flash('That is not a YouTube link.', true);
      return;
    }
    unlockSfx();
    const existing = watch && watch.room === currentRoom;
    watchIntent = existing ? 'join' : 'start';
    try {
      if (existing) {
        await session.joinWatch(currentRoom);
      } else {
        await session.startWatch(currentRoom, url);
      }
      if (!watch || watch.room !== currentRoom) {
        watch = {
          room: currentRoom,
          videoId,
          url,
          host: username ?? '',
          playing: false,
          position: 0,
          rate: 1,
          updatedAt: Date.now(),
          users: username ? [username] : [],
          open: true,
        };
      } else {
        watch = { ...watch, open: true, videoId, url };
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
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
    composerComponent?.growComposer();
  }

  function flashSendControl(): void {
    if (sendFlashTimer) {
      clearTimeout(sendFlashTimer);
    }
    sendFlash = true;
    sendFlashTimer = setTimeout(() => {
      sendFlash = false;
      sendFlashTimer = null;
    }, prefersReducedMotion() ? 120 : motionMs.base);
  }

  function stopLocalTyping(): void {
    if (typingIdleTimer) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }
    if (typingSent && currentRoom) {
      session.setTyping(currentRoom, false);
    }
    typingSent = false;
    lastTypingSentAt = 0;
  }

  function touchLocalTyping(): void {
    if (!currentRoom) {
      return;
    }
    if (!draft.trim()) {
      stopLocalTyping();
      return;
    }
    const now = Date.now();
    if (!typingSent || now - lastTypingSentAt > 2500) {
      session.setTyping(currentRoom, true);
      typingSent = true;
      lastTypingSentAt = now;
    }
    if (typingIdleTimer) {
      clearTimeout(typingIdleTimer);
    }
    typingIdleTimer = setTimeout(() => stopLocalTyping(), 2500);
  }

  function onDraftInput(): void {
    if (currentRoom) {
      saveDraft(currentRoom, draft);
    }
    growComposer();
    touchLocalTyping();
  }

  async function selectRoom(slug: string): Promise<void> {
    if (!slug) {
      return;
    }
    if (phoneViewport) {
      roomsCollapsed = true;
      peopleCollapsed = true;
    }
    banner = '';
    pin.stickToBottom = true;
    pin.showJump = false;
    if (currentRoom && currentRoom !== slug) {
      saveDraft(currentRoom, draft);
      stopLocalTyping();
      typingUsers = [];
    }
    if (slug !== currentRoom) {
      closeRoomMenu();
      closeUserMenu();
    }
    try {
      if (slug !== currentRoom) {
        const gen = ++buffer.roomSwitchGen;
        buffer.pendingRoom = slug;
        // Optimistic header/rail highlight while history loads.
        currentRoom = slug;
        await session.enterRoom(slug);
        if (gen !== buffer.roomSwitchGen) {
          return;
        }
        syncMetaFromSession();
        draft = loadDraft(slug);
        queueMicrotask(growComposer);
        if (buffer.pendingRoom === slug) {
          await buffer.commitTranscript([...session.getState().messages], slug, gen);
        }
      }
      clearUnread(slug);
      await session.markRoomRead(slug);
    } catch (error) {
      if (buffer.pendingRoom === slug) {
        buffer.pendingRoom = null;
        buffer.transcriptPhase = 'idle';
        syncFromSession();
      }
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
      const room = await session.createRoom(name);
      newRoomName = '';
      showCreateRoom = false;
      await loadRooms();
      await selectRoom(room.slug);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      creatingRoom = false;
    }
  }

  function closeAddPicker(): void {
    showAddPicker = false;
    addInviteeIds = [];
  }

  function closeRoomMenu(): void {
    showRoomMenu = false;
    closeAddPicker();
  }

  function closeUserMenu(): void {
    showUserMenu = false;
  }

  function toggleRoomMenu(): void {
    closeUserMenu();
    if (showRoomMenu) {
      closeRoomMenu();
    } else {
      showRoomMenu = true;
    }
  }

  function toggleUserMenu(): void {
    closeRoomMenu();
    showUserMenu = !showUserMenu;
  }

  function toggleAddPicker(): void {
    showAddPicker = !showAddPicker;
    if (!showAddPicker) {
      addInviteeIds = [];
    }
  }

  $effect(() => {
    if ((!showRoomMenu && !showUserMenu) || typeof document === 'undefined') {
      return;
    }
    const roomWrap = roomMenuWrap;
    const userWrap = userMenuWrap;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }
      if (showAddPicker) {
        closeAddPicker();
        return;
      }
      closeRoomMenu();
      closeUserMenu();
    }
    function onPointer(event: PointerEvent): void {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (showRoomMenu && roomWrap && !roomWrap.contains(event.target)) {
        closeRoomMenu();
      }
      if (showUserMenu && userWrap && !userWrap.contains(event.target)) {
        closeUserMenu();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });

  function toggleAddInvitee(id: number): void {
    addInviteeIds = addInviteeIds.includes(id)
      ? addInviteeIds.filter((entry) => entry !== id)
      : [...addInviteeIds, id];
  }

  function canAddMembers(room: RoomRecord | undefined): boolean {
    return Boolean(room && room.slug !== 'general' && !isDm(room) && addCandidates.length > 0);
  }

  function canLeaveRoom(room: RoomRecord | undefined): boolean {
    return Boolean(room && room.slug !== 'general' && !isDm(room));
  }

  function canModerateRoom(room: RoomRecord | undefined): boolean {
    if (!room || room.slug === 'general' || isDm(room)) {
      return false;
    }
    if (me?.role === 'admin') {
      return true;
    }
    return me != null && room.creator_id != null && room.creator_id === me.id;
  }

  async function onSignOut(): Promise<void> {
    await signOut();
    await goto('/login');
  }

  async function addToGroup(): Promise<void> {
    const slug = currentRoom;
    if (!slug || addingMembers || addInviteeIds.length === 0) {
      return;
    }
    addingMembers = true;
    try {
      await session.addRoomMembers(slug, addInviteeIds);
      closeAddPicker();
      await loadRooms();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      addingMembers = false;
    }
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
          buffer.clearDisplayTranscript();
          closeRoomMenu();
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
          buffer.clearDisplayTranscript();
          closeRoomMenu();
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
      if (!buffer.pendingRoom) {
        buffer.displayMessages = [...session.getState().messages];
      }
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

  async function setRoleFor(user: PublicUser, role: 'member' | 'admin'): Promise<void> {
    try {
      const updated = await session.setUserRole(user.username, role);
      directory = directory.map((entry) =>
        entry.id === updated.id || entry.username === updated.username ? { ...entry, ...updated } : entry
      );
      flash(`${updated.username} is now ${updated.role}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function kickFromRoom(user: PublicUser): Promise<void> {
    const slug = currentRoom;
    if (!slug || kickingId != null) {
      return;
    }
    kickingId = user.id;
    try {
      await session.kickMember(slug, user.id);
      await loadRooms();
      closeRoomMenu();
      flash(`Removed ${user.username}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      kickingId = null;
    }
  }

  async function deleteCurrentRoom(): Promise<void> {
    const slug = currentRoom;
    if (!slug || deletingRoom) {
      return;
    }
    deletingRoom = true;
    try {
      await session.deleteRoom(slug);
      const remaining = rooms.filter((room) => room.slug !== slug);
      rooms = remaining;
      if (currentRoom === slug) {
        const next = remaining.find((room) => room.slug === 'general') ?? remaining[0];
        if (next) {
          await selectRoom(next.slug);
        } else {
          currentRoom = null;
          buffer.clearDisplayTranscript();
        }
      }
      closeRoomMenu();
      flash('Room deleted.');
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      deletingRoom = false;
    }
  }

  function takePendingFile(file: File | null | undefined): void {
    if (!file) {
      return;
    }
    pendingFile = file;
  }

  $effect(() => {
    if (pendingFile && pendingFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(pendingFile);
      pendingFileUrl = url;
      return () => {
        URL.revokeObjectURL(url);
        pendingFileUrl = null;
      };
    } else {
      pendingFileUrl = null;
    }
  });

  function isFileDrag(event: DragEvent): boolean {
    if (!event.dataTransfer?.types) {
      return false;
    }
    return Array.from(event.dataTransfer.types).includes('Files');
  }

  function onChatDragEnter(event: DragEvent): void {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepth++;
    draggingFile = true;
  }

  function onChatDragOver(event: DragEvent): void {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function onChatDragLeave(event: DragEvent): void {
    if (!isFileDrag(event)) {
      return;
    }
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      draggingFile = false;
    }
  }

  function onChatDrop(event: DragEvent): void {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepth = 0;
    draggingFile = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      takePendingFile(file);
    }
  }

  const handleWatchTogether = (url: string) => {
    void onWatchTogether(url);
  };

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

    stopLocalTyping();
    sending = true;
    try {
      if (file) {
        const path = await getFileIO().ingest(file);
        await session.sendFile(path);
        pendingFile = null;
      }
      if (text) {
        await session.sendMessage(text);
        draft = '';
      }
      if (currentRoom) {
        clearDraft(currentRoom);
      }
      pin.stickToBottom = true;
      pin.showJump = false;
      growComposer();
      flashSendControl();
      unlockSfx();
      playSfx('send');
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), true);
    } finally {
      sending = false;
      composerComponent?.focus();
    }
  }

  function clearPendingFile(): void {
    pendingFile = null;
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

  pin.track(
    () => buffer.displayMessages,
    () => buffer.transcriptPhase
  );

  onMount(() => {
    const media = window.matchMedia(PHONE_MAX_WIDTH_MQ);
    phoneViewport = media.matches;
    phoneLayout = media.matches;
    applyPhoneRails(phoneViewport);
    const onPhoneChange = (): void => {
      const next = media.matches;
      if (next === phoneViewport) {
        return;
      }
      phoneViewport = next;
      if (phoneLayoutTimer) {
        clearTimeout(phoneLayoutTimer);
        phoneLayoutTimer = null;
      }
      if (!next) {
        const drawerOpen = phoneLayout && (!roomsCollapsed || !peopleCollapsed);
        if (!drawerOpen) {
          phoneLayout = false;
          applyPhoneRails(false);
          return;
        }
        // Slide the open drawer shut before the rails rejoin the grid.
        roomsCollapsed = true;
        peopleCollapsed = true;
        phoneLayoutTimer = setTimeout(
          () => {
            phoneLayoutTimer = null;
            phoneLayout = false;
            applyPhoneRails(false);
          },
          prefersReducedMotion() ? 80 : motionMs.slow
        );
        return;
      }
      const railsOpen = !roomsCollapsed || !peopleCollapsed;
      applyPhoneRails(true);
      if (!railsOpen) {
        phoneLayout = true;
        return;
      }
      phoneLayoutTimer = setTimeout(
        () => {
          phoneLayoutTimer = null;
          phoneLayout = true;
        },
        prefersReducedMotion() ? 80 : motionMs.slow
      );
    };
    media.addEventListener('change', onPhoneChange);
    const unbindSfx = bindSfxUnlock();

    notifyPerm =
      typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as 'default' | 'granted' | 'denied');
    notifyMuted = readNotifyMuted();

    const onFirstGesture = (): void => {
      unlockSfx();
      if (!notifyMuted) {
        void askNotify();
      }
    };
    document.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
    document.addEventListener('keydown', onFirstGesture, { once: true, capture: true });

    mesh = new VoiceMesh(session);
    const offVoice = mesh.subscribe((next) => {
      const previousError = voice.error;
      const prevRoom = voice.room;
      const prevSharing = voice.sharing;
      voice = next;
      if (next.error && next.error !== previousError) {
        flash(next.error, true);
      }
      // Mid-call share changes only. Hangup keeps the leave cue alone; joining a
      // call that already has a share is handled in joinCall.
      if (prevRoom && next.room && prevSharing !== next.sharing) {
        if (!prevSharing && next.sharing) {
          playSfx(next.sharing === username ? 'share-start' : 'share-join');
        } else if (prevSharing && !next.sharing) {
          playSfx(prevSharing === username ? 'share-end' : 'share-leave');
        } else if (prevSharing && next.sharing) {
          playSfx(prevSharing === username ? 'share-end' : 'share-leave');
          playSfx(next.sharing === username ? 'share-start' : 'share-join');
        }
      }
    });
    syncFromSession();
    const offs = bindSessionListeners(session, {
      pin,
      buffer,
      get rooms() {
        return rooms;
      },
      set rooms(next) {
        rooms = next;
      },
      get directory() {
        return directory;
      },
      set directory(next) {
        directory = next;
      },
      get users() {
        return users;
      },
      set users(next) {
        users = next;
      },
      get status() {
        return status;
      },
      set status(next) {
        status = next;
      },
      get currentRoom() {
        return currentRoom;
      },
      set currentRoom(next) {
        currentRoom = next;
      },
      get username() {
        return username;
      },
      get typingUsers() {
        return typingUsers;
      },
      set typingUsers(next) {
        typingUsers = next;
      },
      get callToast() {
        return callToast;
      },
      set callToast(next) {
        callToast = next;
      },
      get watch() {
        return watch;
      },
      set watch(next) {
        watch = next;
      },
      get watchIntent() {
        return watchIntent;
      },
      set watchIntent(next) {
        watchIntent = next;
      },
      syncMetaFromSession,
      clearUnread,
      shouldCountUnread,
      bumpUnread,
      isCaughtUp,
      maybeNotify,
      maybeReceiveCue,
      loadRooms,
      loadDirectory,
      selectRoom,
      closeRoomMenu,
      applyWatchSnapshot,
      flashWatchDenied,
      flash,
    });

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
      if (phoneLayoutTimer) {
        clearTimeout(phoneLayoutTimer);
      }
      unbindSfx();
      document.removeEventListener('pointerdown', onFirstGesture, { capture: true });
      document.removeEventListener('keydown', onFirstGesture, { capture: true });
      offVoice();
      void mesh?.destroy();
      mesh = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(watchDeniedTimer);
      stopLocalTyping();
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
  class:phone={phoneLayout}
>
  {#if phoneLayout && (!roomsCollapsed || !peopleCollapsed)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="rail-drawer-backdrop"
      role="presentation"
      transition:backdrop
      onclick={() => {
        roomsCollapsed = true;
        peopleCollapsed = true;
      }}
    ></div>
  {/if}
  <SideRailDrawer
    rail="rooms"
    {roomsCollapsed}
    {peopleCollapsed}
    {groupRooms}
    {dmRooms}
    {people}
    {currentRoom}
    activeDmPeer={isDm(currentRoomRecord()) ? roomTitle(currentRoomRecord()) : null}
    {username}
    {me}
    {creatingRoom}
    {showCreateRoom}
    {newRoomName}
    {leaving}
    onSetCollapsed={setCollapsed}
    onSelectRoom={selectRoom}
    onHideSlug={hideSlug}
    onCreateGroup={createGroup}
    onStartDm={startDm}
    onResetPassword={resetPasswordFor}
    onSetRole={setRoleFor}
    onNewRoomNameChange={(name) => (newRoomName = name)}
    onToggleShowCreateRoom={(show) => {
      showCreateRoom = show;
      if (!show) {
        newRoomName = '';
      }
    }}
    {lookupUser}
    {isOnline}
    {roomTitle}
    {previewLine}
  />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <section
    class="center"
    ondragenter={onChatDragEnter}
    ondragover={onChatDragOver}
    ondragleave={onChatDragLeave}
    ondrop={onChatDrop}
  >
    {#if draggingFile}
      <div class="chat-drop-overlay" transition:soft>
        <div class="chat-drop-card">
          <IconGlyph name="attach" size={28} />
          <span>Drop file to attach</span>
        </div>
      </div>
    {/if}
    <header class="top-bar">
      <div class="top-bar-lead" bind:this={roomMenuWrap}>
        {#if roomMenuOpen}
          <button
            type="button"
            class="room-lead"
            aria-expanded={showRoomMenu}
            aria-haspopup="menu"
            aria-label="{roomTitle(currentRoomRecord())}, room menu"
            onclick={toggleRoomMenu}
          >
            {#key currentRoom}
              <h2 in:soft>
                <span class="hash">#</span>{roomTitle(currentRoomRecord())}
              </h2>
            {/key}
            {#if memberNames.length > 0}
              <MemberStack names={memberNames} {directory} />
            {/if}
          </button>
          {#if showRoomMenu}
            <RoomMenu
              members={roomMembers}
              selfUsername={username}
              canAdd={canAddMembers(currentRoomRecord())}
              candidates={addCandidates}
              selectedIds={addInviteeIds}
              {isOnline}
              adding={addingMembers}
              {showAddPicker}
              canLeave={canLeaveRoom(currentRoomRecord())}
              canKick={canModerateRoom(currentRoomRecord())}
              canDelete={canModerateRoom(currentRoomRecord())}
              {leaving}
              deleting={deletingRoom}
              {kickingId}
              roomName={currentRoomRecord()?.name ?? ''}
              onToggleAdd={toggleAddPicker}
              onToggleInvitee={toggleAddInvitee}
              onConfirmAdd={() => void addToGroup()}
              onLeave={() => void leaveSlug(currentRoom as string)}
              onKick={(user) => void kickFromRoom(user)}
              onDelete={() => void deleteCurrentRoom()}
              onResetPassword={me?.role === 'admin' ? resetPasswordFor : undefined}
              onSetRole={me?.role === 'admin' ? setRoleFor : undefined}
            />
          {/if}
        {:else}
          {#key currentRoom}
            <h2 in:soft>
              {#if currentRoomRecord()}
                <span class="hash">@</span>{roomTitle(currentRoomRecord())}
              {:else}
                Hermes
              {/if}
            </h2>
          {/key}
        {/if}
      </div>
      <div class="top-bar-actions">
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
        {#if me || username}
          <div class="user-wrap" bind:this={userMenuWrap}>
            <button
              type="button"
              class="whoami-btn"
              class:unhealthy={status !== 'open'}
              class:status-ambient={status !== 'open'}
              data-status={status}
              aria-expanded={showUserMenu}
              aria-haspopup="menu"
              aria-label="Account menu"
              onclick={toggleUserMenu}
            >
              {#if me}
                <Avatar user={me} size="sm" />
              {:else}
                <span class="avatar-face placeholder sm" aria-hidden="true">{username?.slice(0, 1).toUpperCase()}</span>
              {/if}
              {#if status !== 'open'}
                <span class="whoami-cue {status}" aria-hidden="true"></span>
              {/if}
            </button>
            {#if showUserMenu}
              <UserMenu
                username={me?.username ?? username ?? ''}
                color={me?.color}
                {status}
                statusLabel={statusLabel(status)}
                {notifyOn}
                notifyLabel={notifyLabel()}
                onNotify={() => void onNotifyClick()}
                onSignOut={() => void onSignOut()}
              />
            {/if}
          </div>
        {/if}
      </div>
    </header>


    <CallOverlay
      {voice}
      {mesh}
      {currentRoom}
      {username}
      {directory}
      roomLabel={callRoomLabel()}
      showWatchBanner={Boolean(roomWatchActive && watch)}
      onSelectRoom={selectRoom}
      onOpenWatch={openWatchOverlay}
      onLeaveWatch={() => leaveWatchSession()}
      {playSfx}
    />

    <TranscriptView
      bind:scroller={pin.scroller}
      displayMessages={buffer.displayMessages}
      {transcriptRows}
      transcriptPhase={buffer.transcriptPhase}
      pendingRoom={buffer.pendingRoom}
      {banner}
      {bannerError}
      showJump={pin.showJump}
      {directory}
      {username}
      {me}
      onTranscriptScroll={pin.onTranscriptScroll}
      onJumpToLatest={pin.jumpToLatest}
      {lookupUser}
      shouldAnimateEnter={buffer.shouldAnimateEnter}
      {onDownload}
      onUnsend={unsend}
      onResetPassword={resetPasswordFor}
      onSetRole={setRoleFor}
      onWatchTogether={handleWatchTogether}
    />

    <Composer
      bind:this={composerComponent}
      bind:draft
      {currentRoom}
      {status}
      hint={composerHint()}
      {typingUsers}
      {pendingFile}
      {pendingFileUrl}
      {sending}
      {sendFlash}
      {phoneViewport}
      onSend={() => void send()}
      {onDraftInput}
      onTypingBlur={stopLocalTyping}
      onFileSelected={takePendingFile}
      onClearFile={clearPendingFile}
    />
  </section>

  <SideRailDrawer
    rail="people"
    {roomsCollapsed}
    {peopleCollapsed}
    {groupRooms}
    {dmRooms}
    {people}
    {currentRoom}
    activeDmPeer={isDm(currentRoomRecord()) ? roomTitle(currentRoomRecord()) : null}
    {username}
    {me}
    {creatingRoom}
    {showCreateRoom}
    {newRoomName}
    {leaving}
    onSetCollapsed={setCollapsed}
    onSelectRoom={selectRoom}
    onHideSlug={hideSlug}
    onCreateGroup={createGroup}
    onStartDm={startDm}
    onResetPassword={resetPasswordFor}
    onSetRole={setRoleFor}
    onNewRoomNameChange={(name) => (newRoomName = name)}
    onToggleShowCreateRoom={(show) => {
      showCreateRoom = show;
      if (!show) {
        newRoomName = '';
      }
    }}
    {lookupUser}
    {isOnline}
    {roomTitle}
    {previewLine}
  />
</div>

{#if callToast}
  {@const invite = callToast}
  {@const toastRoom = rooms.find((room) => room.slug === invite.room)}
  {@const caller = lookupUser(invite.user) ?? { id: 0, username: invite.user }}
  {@const roomLabel = isDm(toastRoom)
    ? `@${roomTitle(toastRoom)}`
    : `#${roomTitle(toastRoom) || invite.room}`}
  <div class="call-toast" transition:toast role="status" aria-live="polite">
    <span class="call-toast-pulse" aria-hidden="true"></span>
    <div class="call-toast-body">
      <Avatar user={caller} size="md" />
      <div class="call-toast-copy">
        <p class="call-toast-kicker">Incoming call</p>
        <p class="call-toast-name">{invite.user}</p>
        <p class="call-toast-room">{roomLabel}</p>
      </div>
      <div class="call-toast-actions">
        <button type="button" class="call-toast-join" onclick={() => joinToast()}>Join</button>
        <button
          type="button"
          class="call-toast-dismiss"
          title="Dismiss"
          aria-label="Dismiss"
          onclick={() => (callToast = null)}
        >
          ×
        </button>
      </div>
    </div>
  </div>
{/if}

{#if watch?.open}
  <WatchOverlay
    videoId={watch.videoId}
    host={watch.host}
    users={watch.users}
    playing={watch.playing}
    position={watch.position}
    rate={watch.rate}
    updatedAt={watch.updatedAt}
    canControl={canControlWatch}
    deniedHint={watchDenied}
    onLeave={() => void leaveWatchSession()}
    onEnd={() => void leaveWatchSession({ end: true })}
    onControl={(action, opts) => {
      if (!watch || !canControlWatch) {
        return;
      }
      session.watchControl(watch.room, action, opts);
    }}
  />
{/if}
