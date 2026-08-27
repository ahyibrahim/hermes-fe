import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { AuthResponse, FileUploadResponse, HealthResponse, MessageRecord, RegisterResponse, RoomRecord } from './types.js';

export class HermesApi {
  constructor(private readonly baseUrl: string) {}

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return response.json() as Promise<HealthResponse>;
  }

  async register(username: string, password: string): Promise<RegisterResponse> {
    const response = await fetch(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Register failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<RegisterResponse>;
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Login failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<AuthResponse>;
  }

  async listRooms(token: string): Promise<RoomRecord[]> {
    const response = await fetch(`${this.baseUrl}/rooms`, {
      headers: this.authHeaders(token),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`List rooms failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<RoomRecord[]>;
  }

  async listMessages(room: string, token: string): Promise<MessageRecord[]> {
    const response = await fetch(`${this.baseUrl}/messages?room=${encodeURIComponent(room)}`, {
      headers: this.authHeaders(token),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`List messages failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<MessageRecord[]>;
  }

  async createMessage(room: string, content: string, token: string): Promise<MessageRecord> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders(token) },
      body: JSON.stringify({ room, content }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Create message failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<MessageRecord>;
  }

  async uploadFile(room: string, filePath: string, token: string): Promise<FileUploadResponse> {
    const bytes = await readFile(filePath);
    const form = new FormData();
    form.append('room', room);
    form.append('file', new Blob([new Uint8Array(bytes)]), basename(filePath));

    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: this.authHeaders(token),
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload file failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<FileUploadResponse>;
  }

  async downloadFile(fileId: string, destination: string, token: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/files/${encodeURIComponent(fileId)}`, {
      headers: this.authHeaders(token),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Download file failed: ${response.status} ${text}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, bytes);
    return destination;
  }
}
