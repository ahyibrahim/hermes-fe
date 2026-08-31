import { TokenStorageAdapter } from './adapters.js';
import { AuthError } from './errors.js';
import { HermesApi } from './api.js';
import { resolveRoom } from './resolve-room.js';
import { ClientState, HealthResponse, MessageRecord, RegisterResponse, RoomRecord } from './types.js';
import { ConnectionStatus, HermesWsClient, WsIncomingMessage } from './ws.js';

export type SessionEventMap = {
  message: MessageRecord;
  history: { messages: MessageRecord[] };
  presence: { users: string[] };
  connected: { user: string };
  joined: { room: string };
  status: { status: ConnectionStatus; lastError: string | null };
  info: { message: string };
  error: { message: string };
  authExpired: { source: 'rest' | 'ws' };
};

type SessionListener<K extends keyof SessionEventMap> = (payload: SessionEventMap[K]) => void;

export interface SessionControllerOptions {
  baseUrl: string;
  api: HermesApi;
  ws: HermesWsClient;
  tokens: TokenStorageAdapter;
  reconnectDelayMs?: number;
}

export class SessionController {
  readonly state: ClientState;
  private readonly api: HermesApi;
  private readonly ws: HermesWsClient;
  private readonly tokens: TokenStorageAdapter;
  private readonly reconnectDelayMs: number;
  private readonly displayedMessageIds = new Set<number>();
  private readonly listeners = new Map<keyof SessionEventMap, Set<SessionListener<keyof SessionEventMap>>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;

  constructor(options: SessionControllerOptions) {
    this.state = {
      username: null,
      token: null,
      room: null,
      roomUsers: [],
      messages: [],
      baseUrl: options.baseUrl,
    };
    this.api = options.api;
    this.ws = options.ws;
    this.tokens = options.tokens;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1500;
    this.bindSocket();
  }

  getState(): ClientState {
    return this.state;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.ws.getStatus();
  }

  getLastError(): string | null {
    return this.ws.getLastError();
  }

  on<K extends keyof SessionEventMap>(event: K, listener: SessionListener<K>): () => void {
    const bucket = this.listeners.get(event) ?? new Set();
    bucket.add(listener as SessionListener<keyof SessionEventMap>);
    this.listeners.set(event, bucket);
    return () => bucket.delete(listener as SessionListener<keyof SessionEventMap>);
  }

  private emit<K extends keyof SessionEventMap>(event: K, payload: SessionEventMap[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) {
      return;
    }
    for (const listener of bucket) {
      (listener as SessionListener<K>)(payload);
    }
  }

