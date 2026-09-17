<script lang="ts">
  import type { ConnectionStatus, MessageRecord, PublicUser, RoomRecord } from '@hermes/core';
  import { groupTranscript, parseYouTubeVideoId } from '@hermes/core';
  import { goto } from '$app/navigation';
  import { downloadAttachment, getFileIO, getSession, signOut } from '$lib/client';
  import Avatar from '$lib/components/Avatar.svelte';
  import CallBar from '$lib/components/CallBar.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import MemberStack from '$lib/components/MemberStack.svelte';
  import MessageGroup from '$lib/components/MessageGroup.svelte';
  import RoomMenu from '$lib/components/RoomMenu.svelte';
  import UserChip from '$lib/components/UserChip.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';
  import WatchOverlay from '$lib/components/WatchOverlay.svelte';
  import { motionMs, prefersReducedMotion, soft, toast } from '$lib/motion';
  import {
    clearDraft,
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

  type TranscriptPhase = 'idle' | 'leaving' | 'entering';

  let rooms = $state<RoomRecord[]>([]);
  let directory = $state<PublicUser[]>([]);
  let online = $state<string[]>([]);
  /** Rendered transcript buffer — held across room switches until history is ready. */
  let displayMessages = $state<MessageRecord[]>([]);
  let transcriptPhase = $state<TranscriptPhase>('idle');
  let pendingRoom = $state<string | null>(null);
  let roomSwitchGen = 0;
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
  let sending = $state(false);
  let creatingRoom = $state(false);
  let showCreateRoom = $state(false);
  let startingDm = $state<number | null>(null);
  let leaving = $state(false);
  let deletingRoom = $state(false);
  let kickingId = $state<number | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let scroller: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);
  let showJump = $state(false);
  let ignoreScroll = false;
  let pinScrollTimer: ReturnType<typeof setTimeout> | null = null;
  /** IDs allowed to play enter motion — live appends only, never room-history remounts. */
  const liveEnterIds = new Set<number>();
  let roomsCollapsed = $state(false);
  let peopleCollapsed = $state(false);
  let phoneViewport = $state(false);
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
  let watch = $state<{
    room: string;
    videoId: string;
    url: string;
    host: string;
    playing: boolean;
    position: number;
    rate: number;
    updatedAt: number;
    users: string[];
    open: boolean;
  } | null>(null);
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
  let mesh: VoiceMesh | undefined;

  const session = getSession();
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
  const transcriptRows = $derived(groupTranscript(displayMessages));
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
    if (pendingRoom) {
      return;
    }
    liveEnterIds.clear();
    displayMessages = [...state.messages];
  }

  function clearDisplayTranscript(): void {
    pendingRoom = null;
    transcriptPhase = 'idle';
    liveEnterIds.clear();
    displayMessages = [];
  }

  function markLiveEnter(id: number): void {
    liveEnterIds.add(id);
  }

  function pruneLiveEnterIds(messages: MessageRecord[]): void {
    const keep = new Set(messages.map((message) => message.id));
    for (const id of liveEnterIds) {
      if (!keep.has(id)) {
        liveEnterIds.delete(id);
      }
    }
  }

  function shouldAnimateEnter(id: number): boolean {
    return liveEnterIds.has(id);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function commitTranscript(next: MessageRecord[], room: string, gen: number): Promise<void> {
    const reduced = prefersReducedMotion();
    const outMs = reduced ? 80 : motionMs.fast;
    const inMs = reduced ? 80 : motionMs.base;

    if (displayMessages.length > 0) {
      transcriptPhase = 'leaving';
      await sleep(outMs);
    }
    if (gen !== roomSwitchGen || (pendingRoom && pendingRoom !== room)) {
      return;
    }

    displayMessages = next;
    pendingRoom = null;
    stickToBottom = true;
    showJump = false;
    liveEnterIds.clear();
    transcriptPhase = 'entering';
    await tick();
    pinToLatest('auto');
    await sleep(inMs);
    if (gen === roomSwitchGen && transcriptPhase === 'entering') {
      transcriptPhase = 'idle';
    }
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

  function pinToLatest(behavior: ScrollBehavior = 'auto'): void {
    if (!scroller || !stickToBottom) {
      return;
    }
    ignoreScroll = true;
    if (pinScrollTimer) {
      clearTimeout(pinScrollTimer);
      pinScrollTimer = null;
    }

    const finish = (): void => {
      ignoreScroll = false;
      showJump = false;
      pinScrollTimer = null;
    };

    const useSmooth = behavior === 'smooth' && !prefersReducedMotion();
    if (useSmooth) {
      const apply = (): void => {
        if (scroller && stickToBottom) {
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        }
      };
      apply();
      requestAnimationFrame(apply);
      pinScrollTimer = setTimeout(finish, motionMs.slow + 80);
      return;
    }

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
        finish();
      });
    });
  }

  function jumpToLatest(): void {
    stickToBottom = true;
    showJump = false;
    pinToLatest('smooth');
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
    banner = '';
    stickToBottom = true;
    showJump = false;
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
        const gen = ++roomSwitchGen;
        pendingRoom = slug;
        // Optimistic header/rail highlight while history loads.
        currentRoom = slug;
        await session.enterRoom(slug);
        if (gen !== roomSwitchGen) {
          return;
        }
        syncMetaFromSession();
        draft = loadDraft(slug);
        queueMicrotask(growComposer);
        if (pendingRoom === slug) {
          await commitTranscript([...session.getState().messages], slug, gen);
        }
      }
      clearUnread(slug);
      await session.markRoomRead(slug);
    } catch (error) {
      if (pendingRoom === slug) {
        pendingRoom = null;
        transcriptPhase = 'idle';
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
          clearDisplayTranscript();
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
          clearDisplayTranscript();
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
      if (!pendingRoom) {
        displayMessages = [...session.getState().messages];
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
          clearDisplayTranscript();
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
      stickToBottom = true;
      showJump = false;
      growComposer();
      flashSendControl();
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
    if (event.key === 'Enter' && !event.shiftKey && !phoneViewport) {
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
    displayMessages;
    if (!scroller) {
      return;
    }
    if (stickToBottom) {
      const behavior: ScrollBehavior =
        transcriptPhase === 'idle' ? 'smooth' : 'auto';
      void tick().then(() => pinToLatest(behavior));
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
        pinToLatest('auto');
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
    const offs = [
      session.on('history', () => {
        stickToBottom = true;
        showJump = false;
        syncMetaFromSession();
        // selectRoom owns the dual-buffer commit while a switch is pending.
        if (!pendingRoom) {
          liveEnterIds.clear();
          displayMessages = [...session.getState().messages];
        }
        if (currentRoom) {
          clearUnread(currentRoom);
        }
      }),
      session.on('message', (message) => {
        syncMetaFromSession();
        if (!pendingRoom) {
          markLiveEnter(message.id);
          displayMessages = [...session.getState().messages];
          pruneLiveEnterIds(displayMessages);
        }
        if (message.sender && (!message.room || message.room === currentRoom)) {
          typingUsers = typingUsers.filter((name) => name !== message.sender);
        }
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
        if (!pendingRoom) {
          displayMessages = [...session.getState().messages];
        }
      }),
      session.on('userUpdated', (user) => {
        directory = directory.map((entry) =>
          entry.id === user.id || entry.username === user.username ? { ...entry, ...user } : entry
        );
      }),
      session.on('memberAdded', () => {
        void loadRooms();
      }),
      session.on('memberRemoved', async ({ room, users: removed }) => {
        const meName = session.getState().username;
        const wasKicked = Boolean(meName && removed.includes(meName));
        await loadRooms();
        if (wasKicked && currentRoom === room) {
          const next = rooms.find((entry) => entry.slug === 'general') ?? rooms[0];
          if (next) {
            await selectRoom(next.slug);
          } else {
            currentRoom = null;
            clearDisplayTranscript();
          }
          closeRoomMenu();
        }
      }),
      session.on('roomDeleted', ({ room }) => {
        rooms = rooms.filter((entry) => entry.slug !== room);
        if (currentRoom === room) {
          const next = rooms.find((entry) => entry.slug === 'general') ?? rooms[0];
          if (next) {
            void selectRoom(next.slug);
          } else {
            currentRoom = null;
            clearDisplayTranscript();
          }
          closeRoomMenu();
        }
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
      session.on('watchStarted', (payload) => {
        const meName = session.getState().username;
        const viewing = payload.room === session.getState().room;
        const wasOpen = watch?.open && watch.room === payload.room;
        applyWatchSnapshot(payload, wasOpen || watchIntent !== null);
        if (watchIntent === 'start' && payload.host === meName) {
          playSfx('watch-start');
        } else if (viewing || watchIntent === 'join') {
          // Someone else started while you view the room, or you joined via start-as-join.
          if (payload.host !== meName || watchIntent === 'join') {
            playSfx('watch-join');
          }
        }
        if (watchIntent) {
          watch = watch ? { ...watch, open: true } : watch;
          watchIntent = null;
        }
      }),
      session.on('watchState', (payload) => {
        const meName = session.getState().username;
        const wasOpen = watch?.open && watch.room === payload.room;
        const intent = watchIntent;
        const joining = intent === 'join' || intent === 'start';
        applyWatchSnapshot(payload, wasOpen || joining);
        if (intent === 'start' && payload.host === meName) {
          playSfx('watch-start');
          watchIntent = null;
          if (watch) {
            watch = { ...watch, open: true };
          }
        } else if (joining) {
          // Explicit join, or start-as-join when a session already existed.
          playSfx('watch-join');
          watchIntent = null;
          if (watch) {
            watch = { ...watch, open: true };
          }
        }
      }),
      session.on('watchPeers', ({ room, users: peerUsers, host }) => {
        if (!watch || watch.room !== room) {
          return;
        }
        watch = { ...watch, users: [...peerUsers], host };
      }),
      session.on('watchEnded', ({ room, user: endedBy }) => {
        const active = watch;
        if (!active || active.room !== room) {
          return;
        }
        const wasIn = active.open || active.users.includes(username ?? '');
        if (wasIn) {
          playSfx('watch-end');
        }
        void endedBy;
        watch = null;
        watchIntent = null;
      }),
      session.on('watchControlDenied', ({ action, reason }) => {
        flashWatchDenied(reason ? `${action}: ${reason}` : `Cannot ${action}`);
      }),
      session.on('leftWatch', ({ room }) => {
        if (watch?.room === room) {
          watch = { ...watch, open: false };
        }
        watchIntent = null;
      }),
      session.on('presence', () => {
        const state = session.getState();
        users = [...state.roomUsers].sort((a, b) => a.localeCompare(b));
        void loadDirectory();
      }),
      session.on('typing', ({ room, user, active }) => {
        if (room !== currentRoom || user === username) {
          return;
        }
        if (active) {
          if (!typingUsers.includes(user)) {
            typingUsers = [...typingUsers, user].sort((a, b) => a.localeCompare(b));
          }
        } else {
          typingUsers = typingUsers.filter((name) => name !== user);
        }
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
>
  <aside class="rail rooms-rail">
    <div class="rail-heading">
      <button
        type="button"
        class="rail-toggle"
        aria-label={roomsCollapsed ? 'Expand rooms' : 'Collapse rooms'}
        aria-expanded={!roomsCollapsed}
        onclick={() => setCollapsed('rooms', !roomsCollapsed)}
      >
        <IconGlyph name={roomsCollapsed ? 'chevron-right' : 'chevron-left'} />
      </button>
      {#if !roomsCollapsed}
        <span transition:soft>rooms</span>
      {/if}
    </div>
    {#if !roomsCollapsed}
      <div class="rail-body" transition:soft>
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
                  <Avatar user={peer} size="sm" online={isOnline(peer.username)} />
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
                aria-label="Close DM"
                disabled={leaving}
                onclick={() => hideSlug(room.slug)}
              >
                <IconGlyph name="close" size={12} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if showCreateRoom}
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
              aria-label="Room name"
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
            <IconButton
              label="Cancel"
              disabled={creatingRoom}
              onclick={() => {
                showCreateRoom = false;
                newRoomName = '';
              }}
            >
              <IconGlyph name="close" />
            </IconButton>
          </div>
        </form>
      {:else}
        <button type="button" class="new-room-open" onclick={() => (showCreateRoom = true)}>
          <IconGlyph name="plus" />
          New room
        </button>
      {/if}
      </div>
    {/if}
  </aside>

  <section class="center">
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
        sharing={voice.sharing}
        preview={voice.preview}
        selfName={username}
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
        onShare={() => {
          void mesh?.startShare();
        }}
        onStopShare={() => {
          void mesh?.stopShare();
        }}
      />
    {/if}

    {#if roomWatchActive && watch}
      <div class="watch-banner">
        <span>Watching together</span>
        <span class="watch-banner-actions">
          <IconButton label="Open watch" title="Open watch" onclick={() => void openWatchOverlay()}>
            <IconGlyph name="watch" size={14} />
          </IconButton>
          <IconButton label="Leave watch" title="Leave watch" onclick={() => void leaveWatchSession()}>
            <IconGlyph name="leave" size={14} />
          </IconButton>
        </span>
      </div>
    {/if}

    <div class="messages" bind:this={scroller} onscroll={onTranscriptScroll}>
      <div
        class="messages-body"
        class:scene-leaving={transcriptPhase === 'leaving'}
        class:scene-entering={transcriptPhase === 'entering'}
      >
        {#if banner}
          <p class="banner" class:error={bannerError}>{banner}</p>
        {/if}
        {#if displayMessages.length === 0 && transcriptPhase === 'idle' && !pendingRoom}
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
                isAdmin={me?.role === 'admin'}
                {shouldAnimateEnter}
                {onDownload}
                onUnsend={unsend}
                onResetPassword={me?.role === 'admin' ? resetPasswordFor : undefined}
                onSetRole={me?.role === 'admin' ? setRoleFor : undefined}
                onWatchTogether={(url) => void onWatchTogether(url)}
              />
            {/if}
          {/each}
        {/if}
      </div>
    </div>

    {#if showJump}
      <div class="jump-latest" transition:soft>
        <IconButton label="Jump to latest" onclick={jumpToLatest}>
          <IconGlyph name="jump" />
        </IconButton>
      </div>
    {/if}

    <div class="composer-presence" class:active={typingUsers.length > 0} aria-live="polite">
      {#if typingUsers.length > 0}
        <div class="typing-indicator" transition:soft>
          <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>{typingLabel(typingUsers)}</span>
        </div>
      {/if}
    </div>

    <form
      class="composer"
      class:conn-soft={status !== 'open'}
      data-status={status}
      onsubmit={(event) => {
        event.preventDefault();
        void send();
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
        {#if pendingFile}
          <span class="attach-chip">
            <span class="attach-chip-name">{pendingFile.name}</span>
            <button type="button" class="row-x" onclick={clearPendingFile} title="Remove file">×</button>
          </span>
        {/if}
      </div>
      <textarea
        rows="1"
        placeholder={composerHint()}
        bind:this={composer}
        bind:value={draft}
        disabled={!currentRoom}
        oninput={onDraftInput}
        onkeydown={onComposerKey}
        onpaste={onComposerPaste}
        onblur={stopLocalTyping}
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
  </section>

  <aside class="rail people">
    <div class="rail-heading">
      {#if !peopleCollapsed}
        <span transition:soft>people</span>
      {/if}
      <button
        type="button"
        class="rail-toggle"
        aria-label={peopleCollapsed ? 'Expand people' : 'Collapse people'}
        aria-expanded={!peopleCollapsed}
        onclick={() => setCollapsed('people', !peopleCollapsed)}
      >
        <IconGlyph name={peopleCollapsed ? 'chevron-left' : 'chevron-right'} />
      </button>
    </div>
    {#if !peopleCollapsed}
      <div class="rail-body" transition:soft>
      {#if people.length === 0}
        <p class="empty-hint">Nobody here yet.</p>
      {:else}
        <ul class="people-list">
          {#each people as person (person.id)}
            {@const activeDm =
              Boolean(
                currentRoomRecord() &&
                  isDm(currentRoomRecord()) &&
                  roomTitle(currentRoomRecord()) === person.username
              )}
            <li>
              {#if person.username === username}
                <span class="self">
                  <UserChip
                    user={person}
                    online={isOnline(person.username)}
                    onResetPassword={me?.role === 'admin' ? resetPasswordFor : undefined}
                    onSetRole={me?.role === 'admin' ? setRoleFor : undefined}
                  />
                  <span class="role-label">{person.role ?? 'member'}</span>
                  <span class="you">you</span>
                </span>
              {:else}
                <div
                  class="person-row"
                  class:active={activeDm}
                  role="button"
                  tabindex="0"
                  onclick={() => void startDm(person)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void startDm(person);
                    }
                  }}
                >
                  <UserChip
                    user={person}
                    online={isOnline(person.username)}
                    onResetPassword={me?.role === 'admin' ? resetPasswordFor : undefined}
                    onSetRole={me?.role === 'admin' ? setRoleFor : undefined}
                  />
                  <span class="role-label">{person.role ?? 'member'}</span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      </div>
    {/if}
  </aside>
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
