import { HermesApi, HermesWsClient, MemoryFileIO, MemoryTokenStore, SessionController } from '@hermes/core';
import { NodeTransport } from '@hermes/core/node';
import { startFakeBackend, type FakeBackend } from '@hermes/core/testing';

let session: SessionController | null = null;
let files = new MemoryFileIO();
let tokens = new MemoryTokenStore();

export function currentSession(): SessionController {
  if (!session) {
    throw new Error('no test session; call bootBackend() and signIn() first');
  }
  return session;
}

export function currentFileIO(): MemoryFileIO {
  return files;
}

export function currentTokens(): MemoryTokenStore {
  return tokens;
}

export function createSession(baseUrl: string, store = new MemoryTokenStore()): SessionController {
  const api = new HermesApi(baseUrl, new MemoryFileIO());
  const ws = new HermesWsClient(baseUrl, new NodeTransport());
  return new SessionController({ baseUrl, api, ws, tokens: store, reconnectDelayMs: 40 });
}

export type TestWorld = {
  backend: FakeBackend;
  /** The session ChatShell sees through `$lib/client`. */
  me: SessionController;
  /** Other signed-in users driven from the test. */
  others: Map<string, SessionController>;
  userId(name: string): Promise<number>;
  close(): Promise<void>;
};

export async function bootWorld(meName: string, otherNames: string[] = []): Promise<TestWorld> {
  const backend = await startFakeBackend();
  const password = 'secret';
  backend.seedUser(meName, password);
  for (const name of otherNames) {
    backend.seedUser(name, password);
  }

  files = new MemoryFileIO();
  tokens = new MemoryTokenStore();
  const me = createSession(backend.baseUrl, tokens);
  await me.login(meName, password);
  session = me;

  const others = new Map<string, SessionController>();
  for (const name of otherNames) {
    const other = createSession(backend.baseUrl);
    await other.login(name, password);
    others.set(name, other);
  }

  return {
    backend,
    me,
    others,
    async userId(name: string) {
      const found = (await me.listUsers()).find((user) => user.username === name);
      if (!found) {
        throw new Error(`unknown user ${name}`);
      }
      return found.id;
    },
    async close() {
      backend.resumeMessageLists();
      me.shutdown();
      for (const other of others.values()) {
        other.shutdown();
      }
      session = null;
      await backend.close();
    },
  };
}
