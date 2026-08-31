import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NodeTokenStore } from './token-store.js';

async function tempConfigPath(name: string): Promise<string> {
  const dir = join(tmpdir(), `hermes-token-${process.pid}-${Date.now()}-${name}`);
  await mkdir(dir, { recursive: true });
  return join(dir, 'config.json');
}

test('NodeTokenStore writes config.json with mode 0600', async () => {
  const path = await tempConfigPath('0600');
  const store = new NodeTokenStore(path);
  await store.save({ username: 'alice', token: 'secret-token' });

  const raw = await readFile(path, 'utf8');
  assert.deepEqual(JSON.parse(raw), { username: 'alice', token: 'secret-token' });
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('NodeTokenStore treats a missing file as no session', async () => {
  const store = new NodeTokenStore(join(tmpdir(), `hermes-missing-${process.pid}-${Date.now()}.json`));
  assert.equal(await store.load(), null);
});

test('NodeTokenStore treats a corrupt file as no session', async () => {
  const path = await tempConfigPath('corrupt');
  await writeFile(path, '{not json', { mode: 0o600 });
  const store = new NodeTokenStore(path);
  assert.equal(await store.load(), null);
});

test('NodeTokenStore treats a JSON file missing token fields as no session', async () => {
  const path = await tempConfigPath('incomplete');
  await writeFile(path, JSON.stringify({ username: 'alice' }), { mode: 0o600 });
  const store = new NodeTokenStore(path);
  assert.equal(await store.load(), null);
});

test('NodeTokenStore clear removes the file', async () => {
  const path = await tempConfigPath('clear');
  const store = new NodeTokenStore(path);
  await store.save({ username: 'alice', token: 'tok' });
  await store.clear();
  assert.equal(await store.load(), null);
});
