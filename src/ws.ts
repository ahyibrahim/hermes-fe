import { WebSocket } from 'ws';
import { IncomingMessage } from 'node:http';
import { MessageRecord } from './types.js';

export interface WsIncomingMessage {
  type: string;
  room?: string;
  user?: string;
  users?: string[];
  message?: MessageRecord;
  content?: string;
  sender?: string;
  messageText?: string;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export class HermesWsClient {
  private socket: WebSocket | null = null;
  private readonly messageListeners: Array<(message: WsIncomingMessage) => void> = [];
  private readonly openListeners: Array<() => void> = [];
  private readonly closeListeners: Array<(info: { code?: number; reason?: string; status?: number }) => void> = [];
  private status: ConnectionStatus = 'idle';
  private lastError: Error | null = null;
  private connectPromise: Promise<void> | null = null;
  private token: string | null = null;

  constructor(private readonly baseUrl: string) {}

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

    this.connectPromise = new Promise((resolve, reject) => {
      const socketUrl = `${this.toSocketUrl(this.baseUrl)}/ws?token=${encodeURIComponent(token)}`;
      let handshakeStatus: number | undefined;

      try {
        this.socket = new WebSocket(socketUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (error) {
        this.status = 'error';
        this.lastError = error instanceof Error ? error : new Error(String(error));
        this.connectPromise = null;
        reject(this.lastError);
        return;
      }

      this.attachSocketListeners(this.socket);

      this.socket.on('unexpected-response', (_req, response: IncomingMessage) => {
        handshakeStatus = response.statusCode;
        const message = `WebSocket handshake failed: ${response.statusCode ?? 'unknown'}`;
        this.status = 'error';
        this.lastError = new Error(message);
        this.connectPromise = null;
        response.resume();
        reject(this.lastError);
        this.closeListeners.forEach((listener) => listener({ status: handshakeStatus }));
      });

      this.socket.on('open', () => {
        this.status = 'open';
        resolve();
        this.connectPromise = null;
        this.openListeners.forEach((listener) => listener());
      });

      this.socket.on('error', (error) => {
        if (this.status !== 'open') {
          this.status = 'error';
          this.lastError = error instanceof Error ? error : new Error(String(error));
          reject(this.lastError);
          this.connectPromise = null;
        }
      });

      this.socket.on('close', (code, reason) => {
        const wasOpen = this.status === 'open';
        this.status = handshakeStatus === 401 ? 'error' : 'closed';
        if (handshakeStatus === 401 && !this.lastError) {
          this.lastError = new Error('WebSocket handshake failed: 401');
        }
        this.socket = null;
        this.connectPromise = null;
        if (wasOpen || handshakeStatus) {
          this.closeListeners.forEach((listener) =>
            listener({ code, reason: reason.toString(), status: handshakeStatus })
          );
        }
      });
    });

    return this.connectPromise.catch((error) => {
      this.connectPromise = null;
      throw error;
    });
  }

  private attachSocketListeners(socket: WebSocket): void {
    socket.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString()) as WsIncomingMessage;
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
    return this.status === 'open' && this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  onMessage(listener: (message: WsIncomingMessage) => void): void {
    this.messageListeners.push(listener);
  }

  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
  }

  onClose(listener: (info: { code?: number; reason?: string; status?: number }) => void): void {
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
        `WebSocket is not connected. Check that the backend is running and that ${this.toSocketUrl(this.baseUrl)}/ws is reachable.`
      );
    }

    this.socket?.send(JSON.stringify({ type: 'join_room', room }));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.status = 'closed';
    this.connectPromise = null;
  }

  private toSocketUrl(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/$/, '');

    if (normalized.startsWith('https://')) {
      return normalized.replace('https://', 'wss://');
    }

    if (normalized.startsWith('http://')) {
      return normalized.replace('http://', 'ws://');
    }

    return normalized;
  }
}
