import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as readline from 'node:readline/promises';
import { PassThrough } from 'node:stream';
import { questionPassword, PasswordCancelReason, PasswordInputStream } from './terminal.js';

type FakeInput = PassThrough & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

interface Harness {
  input: FakeInput;
  rl: readline.Interface;
  written: () => string;
  rawModeCalls: boolean[];
  cancels: PasswordCancelReason[];
  ask: (query?: string) => Promise<string>;
  close: () => void;
}

function createHarness(options: { tty: boolean }): Harness {
  const input: FakeInput = new PassThrough();
  const output = new PassThrough();
  const rawModeCalls: boolean[] = [];
  const cancels: PasswordCancelReason[] = [];

  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
  });

  if (options.tty) {
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (mode: boolean) => {
      input.isRaw = mode;
      rawModeCalls.push(mode);
      return input;
    };
  }

  const rl = readline.createInterface({ input, output, terminal: options.tty });

  return {
    input,
    rl,
    written: () => written,
    rawModeCalls,
    cancels,
    ask: (query = 'Password: ') =>
      questionPassword(rl, query, {
        input: input as PasswordInputStream,
        output,
        onCancel: (reason) => {
          cancels.push(reason);
        },
      }),
    close: () => rl.close(),
  };
}

test('returns exactly what was typed and masks it on the way out', async () => {
  const harness = createHarness({ tty: true });
  const secret = 'correct horse battery staple';

  const pending = harness.ask();
  harness.input.write(`${secret}\r`);
  const result = await pending;
  harness.close();

  assert.equal(result, secret);
  assert.ok(harness.written().includes('Password: '), 'the prompt is written to the output');
  assert.ok(
    !harness.written().includes(secret),
    `the plaintext password must never reach the output stream, got ${JSON.stringify(harness.written())}`
  );
  assert.ok(harness.written().includes('*'.repeat(secret.length)), 'one mask character per typed character');
});

test('never leaks even a fragment of the password to the output', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('hunter2\n');
  const result = await pending;
  harness.close();

  assert.equal(result, 'hunter2');
  const output = harness.written().replace('Password: ', '');
  assert.ok(!/[a-z0-9]/i.test(output), `no typed character may be echoed, got ${JSON.stringify(output)}`);
});

test('puts the tty in raw mode and restores the previous mode afterwards', async () => {
  const harness = createHarness({ tty: true });
  const rawBefore = harness.input.isRaw;
  harness.rawModeCalls.length = 0;

  const pending = harness.ask();
  harness.input.write('s3cret\r');
  await pending;

  assert.ok(harness.rawModeCalls.includes(true), 'raw mode is enabled while reading');
  assert.equal(harness.input.isRaw, rawBefore, 'the previous raw mode is restored');
  harness.close();
});

test('backspace removes the last character', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('abcX\u007f\r');
  const result = await pending;
  harness.close();

  assert.equal(result, 'abc');
  assert.ok(!harness.written().includes('abc'));
});

test('ctrl-h backspace also removes the last character and cannot go below empty', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('\b\b\bab\b\r');
  const result = await pending;
  harness.close();

  assert.equal(result, 'a');
});

test('reads without masking when the stream is not a tty', async () => {
  const harness = createHarness({ tty: false });

  const pending = harness.ask();
  harness.input.write('piped-password\n');
  const result = await pending;
  harness.close();

  assert.equal(result, 'piped-password');
  assert.equal(harness.written(), 'Password: \n');
  assert.equal(harness.rawModeCalls.length, 0, 'setRawMode is not attempted on a non-tty');
});

test('ignores control characters and arrow keys instead of inserting them', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('pa\u001b[Ass\u001b[3~w\u0000ord\r');
  const result = await pending;
  harness.close();

  assert.equal(result, 'password');
});

test('handles a paste arriving as one chunk with a trailing newline', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('pasted-secret\r\n');
  const result = await pending;
  harness.close();

  assert.equal(result, 'pasted-secret');
});

test('handles multi-byte characters split across chunks', async () => {
  const harness = createHarness({ tty: true });
  const secret = 'pässwörd-日本';
  const bytes = Buffer.from(secret, 'utf8');

  const pending = harness.ask();
  harness.input.write(bytes.subarray(0, 3));
  harness.input.write(bytes.subarray(3, 9));
  harness.input.write(bytes.subarray(9));
  harness.input.write('\r');
  const result = await pending;
  harness.close();

  assert.equal(result, secret);
  assert.ok(!harness.written().includes(secret));
});

test('ctrl-c cancels the prompt the way the client shuts down', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('half\u0003');
  await assert.rejects(pending, /interrupted/);
  harness.close();

  assert.deepEqual(harness.cancels, ['SIGINT']);
  assert.ok(!harness.written().includes('half'));
});

test('ctrl-d on an empty buffer is treated as end of input', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('\u0004');
  await assert.rejects(pending, /end of input/);
  harness.close();

  assert.deepEqual(harness.cancels, ['EOF']);
});

test('ctrl-d with a buffered password is ignored', async () => {
  const harness = createHarness({ tty: true });

  const pending = harness.ask();
  harness.input.write('keepme\u0004\r');
  const result = await pending;
  harness.close();

  assert.equal(result, 'keepme');
  assert.deepEqual(harness.cancels, []);
});

test('leaves readline usable for the next question', async () => {
  const harness = createHarness({ tty: false });

  const pending = harness.ask();
  harness.input.write('secret\n');
  const password = await pending;

  const nextPending = harness.rl.question('Room: ');
  harness.input.write('general\n');
  const next = await nextPending;
  harness.close();

  assert.equal(password, 'secret');
  assert.equal(next, 'general');
  assert.ok(!harness.written().includes('secret'));
});

test('hands input typed after the newline back to the stream', async () => {
  // The readline interface deliberately sits on other streams here, so that
  // nothing else consumes the leftover bytes before the assertion.
  const input: FakeInput = new PassThrough();
  const output = new PassThrough();
  const rl = readline.createInterface({ input: new PassThrough(), output: new PassThrough() });

  const pending = questionPassword(rl, 'Password: ', { input: input as PasswordInputStream, output });
  input.write('secret\nleftover-line\n');
  const password = await pending;
  rl.close();

  assert.equal(password, 'secret');
  assert.equal(String(input.read()), 'leftover-line\n');
});
