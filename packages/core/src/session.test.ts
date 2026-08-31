import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileIO, MemoryTokenStore } from './adapters.js';
import { HermesApi } from './api.js';
import { AuthError } from './errors.js';
import { NodeTransport } from './node/index.js';
import { SessionController } from './session.js';
import { startFakeBackend } from './testing/index.js';
import { MessageRecord } from './types.js';
import { HermesWsClient } from './ws.js';

function createSession(baseUrl: string, tokens = new MemoryTokenStore()) {
  const api = new HermesApi(baseUrl, new MemoryFileIO());
  const ws = new HermesWsClient(baseUrl, new NodeTransport());
  return new SessionController({ baseUrl, api, ws, tokens, reconnectDelayMs: 40 });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for condition');
}

test('session de-duplicates the same message id from REST and the live broadcast', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  const session = createSession(backend.baseUrl);
  const seen: MessageRecord[] = [];
  session.on('message', (message) => seen.push(message));

  try {
    await session.login('alice', 'secret');
    await session.enterRoom('general');
    await waitFor(() => session.getConnectionStatus() === 'open');
    await session.sendMessage('hello once');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.content, 'hello once');
  } finally {
    session.shutdown();
    await backend.close();
  }
});

test('reconnect re-issues join_room', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  const session = createSession(backend.baseUrl);

  try {
    await session.login('alice', 'secret');
    await session.enterRoom('general');
    await waitFor(() => backend.joinCount >= 1);
    const before = backend.joinCount;
    backend.dropConnections();
    await waitFor(() => backend.joinCount > before);
    assert.ok(backend.joinCount > before);
  } finally {
    session.shutdown();
    await backend.close();
  }
});

test('a REST 401 clears the stored token', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  const tokens = new MemoryTokenStore();
  const session = createSession(backend.baseUrl, tokens);

  try {
    await session.login('alice', 'secret');
    const stored = await tokens.load();
    assert.ok(stored?.token);
    backend.revokeToken(stored.token);

    let expired = false;
    session.on('authExpired', ({ source }) => {
      if (source === 'rest') {
        expired = true;
      }
    });

    await assert.rejects(() => session.listRooms(), AuthError);
    assert.equal(expired, true);
    assert.equal(await tokens.load(), null);
    assert.equal(session.getState().token, null);
  } finally {
    session.shutdown();
    await backend.close();
  }
});

test('a WebSocket 401 clears the stored token', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  const tokens = new MemoryTokenStore();
  const session = createSession(backend.baseUrl, tokens);
  let expired = false;
  session.on('authExpired', ({ source }) => {
    if (source === 'ws') {
      expired = true;
    }
  });

  try {
    await session.login('alice', 'secret');
    const stored = await tokens.load();
    assert.ok(stored?.token);
    backend.revokeToken(stored.token);

    await assert.rejects(() => session.connect(), AuthError);
    assert.equal(expired, true);
    assert.equal(await tokens.load(), null);
    assert.equal(session.getState().token, null);
  } finally {
    session.shutdown();
    await backend.close();
  }
});

test('presence roster tracks room_users, joins and leaves', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  backend.seedUser('bob', 'secret');
  const alice = createSession(backend.baseUrl);
  const bob = createSession(backend.baseUrl);
  const aliceRosters: string[][] = [];
  alice.on('presence', ({ users }) => aliceRosters.push(users));

  try {
    await alice.login('alice', 'secret');
    await alice.enterRoom('general');
    await waitFor(() => alice.getState().roomUsers.includes('alice'));

    await bob.login('bob', 'secret');
    await bob.enterRoom('general');
    await waitFor(() => alice.getState().roomUsers.includes('bob'));
    assert.ok(alice.getState().roomUsers.includes('alice'));
    assert.ok(alice.getState().roomUsers.includes('bob'));

    bob.shutdown();
    await waitFor(() => !alice.getState().roomUsers.includes('bob'));
    assert.ok(aliceRosters.some((users) => users.includes('bob')));
  } finally {
    alice.shutdown();
    bob.shutdown();
    await backend.close();
  }
});

test('rooms, users, DMs and logout match the v0.6.0 REST surface', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  backend.seedUser('bob', 'secret');
  const session = createSession(backend.baseUrl);

  try {
    await session.login('alice', 'secret');
    const directory = await session.listUsers();
    assert.equal(directory.length, 2);
    const bob = directory.find((user) => user.username === 'bob');
    assert.ok(bob);

    const group = await session.createRoom('Test Group', [bob.id]);
    assert.equal(group.type, 'group');
    assert.ok(group.slug.startsWith('group:'));

    const dm = await session.createDm(bob.id);
    assert.equal(dm.type, 'dm');
    assert.equal(dm.slug, 'dm:alice:bob');

    const again = await session.createDm(bob.id);
    assert.equal(again.slug, dm.slug);

    const rooms = await session.listRooms();
    assert.ok(rooms.some((room) => room.slug === 'general' && room.type === 'group'));
    assert.ok(rooms.some((room) => room.slug === group.slug));
    assert.ok(rooms.some((room) => room.slug === dm.slug));

    await session.logout();
    assert.equal(session.getState().token, null);
    assert.deepEqual(await session.listRooms(), []);
  } finally {
    session.shutdown();
    await backend.close();
  }
});

test('resume returns false after a stored token is rejected with 401', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  const tokens = new MemoryTokenStore();
  await tokens.save({ username: 'alice', token: 'stale-token' });
  const session = createSession(backend.baseUrl, tokens);

  try {
    const resumed = await session.resume();
    assert.equal(resumed, false);
    assert.equal(await tokens.load(), null);
  } finally {
    session.shutdown();
    await backend.close();
  }
});
