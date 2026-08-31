import { FileIOAdapter } from './adapters.js';
import { AuthError } from './errors.js';
import { AuthResponse, FileUploadResponse, HealthResponse, MessageRecord, RegisterResponse, RoomRecord } from './types.js';

export class HermesApi {
  constructor(
    private readonly baseUrl: string,
    private readonly files: FileIOAdapter
  ) {}

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  private async readJson<T>(response: Response, action: string, treat401AsAuthError: boolean): Promise<T> {
    if (response.status === 401 && treat401AsAuthError) {
      const text = await response.text();
      throw new AuthError(`${action} failed: 401 ${text}`.trim());
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${action} failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    return this.readJson<HealthResponse>(response, 'Health check', false);
  }

  async register(username: string, password: string): Promise<RegisterResponse> {
    const response = await fetch(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    return this.readJson<RegisterResponse>(response, 'Register', false);
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    return this.readJson<AuthResponse>(response, 'Login', false);
  }

  async listRooms(token: string): Promise<RoomRecord[]> {
    const response = await fetch(`${this.baseUrl}/rooms`, {
      headers: this.authHeaders(token),
    });
    return this.readJson<RoomRecord[]>(response, 'List rooms', true);
  }

  async listMessages(room: string, token: string): Promise<MessageRecord[]> {
    const response = await fetch(`${this.baseUrl}/messages?room=${encodeURIComponent(room)}`, {
      headers: this.authHeaders(token),
    });
    return this.readJson<MessageRecord[]>(response, 'List messages', true);
  }

  async createMessage(room: string, content: string, token: string): Promise<MessageRecord> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders(token) },
      body: JSON.stringify({ room, content }),
    });
    return this.readJson<MessageRecord>(response, 'Create message', true);
  }

  async uploadFile(room: string, filePath: string, token: string): Promise<FileUploadResponse> {
    const bytes = await this.files.readFile(filePath);
    const form = new FormData();
    form.append('room', room);
    form.append('file', new Blob([new Uint8Array(bytes)]), this.files.basename(filePath));

    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: this.authHeaders(token),
      body: form,
    });

    return this.readJson<FileUploadResponse>(response, 'Upload file', true);
  }

  async downloadFile(fileId: string, destination: string, token: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/files/${encodeURIComponent(fileId)}`, {
      headers: this.authHeaders(token),
    });

    if (response.status === 401) {
      const text = await response.text();
      throw new AuthError(`Download file failed: 401 ${text}`.trim());
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Download file failed: ${response.status} ${text}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await this.files.writeFile(destination, bytes);
    return destination;
  }
}
