import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MemoryFileIO } from '../adapters.js';
import { HermesApi } from '../api.js';
import { startFakeBackend } from '../testing/index.js';
import { NodeFileIO } from './files.js';

test('NodeFileIO round-trips bytes on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hermes-fileio-'));
  const path = join(dir, 'note.txt');
  const io = new NodeFileIO();
  const payload = new TextEncoder().encode('hello from disk');

  await io.writeFile(path, payload);
  const read = await io.readFile(path);
  assert.equal(io.basename(path), 'note.txt');
  assert.equal(Buffer.from(read).toString('utf8'), 'hello from disk');
  assert.equal(await readFile(path, 'utf8'), 'hello from disk');
});

test('MemoryFileIO stores uploads for the REST file adapter', async () => {
  const files = new MemoryFileIO();
  files.files.set('local.txt', new TextEncoder().encode('from memory'));
  assert.equal(files.basename('/tmp/local.txt'), 'local.txt');
  assert.equal(Buffer.from(await files.readFile('local.txt')).toString('utf8'), 'from memory');
});

test('HermesApi upload and download go through the file adapter', async () => {
  const backend = await startFakeBackend();
  backend.seedUser('alice', 'secret');
  const files = new MemoryFileIO();
  files.files.set('upload.bin', new Uint8Array([1, 2, 3, 4]));
  const api = new HermesApi(backend.baseUrl, files);

  try {
    const auth = await api.login('alice', 'secret');
    const uploaded = await api.uploadFile('general', 'upload.bin', auth.token);
    assert.ok(uploaded.file.id);
    const dest = 'downloaded.bin';
    const saved = await api.downloadFile(String(uploaded.file.id), dest, auth.token);
    assert.equal(saved, dest);
    assert.deepEqual([...files.files.get(dest)!], [1, 2, 3, 4]);
  } finally {
    await backend.close();
  }
});
