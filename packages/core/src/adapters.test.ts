import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BrowserFileIO,
  LOCAL_STORAGE_SESSION_KEY,
  LocalStorageTokenStore,
  StorageLike,
} from './adapters.js';

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

test('LocalStorageTokenStore round-trips a session', async () => {
  const storage = new MemoryStorage();
  const store = new LocalStorageTokenStore(LOCAL_STORAGE_SESSION_KEY, storage);

  assert.equal(await store.load(), null);
  await store.save({ username: 'alice', token: 'tok' });
  assert.deepEqual(await store.load(), { username: 'alice', token: 'tok' });
  assert.equal(storage.getItem(LOCAL_STORAGE_SESSION_KEY), '{"username":"alice","token":"tok"}');
  await store.clear();
  assert.equal(await store.load(), null);
});

test('LocalStorageTokenStore treats corrupt JSON as no session', async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_STORAGE_SESSION_KEY, '{not json');
  const store = new LocalStorageTokenStore(LOCAL_STORAGE_SESSION_KEY, storage);
  assert.equal(await store.load(), null);
});

test('LocalStorageTokenStore treats incomplete JSON as no session', async () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify({ username: 'alice' }));
  const store = new LocalStorageTokenStore(LOCAL_STORAGE_SESSION_KEY, storage);
  assert.equal(await store.load(), null);
});

test('LocalStorageTokenStore no-ops when storage is unavailable', async () => {
  const store = new LocalStorageTokenStore(LOCAL_STORAGE_SESSION_KEY, null);
  await store.save({ username: 'alice', token: 'tok' });
  assert.equal(await store.load(), null);
  await store.clear();
});

test('BrowserFileIO ingests a File-shaped object under its name', async () => {
  const files = new BrowserFileIO();
  const path = await files.ingest({
    name: 'note.txt',
    async arrayBuffer() {
      return new TextEncoder().encode('hello').buffer;
    },
  });

  assert.equal(path, 'note.txt');
  assert.equal(new TextDecoder().decode(await files.readFile(path)), 'hello');
  assert.equal(files.basename('/tmp/note.txt'), 'note.txt');
});
