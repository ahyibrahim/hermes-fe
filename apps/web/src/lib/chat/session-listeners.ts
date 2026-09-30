import type {
  ConnectionStatus,
  MessageRecord,
  PublicUser,
  RoomRecord,
  SessionController,
} from '@hermes/core';
import { playSfx } from '$lib/sfx';
import type { ScrollPin } from './scroll-pin.svelte';
import type { TranscriptBuffer } from './transcript-buffer.svelte';

export interface WatchView {
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
}

/** ChatShell state and helpers the session listeners read and write. */
export interface ShellBindings {
  pin: ScrollPin;
  buffer: TranscriptBuffer;
  rooms: RoomRecord[];
  directory: PublicUser[];
  users: string[];
  status: ConnectionStatus;
  currentRoom: string | null;
  readonly username: string | null;
  typingUsers: string[];
  callToast: { room: string; user: string } | null;
  watch: WatchView | null;
  watchIntent: 'start' | 'join' | null;
  syncMetaFromSession(): void;
  clearUnread(slug: string): void;
  shouldCountUnread(slug: string, message: MessageRecord): boolean;
  bumpUnread(slug: string): void;
  isCaughtUp(slug: string | null | undefined): boolean;
  maybeNotify(roomSlug: string, message: MessageRecord): void;
  maybeReceiveCue(roomSlug: string, message: MessageRecord): void;
  loadRooms(): Promise<void>;
  loadDirectory(): Promise<void>;
  selectRoom(slug: string): Promise<void>;
  closeRoomMenu(): void;
  applyWatchSnapshot(payload: Omit<WatchView, 'open'>, open?: boolean): void;
  flashWatchDenied(message: string): void;
  flash(message: string, isError?: boolean): void;
  onHistorySettled(): void;
}

