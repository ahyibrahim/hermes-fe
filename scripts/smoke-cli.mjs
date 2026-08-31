#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeBackend } from '../packages/core/dist/testing/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cliPath = join(root, 'apps/cli/dist/cli.js');

function collect(child) {
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  return () => output;
}

function waitFor(getOutput, pattern, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (pattern.test(getOutput())) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${pattern}. output:\n${getOutput()}`));
      }
    }, 40);
  });
}

function runCli(env) {
  const child = spawn(process.execPath, [cliPath], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = collect(child);
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output: output() }));
  });
  return { child, output, finished };
}

async function sendAfter(child, output, pattern, line) {
  await waitFor(output, pattern);
  child.stdin.write(`${line}\n`);
}

async function main() {
  const backend = await startFakeBackend();
  const configHome = join(tmpdir(), `hermes-smoke-${process.pid}-${Date.now()}`);
  await mkdir(join(configHome, 'hermes'), { recursive: true });
  const env = {
    HERMES_BASE_URL: backend.baseUrl,
    XDG_CONFIG_HOME: configHome,
  };

  try {
    const first = runCli(env, []);
    await sendAfter(first.child, first.output, /Login \(l\) or register \(r\)\?/, 'r');
    await sendAfter(first.child, first.output, /Username:/, 'alice');
    await sendAfter(first.child, first.output, /Password:/, 'secret');
    await sendAfter(first.child, first.output, /Room \(id or slug\):/, 'general');
    await sendAfter(first.child, first.output, /Type a message/, 'hello once');
    await sendAfter(first.child, first.output, /alice: hello once/, '/health');
    await sendAfter(first.child, first.output, /"status": "ok"/, '/quit');
    const firstResult = await first.finished;
    if (firstResult.code !== 0) {
      throw new Error(`first CLI run exited ${firstResult.code}\n${firstResult.output}`);
    }
    if (!firstResult.output.includes('Logged in as alice')) {
      throw new Error(`first run missing login confirmation\n${firstResult.output}`);
    }
    if (!firstResult.output.includes('hello once')) {
      throw new Error(`first run missing sent message\n${firstResult.output}`);
    }
    if (!firstResult.output.includes('hermes-fake')) {
      throw new Error(`first run missing /health output\n${firstResult.output}`);
    }

    const tokenPath = join(configHome, 'hermes', 'config.json');
    const mode = (await stat(tokenPath)).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`token file mode is ${mode.toString(8)}, expected 600`);
    }
    const stored = JSON.parse(await readFile(tokenPath, 'utf8'));
    if (stored.username !== 'alice' || !stored.token) {
      throw new Error(`token file contents unexpected: ${JSON.stringify(stored)}`);
    }
    console.log('smoke: login, room, send, slash command, and 0600 token file ok');

    const second = runCli(env, []);
    await sendAfter(second.child, second.output, /Room \(id or slug\):/, 'general');
    await sendAfter(second.child, second.output, /Type a message/, '/quit');
    const secondResult = await second.finished;
    if (secondResult.code !== 0) {
      throw new Error(`restart CLI run exited ${secondResult.code}\n${secondResult.output}`);
    }
    if (/Login \(l\) or register \(r\)\?/.test(secondResult.output)) {
      throw new Error(`restart prompted for login\n${secondResult.output}`);
    }
    if (!secondResult.output.includes('Logged in as alice')) {
      throw new Error(`restart did not reuse the stored session\n${secondResult.output}`);
    }
    console.log('smoke: restart without login prompt ok');

    await writeFile(tokenPath, '{not-json', { mode: 0o600 });
    const third = runCli(env, []);
    await sendAfter(third.child, third.output, /Login \(l\) or register \(r\)\?/, 'l');
    await sendAfter(third.child, third.output, /Username:/, 'alice');
    await sendAfter(third.child, third.output, /Password:/, 'secret');
    await sendAfter(third.child, third.output, /Room \(id or slug\):/, 'general');
    await sendAfter(third.child, third.output, /Type a message/, '/quit');
    const thirdResult = await third.finished;
    if (thirdResult.code !== 0) {
      throw new Error(`corrupt-token CLI run exited ${thirdResult.code}\n${thirdResult.output}`);
    }
    if (!/Login \(l\) or register \(r\)\?/.test(thirdResult.output)) {
      throw new Error(`corrupt token did not fall back to login\n${thirdResult.output}`);
    }
    console.log('smoke: corrupt token falls back to login prompt ok');
    console.log('CLI smoke test passed.');
  } finally {
    await backend.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
