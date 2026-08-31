import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { StoredSession, TokenStorageAdapter } from '../adapters.js';

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? xdg : join(homedir(), '.config');
  return join(base, 'hermes', 'config.json');
}

function parseStoredSession(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(raw) as { username?: unknown; token?: unknown };
    if (typeof parsed.username === 'string' && parsed.username && typeof parsed.token === 'string' && parsed.token) {
      return { username: parsed.username, token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

export class NodeTokenStore implements TokenStorageAdapter {
  constructor(private readonly filePath: string = defaultConfigPath()) {}

  async load(): Promise<StoredSession | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return parseStoredSession(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      return null;
    }
  }

  async save(session: StoredSession): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await writeFile(this.filePath, `${JSON.stringify({ username: session.username, token: session.token })}\n`, {
      mode: 0o600,
    });
    await chmod(this.filePath, 0o600);
  }

  async clear(): Promise<void> {
    try {
      await rm(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