/** Subscribes ChatShell to session events; returns the unsubscribe functions. */
export function bindSessionListeners(
  session: SessionController,
  shell: ShellBindings
): Array<() => void> {
  return [
    session.on('history', () => {
      shell.pin.stickToBottom = true;
      shell.pin.showJump = false;
      shell.syncMetaFromSession();
      // selectRoom owns the dual-buffer commit while a switch is pending.
      if (!shell.buffer.pendingRoom) {
        shell.buffer.liveEnterIds.clear();
        shell.buffer.displayMessages = [...session.getState().messages];
      }
      if (shell.currentRoom) {
        shell.clearUnread(shell.currentRoom);
      }
      shell.onHistorySettled();
    }),
    session.on('older', () => {
      if (!shell.buffer.pendingRoom) {
        shell.buffer.displayMessages = [...session.getState().messages];
      }
    }),
    session.on('message', (message) => {
      shell.syncMetaFromSession();
      if (!shell.buffer.pendingRoom) {
        shell.buffer.markLiveEnter(message.id);
        shell.buffer.displayMessages = [...session.getState().messages];
        shell.buffer.pruneLiveEnterIds(shell.buffer.displayMessages);
      }
      if (message.sender && (!message.room || message.room === shell.currentRoom)) {
        shell.typingUsers = shell.typingUsers.filter((name) => name !== message.sender);
      }
      if (message.room) {
        if (shell.shouldCountUnread(message.room, message)) {
          shell.bumpUnread(message.room);
        } else if (shell.isCaughtUp(message.room)) {
          void session.markRoomRead(message.room);
        }
      }
      if (message.room) {
        shell.rooms = shell.rooms.map((entry) =>
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
      shell.maybeNotify(message.room, message);
      shell.maybeReceiveCue(message.room, message);
    }),
    session.on('roomActivity', ({ room, message }) => {
      if (message.deleted_at) {
        shell.rooms = shell.rooms.map((entry) =>
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
      if (!shell.rooms.some((entry) => entry.slug === room)) {
        void shell.loadRooms();
      } else {
        if (shell.shouldCountUnread(room, message)) {
          shell.bumpUnread(room);
        }
        shell.rooms = shell.rooms.map((entry) =>
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
      shell.maybeNotify(room, message);
      shell.maybeReceiveCue(room, message);
    }),
    session.on('messageDeleted', () => {
      if (!shell.buffer.pendingRoom) {
        shell.buffer.displayMessages = [...session.getState().messages];
      }
    }),
    session.on('userUpdated', (user) => {
      const meName = session.getState().username;
      const previous = shell.directory.find(
        (entry) => entry.id === user.id || entry.username === user.username
      );
      shell.directory = shell.directory.map((entry) =>
        entry.id === user.id || entry.username === user.username ? { ...entry, ...user } : entry
      );
      if (meName && user.username === meName && user.role && previous?.role && previous.role !== user.role) {
        shell.closeRoomMenu();
        shell.flash(`You are now ${user.role}.`);
      }
    }),
    session.on('memberAdded', () => {
      void shell.loadRooms();
    }),
    session.on('memberRemoved', async ({ room, users: removed }) => {
      const meName = session.getState().username;
      const wasKicked = Boolean(meName && removed.includes(meName));
      await shell.loadRooms();
      if (wasKicked && shell.currentRoom === room) {
        const next = shell.rooms.find((entry) => entry.slug === 'general') ?? shell.rooms[0];
        if (next) {
          await shell.selectRoom(next.slug);
        } else {
          shell.currentRoom = null;
          shell.buffer.clearDisplayTranscript();
        }
        shell.closeRoomMenu();
      }
    }),
    session.on('roomDeleted', ({ room }) => {
      shell.rooms = shell.rooms.filter((entry) => entry.slug !== room);
      if (shell.currentRoom === room) {
        const next = shell.rooms.find((entry) => entry.slug === 'general') ?? shell.rooms[0];
        if (next) {
          void shell.selectRoom(next.slug);
        } else {
          shell.currentRoom = null;
          shell.buffer.clearDisplayTranscript();
        }
        shell.closeRoomMenu();
      }
    }),
    session.on('callStarted', ({ room, user }) => {
      if (user === session.getState().username) {
        return;
      }
      if (room === session.getState().room) {
        return;
      }
      shell.callToast = { room, user };
    }),
    session.on('watchStarted', (payload) => {
      const meName = session.getState().username;
      const viewing = payload.room === session.getState().room;
      const wasOpen = shell.watch?.open && shell.watch.room === payload.room;
      shell.applyWatchSnapshot(payload, wasOpen || shell.watchIntent !== null);
      if (shell.watchIntent === 'start' && payload.host === meName) {
        playSfx('watch-start');
      } else if (viewing || shell.watchIntent === 'join') {
        // Someone else started while you view the room, or you joined via start-as-join.
        if (payload.host !== meName || shell.watchIntent === 'join') {
          playSfx('watch-join');
        }
      }
      if (shell.watchIntent) {
        shell.watch = shell.watch ? { ...shell.watch, open: true } : shell.watch;
        shell.watchIntent = null;
      }
    }),
    session.on('watchState', (payload) => {
      const meName = session.getState().username;
      const wasOpen = shell.watch?.open && shell.watch.room === payload.room;
      const intent = shell.watchIntent;
      const joining = intent === 'join' || intent === 'start';
      shell.applyWatchSnapshot(payload, wasOpen || joining);
      if (intent === 'start' && payload.host === meName) {
        playSfx('watch-start');
        shell.watchIntent = null;
        if (shell.watch) {
          shell.watch = { ...shell.watch, open: true };
        }
      } else if (joining) {
        // Explicit join, or start-as-join when a session already existed.
        playSfx('watch-join');
        shell.watchIntent = null;
        if (shell.watch) {
          shell.watch = { ...shell.watch, open: true };
        }
      }
    }),
    session.on('watchPeers', ({ room, users: peerUsers, host }) => {
      if (!shell.watch || shell.watch.room !== room) {
        return;
      }
      shell.watch = { ...shell.watch, users: [...peerUsers], host };
    }),
    session.on('watchEnded', ({ room, user: endedBy }) => {
      const active = shell.watch;
      if (!active || active.room !== room) {
        return;
      }
      const wasIn = active.open || active.users.includes(shell.username ?? '');
      if (wasIn) {
        playSfx('watch-end');
      }
      void endedBy;
      shell.watch = null;
      shell.watchIntent = null;
    }),
    session.on('watchControlDenied', ({ action, reason }) => {
      shell.flashWatchDenied(reason ? `${action}: ${reason}` : `Cannot ${action}`);
    }),
    session.on('leftWatch', ({ room }) => {
      if (shell.watch?.room === room) {
        shell.watch = { ...shell.watch, open: false };
      }
      shell.watchIntent = null;
    }),
    session.on('presence', () => {
      const state = session.getState();
      shell.users = [...state.roomUsers].sort((a, b) => a.localeCompare(b));
      void shell.loadDirectory();
    }),
    session.on('typing', ({ room, user, active }) => {
      if (room !== shell.currentRoom || user === shell.username) {
        return;
      }
      if (active) {
        if (!shell.typingUsers.includes(user)) {
          shell.typingUsers = [...shell.typingUsers, user].sort((a, b) => a.localeCompare(b));
        }
      } else {
        shell.typingUsers = shell.typingUsers.filter((name) => name !== user);
      }
    }),
    session.on('status', ({ status: next }) => {
      shell.status = next;
    }),
    session.on('info', ({ message }) => shell.flash(message, false)),
    session.on('error', ({ message }) => shell.flash(message, true)),
    session.on('joined', ({ room }) => {
      shell.currentRoom = room;
    }),
  ];
}
