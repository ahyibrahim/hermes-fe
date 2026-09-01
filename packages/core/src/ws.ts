import { SOCKET_OPEN, SocketCloseInfo, SocketHandle, TransportAdapter } from './adapters.js';
import { AuthError } from './errors.js';
import { IceCandidatePayload, MessageRecord, SessionDescriptionPayload } from './types.js';

export interface WsIncomingMessage {
  type: string;
  room?: string;
  user?: string;
  users?: string[];
  message?: MessageRecord;
  content?: string;
  sender?: string;
  messageText?: string;
  from?: string;
  to?: string;
  sdp?: SessionDescriptionPayload;
  candidate?: IceCandidatePayload | null;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

function locationOrigin(): string {
  try {
    return (globalThis as { location?: { origin?: string } }).location?.origin ?? '';
  } catch {
    return '';
  }
}

function originToSocket(origin: string): string {
  const trimmed = origin.replace(/\/$/, '');
  if (trimmed.startsWith('https://')) {
    return `wss://${trimmed.slice('https://'.length)}`;
  }
  if (trimmed.startsWith('http://')) {
    return `ws://${trimmed.slice('http://'.length)}`;
  }
  return trimmed;
}

/**
 * Map an HTTP(S) API base URL to a WebSocket origin.
 * An empty or relative base (same-origin static hosting) uses `location.origin`
 * so `new WebSocket` gets an absolute `ws:` / `wss:` URL.
 */
export function toSocketUrl(baseUrl: string, origin = locationOrigin()): string {
  const normalized = baseUrl.replace(/\/$/, '');

  if (normalized.startsWith('https://')) {
    return `wss://${normalized.slice('https://'.length)}`;
  }

  if (normalized.startsWith('http://')) {
    return `ws://${normalized.slice('http://'.length)}`;
  }

  const wsOrigin = originToSocket(origin);
  if (!wsOrigin) {
    return normalized;
  }

  if (!normalized) {
    return wsOrigin;
  }

  if (normalized.startsWith('/')) {
    return `${wsOrigin}${normalized}`;
  }

  return normalized;
}

export class HermesWsClient {
  private socket: SocketHandle | null = null;
  private readonly messageListeners: Array<(message: WsIncomingMessage) => void> = [];
  private readonly openListeners: Array<() => void> = [];
  private readonly closeListeners: Array<(info: SocketCloseInfo) => void> = [];
  private status: ConnectionStatus = 'idle';
  private lastError: Error | null = null;
  private connectPromise: Promise<void> | null = null;
  private token: string | null = null;
  private closedByUs = false;

  constructor(
    private readonly baseUrl: string,
    private readonly transport: TransportAdapter
  ) {}

  connect(token: string): Promise<void> {
    this.token = token;

    if (this.status === 'open' && this.socket) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.status = 'connecting';
    this.lastError = null;
    this.closedByUs = false;

    this.connectPromise = new Promise((resolve, reject) => {
      const socketUrl = `${toSocketUrl(this.baseUrl)}/ws?token=${encodeURIComponent(token)}`;
      let handshakeStatus: number | undefined;
      let settled = false;

      try {
        this.socket = this.transport.open(socketUrl, token);
      } catch (error) {
        this.status = 'error';
        this.lastError = error instanceof Error ? error : new Error(String(error));
        this.connectPromise = null;
        reject(this.lastError);
        return;
      }

      this.attachSocketListeners(this.socket);

      this.socket.onOpen(() => {
        this.status = 'open';
        settled = true;
        resolve();
        this.connectPromise = null;
        this.openListeners.forEach((listener) => listener());
      });

      this.socket.onError((error) => {
        if (this.status === 'open' || settled) {
          return;
        }

        const authError = /401/.test(error.message)
          ? new AuthError('WebSocket handshake failed: 401')
          : error;
        this.status = 'error';
        this.lastError = authError;
        settled = true;
        reject(authError);
        this.connectPromise = null;
      });

      this.socket.onClose((info) => {
        if (this.closedByUs) {
          return;
        }

        handshakeStatus = info.status ?? handshakeStatus;
        const wasOpen = this.status === 'open';
        this.status = handshakeStatus === 401 ? 'error' : 'closed';
        if (handshakeStatus === 401 && !this.lastError) {
          this.lastError = new AuthError('WebSocket handshake failed: 401');
        }
        this.socket = null;
        this.connectPromise = null;

        if (!settled) {
          settled = true;
          reject(this.lastError ?? new Error('WebSocket closed during handshake'));
        }

        if (wasOpen || handshakeStatus) {
          this.closeListeners.forEach((listener) =>
            listener({ ...info, status: handshakeStatus })
          );
        }
      });
    });

    return this.connectPromise.catch((error) => {
      this.connectPromise = null;
      throw error;
    });
  }

  private attachSocketListeners(socket: SocketHandle): void {
    socket.onMessage((data) => {
      try {
        const payload = JSON.parse(data) as WsIncomingMessage;
        this.messageListeners.forEach((listener) => listener(payload));
      } catch {
        this.messageListeners.forEach((listener) =>
          listener({ type: 'error', content: 'Failed to parse WebSocket frame' })
        );
      }
    });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError?.message ?? null;
  }

  isConnected(): boolean {
    return this.status === 'open' && this.socket !== null && this.socket.readyState === SOCKET_OPEN;
  }

  onMessage(listener: (message: WsIncomingMessage) => void): void {
    this.messageListeners.push(listener);
  }

  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
  }

  onClose(listener: (info: SocketCloseInfo) => void): void {
    this.closeListeners.push(listener);
  }

  async ensureConnected(token: string): Promise<void> {
    this.token = token;

    if (this.isConnected()) {
      return;
    }

    if (this.status === 'connecting' && this.connectPromise) {
      await this.connectPromise;
      return;
    }

    await this.connect(token);
  }

  async joinRoom(room: string): Promise<void> {
    const token = this.token;
    if (!token) {
      throw new Error('WebSocket has no auth token. Login first.');
    }

    await this.ensureConnected(token);

    if (!this.isConnected()) {
      throw new Error(
        `WebSocket is not connected. Check that the backend is running and that ${toSocketUrl(this.baseUrl)}/ws is reachable.`
      );
    }

    this.socket?.send(JSON.stringify({ type: 'join_room', room }));
  }

  send(payload: Record<string, unknown>): void {
    if (!this.isConnected() || !this.socket) {
      throw new Error(
        `WebSocket is not connected. Check that the backend is running and that ${toSocketUrl(this.baseUrl)}/ws is reachable.`
      );
    }

    this.socket.send(JSON.stringify(payload));
  }

  close(): void {
    this.closedByUs = true;
    this.socket?.close();
    this.socket = null;
    this.status = 'closed';
    this.connectPromise = null;
  }
}