  async resume(): Promise<boolean> {
    const stored = await this.tokens.load();
    if (!stored) {
      return false;
    }

    this.state.username = stored.username;
    this.state.token = stored.token;

    try {
      await this.withAuth('rest', () => this.api.listRooms(stored.token));
    } catch (error) {
      if (error instanceof AuthError) {
        return false;
      }
    }

    if (!this.state.token) {
      return false;
    }

    try {
      await this.connect();
    } catch (error) {
      if (error instanceof AuthError) {
        return false;
      }
      this.emit('info', {
        message: `WebSocket connection unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
      this.emit('info', { message: 'You can still send and load history over REST.' });
    }

    return this.state.token !== null;
  }

  async register(username: string, password: string): Promise<RegisterResponse> {
    return this.api.register(username, password);
  }

  async login(username: string, password: string): Promise<void> {
    const auth = await this.api.login(username, password);
    this.state.username = auth.username;
    this.state.token = auth.token;
    await this.tokens.save({ username: auth.username, token: auth.token });
  }

  async connect(): Promise<void> {
    if (!this.state.token) {
      throw new Error('Login before connecting WebSocket.');
    }

    try {
      await this.ws.connect(this.state.token);
    } catch (error) {
      if (error instanceof AuthError) {
        await this.clearSession('ws');
      }
      throw error;
    }
  }

  async listRooms(): Promise<RoomRecord[]> {
    if (!this.state.token) {
      return [];
    }

    try {
      return await this.withAuth('rest', () => this.api.listRooms(this.state.token as string));
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      this.emit('error', {
        message: `Could not list rooms: ${error instanceof Error ? error.message : String(error)}`,
      });
      return [];
    }
  }

  async health(): Promise<HealthResponse> {
    return this.api.health();
  }

  async enterRoom(roomInput: string): Promise<void> {
    if (!this.state.username) {
      this.emit('error', { message: 'Please login first.' });
      return;
    }

    const rooms = await this.listRooms();
    const resolved = resolveRoom(roomInput, rooms);
    const room = resolved.slug;

    if (resolved.slug !== roomInput) {
      this.emit('info', { message: `Using room ${resolved.slug} (from ${roomInput}).` });
    }

    this.state.room = room;
    this.state.messages = [];
    this.displayedMessageIds.clear();
    this.setRoster(resolved.members.length > 0 ? resolved.members : this.state.username ? [this.state.username] : []);

    try {
      await this.connect();
      await this.ws.joinRoom(room);
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      this.emit('info', {
        message: `Cannot join room over WebSocket. ${error instanceof Error ? error.message : String(error)}`,
      });
      this.emit('info', { message: 'Loading history over REST anyway.' });
    }

    this.emit('presence', { users: [...this.state.roomUsers] });

    try {
      if (!this.state.token) {
        this.emit('error', { message: 'Could not load history: missing auth token. Please login again.' });
      } else {
        const messages = await this.withAuth('rest', () => this.api.listMessages(room, this.state.token as string));
        this.state.messages = messages;
        for (const message of messages) {
          if (message.id != null) {
            this.displayedMessageIds.add(message.id);
          }
        }
        this.emit('history', { messages });
      }
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      this.emit('error', {
        message: `Could not load history: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.state.username || !this.state.room || !this.state.token) {
      this.emit('error', { message: 'Please login, join a room, and ensure you have a token.' });
      return;
    }

    const message = await this.withAuth('rest', () =>
      this.api.createMessage(this.state.room as string, text, this.state.token as string)
    );
    this.displayMessage(message);
  }

  async sendFile(filePath: string): Promise<void> {
    if (!this.state.room || !this.state.token) {
      this.emit('error', { message: 'Please login and join a room first.' });
      return;
    }

    const uploaded = await this.withAuth('rest', () =>
      this.api.uploadFile(this.state.room as string, filePath, this.state.token as string)
    );
    this.displayMessage(uploaded.message);
    this.emit('info', {
      message: `Uploaded file ${uploaded.file.id}${uploaded.file.name || uploaded.file.filename ? ` (${uploaded.file.name ?? uploaded.file.filename})` : ''}.`,
    });
  }

  async getFile(fileId: string, destination?: string): Promise<string | undefined> {
    if (!this.state.token) {
      this.emit('error', { message: 'Please login first.' });
      return undefined;
    }

    const path = destination || `file-${fileId}`;
    const saved = await this.withAuth('rest', () => this.api.downloadFile(fileId, path, this.state.token as string));
    this.emit('info', { message: `Saved file ${fileId} to ${saved}` });
    return saved;
  }

  shutdown(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws.close();
  }

  private bindSocket(): void {
    this.ws.onMessage((payload) => {
      if (this.handlePresence(payload)) {
        return;
      }

      if (payload.type === 'connected') {
        this.emit('connected', { user: payload.user ?? 'anonymous' });
        return;
      }

      if (payload.type === 'joined_room') {
        if (payload.room && payload.room !== this.state.room) {
          return;
        }

        if (this.state.username && this.state.roomUsers.length === 0) {
          this.setRoster([this.state.username]);
        }

        this.emit('joined', { room: payload.room ?? this.state.room ?? '' });
        return;
      }

      if (payload.type === 'message' && payload.message) {
        this.displayMessage(payload.message);
        return;
      }

      if (payload.type === 'error') {
        this.emit('error', {
          message: payload.content ?? (typeof payload.message === 'string' ? payload.message : 'unknown error'),
        });
      }
    });

    this.ws.onOpen(() => {
      this.emit('status', { status: this.ws.getStatus(), lastError: this.ws.getLastError() });
      if (this.state.room) {
        this.ws.joinRoom(this.state.room).catch((error) => {
          this.emit('error', {
            message: `Could not rejoin room over WebSocket: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      }
    });

    this.ws.onClose((info) => {
      this.emit('status', { status: this.ws.getStatus(), lastError: this.ws.getLastError() });
      if (info.status === 401) {
        void this.clearSession('ws');
        this.emit('info', {
          message: 'WebSocket rejected (401). Session cleared; please log in again.',
        });
        return;
      }

      this.emit('info', { message: 'WebSocket disconnected. Live updates paused; REST still works.' });

      if (this.shuttingDown || !this.state.token) {
        return;
      }

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }

      this.reconnectTimer = setTimeout(() => {
        this.connect().catch((error) => {
          if (error instanceof AuthError) {
            return;
          }
          this.emit('error', {
            message: `WebSocket reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      }, this.reconnectDelayMs);
    });
  }

  private roomMatches(payload: WsIncomingMessage): boolean {
    return payload.room === undefined || payload.room === this.state.room;
  }

  private setRoster(users: string[]): void {
    this.state.roomUsers = [...new Set(users)];
  }

  private addRoomUser(user: string): boolean {
    if (this.state.roomUsers.includes(user)) {
      return false;
    }

    this.state.roomUsers.push(user);
    return true;
  }

  private removeRoomUser(user: string): boolean {
    const next = this.state.roomUsers.filter((name) => name !== user);
    if (next.length === this.state.roomUsers.length) {
      return false;
    }

    this.state.roomUsers = next;
    return true;
  }

  private handlePresence(payload: WsIncomingMessage): boolean {
    if (payload.type === 'room_users' && this.roomMatches(payload) && Array.isArray(payload.users)) {
      this.setRoster(payload.users);
      this.emit('presence', { users: [...this.state.roomUsers] });
      return true;
    }

    if (payload.type === 'user_joined' && payload.user && this.roomMatches(payload)) {
      if (this.addRoomUser(payload.user)) {
        this.emit('presence', { users: [...this.state.roomUsers] });
      }
      return true;
    }

    if (payload.type === 'user_left' && payload.user && this.roomMatches(payload)) {
      if (this.removeRoomUser(payload.user)) {
        this.emit('presence', { users: [...this.state.roomUsers] });
      }
      return true;
    }

    return false;
  }

  private displayMessage(message: MessageRecord): void {
    if (message.id != null) {
      if (this.displayedMessageIds.has(message.id)) {
        return;
      }

      this.displayedMessageIds.add(message.id);
    }

    this.state.messages.push(message);
    this.emit('message', message);
  }

  private async withAuth<T>(source: 'rest' | 'ws', fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AuthError) {
        await this.clearSession(source);
      }
      throw error;
    }
  }

  private async clearSession(source: 'rest' | 'ws'): Promise<void> {
    this.state.token = null;
    this.state.username = null;
    await this.tokens.clear();
    this.emit('authExpired', { source });
  }
}
