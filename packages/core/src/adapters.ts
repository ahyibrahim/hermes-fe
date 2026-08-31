export interface SocketCloseInfo {
  code?: number;
  reason?: string;
  status?: number;
}

export const SOCKET_OPEN = 1;

export interface SocketHandle {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: string) => void): void;
  onError(listener: (error: Error) => void): void;
  onClose(listener: (info: SocketCloseInfo) => void): void;
}

export interface TransportAdapter {
  open(url: string, token: string): SocketHandle;
}

export interface FileIOAdapter {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  basename(path: string): string;
}

export interface StoredSession {
  username: string;
  token: string;
}

export interface TokenStorageAdapter {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStorageAdapter {
  private value: StoredSession | null = null;

  async load(): Promise<StoredSession | null> {
    return this.value ? { ...this.value } : null;
  }

  async save(session: StoredSession): Promise<void> {
    this.value = { username: session.username, token: session.token };
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

export class MemoryFileIO implements FileIOAdapter {
  readonly files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) {
      throw new Error(`ENOENT: ${path}`);
    }
    return data;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  basename(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }
}

/**
 * Browser WebSocket transport. The token is already on the URL as `?token=`;
 * browsers cannot set an Authorization header on the handshake.
 */
type BrowserSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void;
};

export class BrowserTransport implements TransportAdapter {
  open(url: string, _token: string): SocketHandle {
    const WebSocketCtor = (globalThis as { WebSocket: new (url: string) => BrowserSocket }).WebSocket;
    const socket = new WebSocketCtor(url);

    return {
      get readyState() {
        return socket.readyState;
      },
      send(data: string) {
        socket.send(data);
      },
      close() {
        socket.close();
      },
      onOpen(listener) {
        socket.addEventListener('open', listener);
      },
      onMessage(listener) {
        socket.addEventListener('message', (event) => listener(String(event.data)));
      },
      onError(listener) {
        socket.addEventListener('error', () => listener(new Error('WebSocket error')));
      },
      onClose(listener) {
        socket.addEventListener('close', (event) => listener({ code: event.code, reason: event.reason }));
      },
    };
  }
}
