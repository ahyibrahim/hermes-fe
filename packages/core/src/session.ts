import { TokenStorageAdapter } from './adapters.js';
import { AuthError } from './errors.js';
import { HermesApi } from './api.js';
import { resolveRoom } from './resolve-room.js';
import {
  ClientState,
  HealthResponse,
  IceCandidatePayload,
  IceConfig,
  MessageRecord,
  PublicUser,
  RegisterResponse,
  RoomRecord,
  SessionDescriptionPayload,
} from './types.js';
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
  callPeers: { room: string; users: string[] };
  userJoinedCall: { room: string; user: string };
  userLeftCall: { room: string; user: string };
  leftCall: { room: string };
  callOffer: { room: string; from: string; sdp: SessionDescriptionPayload };
  callAnswer: { room: string; from: string; sdp: SessionDescriptionPayload };
  iceCandidate: { room: string; from: string; candidate: IceCandidatePayload | null };
  roomActivity: { room: string; message: MessageRecord };
  callStarted: { room: string; user: string };
  messageDeleted: MessageRecord;
  userUpdated: PublicUser;
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

  async listUsers(): Promise<PublicUser[]> {
    if (!this.state.token) {
      return [];
    }

    try {
      return await this.withAuth('rest', () => this.api.listUsers(this.state.token as string));
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      this.emit('error', {
        message: `Could not list users: ${error instanceof Error ? error.message : String(error)}`,
      });
      return [];
    }
  }

  async listOnlineUsers(): Promise<string[]> {
    if (!this.state.token) {
      return [];
    }

    try {
      return await this.withAuth('rest', () => this.api.listOnlineUsers(this.state.token as string));
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      this.emit('error', {
        message: `Could not list online users: ${error instanceof Error ? error.message : String(error)}`,
      });
      return [];
    }
  }

  async createRoom(name: string, memberIds: number[] = []): Promise<RoomRecord> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.createRoom(name, memberIds, this.state.token as string));
  }

  async createDm(userId: number): Promise<RoomRecord> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.createDm(userId, this.state.token as string));
  }

  async leaveRoom(slug: string): Promise<void> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    await this.withAuth('rest', () => this.api.leaveRoom(slug, this.state.token as string));
  }

  async hideRoom(slug: string): Promise<void> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    await this.withAuth('rest', () => this.api.hideRoom(slug, this.state.token as string));
  }

  async unsendMessage(id: number): Promise<MessageRecord> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    const tombstone = await this.withAuth('rest', () =>
      this.api.deleteMessage(id, this.state.token as string)
    );
    this.applyTombstone(tombstone);
    return tombstone;
  }

  async issuePasswordReset(username: string): Promise<{ token: string; expires_at: string }> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.issuePasswordReset(username, this.state.token as string));
  }

  async redeemPasswordReset(username: string, token: string, password: string): Promise<void> {
    const session = await this.api.redeemPasswordReset(username, token, password);
    this.state.username = session.username;
    this.state.token = session.token;
    await this.tokens.save({ username: session.username, token: session.token });
  }

  async markRoomRead(slug: string): Promise<void> {
    if (!this.state.token) {
      return;
    }
    await this.withAuth('rest', () => this.api.markRoomRead(slug, this.state.token as string));
  }

  async setColor(color: string): Promise<PublicUser> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.setColor(color, this.state.token as string));
  }

  async logout(): Promise<void> {
    const token = this.state.token;
    if (token) {
      try {
        await this.api.logout(token);
      } catch {
        // Still drop the local session even if the server already rejected the token.
      }
    }
    await this.clearSession('rest');
  }

  async getMe(): Promise<PublicUser | null> {
    if (!this.state.token) {
      return null;
    }

    try {
      return await this.withAuth('rest', () => this.api.getMe(this.state.token as string));
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      this.emit('error', {
        message: `Could not load profile: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    }
  }

  async changePassword(currentPassword: string, password: string): Promise<void> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    // Wrong current password is 401; that is not a dead session.
    await this.api.changePassword(currentPassword, password, this.state.token);
  }

  async uploadAvatar(file: Blob, filename: string): Promise<PublicUser> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.uploadAvatar(file, filename, this.state.token as string));
  }

  async fetchAvatar(userId: number): Promise<Uint8Array> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.fetchAvatar(userId, this.state.token as string));
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

  async fetchFile(fileId: string): Promise<{ bytes: Uint8Array; mime: string }> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.fetchFile(fileId, this.state.token as string));
  }

  async getIce(): Promise<IceConfig> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }
    return this.withAuth('rest', () => this.api.getIce(this.state.token as string));
  }

  async joinCall(room: string): Promise<void> {
    await this.ensureSocketForCall();
    this.ws.send({ type: 'join_call', room });
  }

  async leaveCall(room: string): Promise<void> {
    if (!this.ws.isConnected()) {
      return;
    }
    this.ws.send({ type: 'leave_call', room });
  }

  sendCallOffer(room: string, to: string, sdp: SessionDescriptionPayload): void {
    this.ws.send({ type: 'call_offer', room, to, sdp });
  }

  sendCallAnswer(room: string, to: string, sdp: SessionDescriptionPayload): void {
    this.ws.send({ type: 'call_answer', room, to, sdp });
  }

  sendIceCandidate(room: string, to: string, candidate: IceCandidatePayload | null): void {
    this.ws.send({ type: 'ice_candidate', room, to, candidate });
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
        this.emit('connected', { user: typeof payload.user === 'string' ? payload.user : 'anonymous' });
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
        const incoming = payload.message;
        if (incoming.room && incoming.room !== this.state.room) {
          this.emit('roomActivity', { room: incoming.room, message: incoming });
          return;
        }
        this.displayMessage(incoming);
        return;
      }

      if (payload.type === 'message_deleted' && payload.message) {
        this.applyTombstone(payload.message);
        return;
      }

      if (payload.type === 'user_updated' && payload.user && typeof payload.user === 'object') {
        this.emit('userUpdated', payload.user as PublicUser);
        return;
      }

      if (payload.type === 'error') {
        this.emit('error', {
          message: payload.content ?? (typeof payload.message === 'string' ? payload.message : 'unknown error'),
        });
        return;
      }

      if (this.handleCall(payload)) {
        return;
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

    if (payload.type === 'user_joined' && typeof payload.user === 'string' && this.roomMatches(payload)) {
      if (this.addRoomUser(payload.user)) {
        this.emit('presence', { users: [...this.state.roomUsers] });
      }
      return true;
    }

    if (payload.type === 'user_left' && typeof payload.user === 'string' && this.roomMatches(payload)) {
      if (this.removeRoomUser(payload.user)) {
        this.emit('presence', { users: [...this.state.roomUsers] });
      }
      return true;
    }

    return false;
  }

  private handleCall(payload: WsIncomingMessage): boolean {
    if (payload.type === 'call_started' && payload.room && typeof payload.user === 'string') {
      this.emit('callStarted', { room: payload.room, user: payload.user });
      return true;
    }

    if (payload.type === 'call_peers' && payload.room && Array.isArray(payload.users)) {
      this.emit('callPeers', { room: payload.room, users: payload.users });
      return true;
    }

    if (payload.type === 'user_joined_call' && payload.room && typeof payload.user === 'string') {
      this.emit('userJoinedCall', { room: payload.room, user: payload.user });
      return true;
    }

    if (payload.type === 'user_left_call' && payload.room && typeof payload.user === 'string') {
      this.emit('userLeftCall', { room: payload.room, user: payload.user });
      return true;
    }

    if (payload.type === 'left_call' && payload.room) {
      this.emit('leftCall', { room: payload.room });
      return true;
    }

    if (payload.type === 'call_offer' && payload.room && payload.from && payload.sdp) {
      this.emit('callOffer', { room: payload.room, from: payload.from, sdp: payload.sdp });
      return true;
    }

    if (payload.type === 'call_answer' && payload.room && payload.from && payload.sdp) {
      this.emit('callAnswer', { room: payload.room, from: payload.from, sdp: payload.sdp });
      return true;
    }

    if (payload.type === 'ice_candidate' && payload.room && payload.from) {
      this.emit('iceCandidate', {
        room: payload.room,
        from: payload.from,
        candidate: payload.candidate ?? null,
      });
      return true;
    }

    return false;
  }

  private async ensureSocketForCall(): Promise<void> {
    if (!this.state.token) {
      throw new Error('Please login first.');
    }

    try {
      await this.connect();
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new Error(
        `Cannot join call over WebSocket. ${error instanceof Error ? error.message : String(error)}`
      );
    }
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

  private applyTombstone(message: MessageRecord): void {
    const index = this.state.messages.findIndex((row) => row.id === message.id);
    if (index >= 0) {
      this.state.messages[index] = { ...this.state.messages[index], ...message };
    } else if (message.room && message.room === this.state.room) {
      this.displayMessage(message);
    }
    if (message.room && message.room !== this.state.room) {
      this.emit('roomActivity', { room: message.room, message });
    }
    this.emit('messageDeleted', message);
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
