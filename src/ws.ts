import { WebSocket } from 'ws';
import { MessageRecord } from './types.js';

export interface WsIncomingMessage {
  type: string;
  room?: string;
  user?: string;
  message?: MessageRecord;
  content?: string;
  sender?: string;
  messageText?: string;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export class HermesWsClient {
  private socket: WebSocket | null = null;
  private readonly listeners: Array<(message: WsIncomingMessage) => void> = [];
  private status: ConnectionStatus = 'idle';
  private lastError: Error | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly baseUrl: string) {}

  connect(): Promise<void> {
    if (this.status === 'open' && this.socket) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.status = 'connecting';
    this.lastError = null;

    this.connectPromise = new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.toSocketUrl(this.baseUrl) + '/ws');
      } catch (error) {
        this.status = 'error';
        this.lastError = error instanceof Error ? error : new Error(String(error));
        this.connectPromise = null;
        reject(this.lastError);
        return;
      }

      this.socket.on('open', () => {
        this.status = 'open';
        this.connectPromise?.then(() => undefined);
        resolve();
        this.connectPromise = null;
      });

      this.socket.on('message', (data) => {
        const payload = JSON.parse(data.toString()) as WsIncomingMessage;
        this.listeners.forEach((listener) => listener(payload));
      });

      this.socket.on('error', (error) => {
        if (this.status !== 'open') {
          this.status = 'error';
          this.lastError = error instanceof Error ? error : new Error(String(error));
          reject(this.lastError);
          this.connectPromise = null;
        }
      });

      this.socket.on('close', () => {
        this.status = 'closed';
        this.socket = null;
        this.connectPromise = null;
      });
    });

    return this.connectPromise.catch((error) => {
      this.connectPromise = null;
      throw error;
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
    this.listeners.push(listener);
  }

  async ensureConnected(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.status === 'connecting' && this.connectPromise) {
      await this.connectPromise;
      return;
    }

    await this.connect();
  }

  async joinRoom(room: string, user: string): Promise<void> {
    await this.ensureConnected();

    if (!this.isConnected()) {
      throw new Error(
        `WebSocket is not connected. Check that the backend is running and that ${this.toSocketUrl(this.baseUrl)}/ws is reachable.`
      );
    }

    this.socket?.send(JSON.stringify({ type: 'join_room', room, user }));
  }

  async sendMessage(room: string, sender: string, content: string): Promise<void> {
    await this.ensureConnected();

    if (!this.isConnected()) {
      throw new Error(
        `WebSocket is not connected. Check that the backend is running and that ${this.toSocketUrl(this.baseUrl)}/ws is reachable.`
      );
    }

    this.socket?.send(JSON.stringify({ type: 'send_message', room, sender, content }));
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
