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

test('profile password change and avatar round-trip match the v0.7.0 REST surface', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  const session = createSession(backend.baseUrl);
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  );

  try {
    await session.login('alice', 'secret');
    const me = await session.getMe();
    assert.equal(me?.username, 'alice');
    assert.equal(me?.role, 'admin');
    assert.equal(me?.avatar_file_id, null);

    await session.changePassword('secret', 'next-secret');
    const stillMe = await session.getMe();
    assert.equal(stillMe?.username, 'alice');

    const uploaded = await session.uploadAvatar(new Blob([png], { type: 'image/png' }), 'me.png');
    assert.ok(uploaded.avatar_file_id);
    const bytes = await session.fetchAvatar(uploaded.id);
    assert.deepEqual(Buffer.from(bytes), Buffer.from(png));
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

test('call signaling relays an offer only to the target and clears on disconnect', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  backend.seedUser('bob', 'secret');
  backend.seedUser('carol', 'secret');
  const alice = createSession(backend.baseUrl);
  const bob = createSession(backend.baseUrl);
  const carol = createSession(backend.baseUrl);

  const bobOffers: Array<{ from: string; sdp: { sdp?: string } }> = [];
  const carolFrames: string[] = [];
  const bobLeft: string[] = [];

  bob.on('callOffer', (payload) => bobOffers.push(payload));
  carol.on('callOffer', () => carolFrames.push('offer'));
  carol.on('userJoinedCall', () => carolFrames.push('joined'));
  bob.on('userLeftCall', ({ user }) => bobLeft.push(user));

  try {
    await alice.login('alice', 'secret');
    await bob.login('bob', 'secret');
    await carol.login('carol', 'secret');
    await alice.enterRoom('general');
    await bob.enterRoom('general');
    await carol.enterRoom('general');
    await waitFor(() => alice.getConnectionStatus() === 'open');

    const ice = await alice.getIce();
    assert.ok(Array.isArray(ice.iceServers));
    assert.ok(ice.iceServers.length > 0);

    const alicePeers: string[][] = [];
    alice.on('callPeers', ({ users }) => alicePeers.push(users));
    const bobJoined: string[] = [];
    alice.on('userJoinedCall', ({ user }) => bobJoined.push(user));

    await alice.joinCall('general');
    await waitFor(() => alicePeers.some((users) => users.includes('alice')));
    await bob.joinCall('general');
    await waitFor(() => bobJoined.includes('bob'));

    alice.sendCallOffer('general', 'bob', { type: 'offer', sdp: 'v=0-test' });
    await waitFor(() => bobOffers.length === 1);
    assert.equal(bobOffers[0]?.from, 'alice');
    assert.equal(bobOffers[0]?.sdp.sdp, 'v=0-test');

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(carolFrames.length, 0);

    alice.shutdown();
    await waitFor(() => bobLeft.includes('alice'));
  } finally {
    alice.shutdown();
    bob.shutdown();
    carol.shutdown();
    await backend.close();
  }
});

test('off-room member fan-out emits roomActivity and does not append to the open transcript', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  backend.seedUser('bob', 'secret');
  const alice = createSession(backend.baseUrl);
  const bob = createSession(backend.baseUrl);
  const activity: Array<{ room: string; content: string }> = [];
  alice.on('roomActivity', ({ room, message }) => activity.push({ room, content: message.content }));

  try {
    await alice.login('alice', 'secret');
    await bob.login('bob', 'secret');
    const users = await alice.listUsers();
    const bobId = users.find((user) => user.username === 'bob')?.id as number;
    const room = await alice.createRoom('offroom', [bobId]);
    await alice.enterRoom('general');
    await bob.enterRoom(room.slug);
    await waitFor(() => alice.getConnectionStatus() === 'open');
    await bob.sendMessage('secret ping');
    await waitFor(() => activity.length === 1);
    assert.equal(activity[0]?.room, room.slug);
    assert.equal(activity[0]?.content, 'secret ping');
    assert.equal(
      alice.getState().messages.some((message) => message.content === 'secret ping'),
      false
    );
  } finally {
    alice.shutdown();
    bob.shutdown();
    await backend.close();
  }
});
