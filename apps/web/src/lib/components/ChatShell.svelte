<script lang="ts">
  import type { ConnectionStatus, MessageRecord, PublicUser, RoomRecord } from '@hermes/core';
  import { groupTranscript } from '@hermes/core';
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
  const transcriptRows = $derived(groupTranscript(messages));
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
    if (slug !== currentRoom) {
      closeRoomMenu();
      closeUserMenu();
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
          messages = [];
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
          messages = [];
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
          messages = [];
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
            messages = [];
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
            messages = [];
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
      document.removeEventListener('pointerdown', onFirstGesture, { capture: true });
      document.removeEventListener('keydown', onFirstGesture, { capture: true });
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
        aria-label={roomsCollapsed ? 'Expand rooms' : 'Collapse rooms'}
        aria-expanded={!roomsCollapsed}
        onclick={() => setCollapsed('rooms', !roomsCollapsed)}
      >
        <IconGlyph name={roomsCollapsed ? 'chevron-right' : 'chevron-left'} />
      </button>
      {#if !roomsCollapsed}
        <span>rooms</span>
      {/if}
    </div>
    {#if !roomsCollapsed}
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
            <h2>
              <span class="hash">#</span>{roomTitle(currentRoomRecord())}
            </h2>
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
          <h2>
            {#if currentRoomRecord()}
              <span class="hash">@</span>{roomTitle(currentRoomRecord())}
            {:else}
              Hermes
            {/if}
          </h2>
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
                isAdmin={me?.role === 'admin'}
                {onDownload}
                onUnsend={unsend}
                onResetPassword={me?.role === 'admin' ? resetPasswordFor : undefined}
                onSetRole={me?.role === 'admin' ? setRoleFor : undefined}
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
      ></textarea>
      <IconButton
        type="submit"
        label="Send"
        tone="accent"
        disabled={sending || !currentRoom || (!draft.trim() && !pendingFile)}
      >
        <IconGlyph name="send" />
      </IconButton>
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
        aria-label={peopleCollapsed ? 'Expand people' : 'Collapse people'}
        aria-expanded={!peopleCollapsed}
        onclick={() => setCollapsed('people', !peopleCollapsed)}
      >
        <IconGlyph name={peopleCollapsed ? 'chevron-left' : 'chevron-right'} />
      </button>
    </div>
    {#if !peopleCollapsed}
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
                <div class="person-row" class:active={activeDm}>
                  <UserChip
                    user={person}
                    online={isOnline(person.username)}
                    onResetPassword={me?.role === 'admin' ? resetPasswordFor : undefined}
                    onSetRole={me?.role === 'admin' ? setRoleFor : undefined}
                  />
                  <button
                    type="button"
                    class="person-open"
                    disabled={startingDm != null}
                    onclick={() => startDm(person)}
                  >
                    <span class="role-label">{person.role ?? 'member'}</span>
                    <span class="visually-hidden">Message {person.username}</span>
                  </button>
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
