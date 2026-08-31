import type { Interface } from 'node:readline/promises';
import * as readline from 'node:readline';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { StringDecoder } from 'node:string_decoder';

export function printAbovePrompt(rl: Interface, line: string): void {
  readline.clearLine(processStdout, 0);
  readline.cursorTo(processStdout, 0);
  processStdout.write(`${line}\n`);
  rl.prompt(true);
}

const ESC = '\u001b';
const ETX = '\u0003';
const EOT = '\u0004';
const BACKSPACE = '\b';
const DELETE = '\u007f';
const CR = '\r';
const LF = '\n';

export type PasswordCancelReason = 'SIGINT' | 'EOF';

export type PasswordInputStream = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  unshift?: (chunk: string | Uint8Array, encoding?: BufferEncoding) => void;
};

export interface PasswordPromptOptions {
  input?: PasswordInputStream;
  output?: NodeJS.WritableStream;
  mask?: string;
  onCancel?: (reason: PasswordCancelReason) => void;
}

type StreamListener = (...args: unknown[]) => void;

/**
 * Detaches every listener readline has on the input stream and returns a
 * function that puts them back. `rl.pause()` on its own is not enough: a paused
 * Interface still runs its keypress handler, and that handler echoes whatever
 * is typed, so resuming the stream underneath it would print the password.
 */
function suppressReadlineInput(input: PasswordInputStream): () => void {
  const dataListeners = input.listeners('data') as StreamListener[];
  const keypressListeners = input.listeners('keypress') as StreamListener[];

  for (const listener of dataListeners) {
    input.removeListener('data', listener);
  }
  for (const listener of keypressListeners) {
    input.removeListener('keypress', listener);
  }

  return () => {
    for (const listener of dataListeners) {
      input.on('data', listener);
    }
    for (const listener of keypressListeners) {
      input.on('keypress', listener);
    }
  };
}

/** Returns the index of the last character belonging to an escape sequence. */
function endOfEscapeSequence(chars: string[], start: number): number {
  let index = start + 1;
  const introducer = chars[index];

  if (introducer === '[' || introducer === 'O') {
    index += 1;
    while (index < chars.length && /[0-9;?]/.test(chars[index] as string)) {
      index += 1;
    }
    if (index < chars.length) {
      index += 1;
    }
  } else if (introducer !== undefined) {
    index += 1;
  }

  return index - 1;
}

function isPrintable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

/**
 * Reads a password without echoing it. Uses only public API: the readline
 * interface is paused and detached from the input stream, the stream is put in
 * raw mode when it is a TTY, and keystrokes are assembled here so that a mask
 * character can be echoed instead of the character typed.
 */
export async function questionPassword(
  rl: Interface,
  query: string,
  options: PasswordPromptOptions = {}
): Promise<string> {
  const input = options.input ?? (processStdin as PasswordInputStream);
  const output = options.output ?? processStdout;
  const mask = options.mask ?? '*';
  const onCancel =
    options.onCancel ??
    ((): void => {
      rl.close();
      process.exit(0);
    });

  const canMask = Boolean(input.isTTY) && typeof input.setRawMode === 'function';
  const previousRawMode = input.isRaw === true;

  rl.pause();
  const restoreReadlineInput = suppressReadlineInput(input);
  if (canMask) {
    input.setRawMode?.(true);
  }
  output.write(query);

  const decoder = new StringDecoder('utf8');
  let password = '';
  let settled = false;
  let onData: (chunk: Buffer | string) => void = () => {};
  let onEnd: () => void = () => {};
  let onError: (error: Error) => void = () => {};

  try {
    return await new Promise<string>((resolve, reject) => {
      const stopReading = (): void => {
        input.removeListener('data', onData);
        input.pause();
      };

      const submit = (remainder: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        stopReading();
        // Anything typed or pasted after the newline belongs to whoever reads
        // next, so hand it back to the stream instead of dropping it.
        if (remainder.length > 0 && typeof input.unshift === 'function') {
          input.unshift(remainder, 'utf8');
        }
        output.write(LF);
        resolve(password);
      };

      const cancel = (reason: PasswordCancelReason): void => {
        if (settled) {
          return;
        }
        settled = true;
        stopReading();
        output.write(LF);
        onCancel(reason);
        reject(
          new Error(
            reason === 'SIGINT' ? 'Password entry interrupted.' : 'Password entry reached end of input.'
          )
        );
      };

      onData = (chunk) => {
        const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        const chars = Array.from(text);

        for (let index = 0; index < chars.length; index += 1) {
          const char = chars[index] as string;

          if (char === ESC) {
            index = endOfEscapeSequence(chars, index);
            continue;
          }

          if (char === CR || char === LF) {
            submit(chars.slice(index + 1).join(''));
            return;
          }

          if (char === DELETE || char === BACKSPACE) {
            if (password.length > 0) {
              password = Array.from(password).slice(0, -1).join('');
              if (canMask) {
                output.write('\b \b');
              }
            }
            continue;
          }

          if (char === ETX) {
            cancel('SIGINT');
            return;
          }

          if (char === EOT) {
            if (password.length === 0) {
              cancel('EOF');
              return;
            }
            continue;
          }

          if (!isPrintable(char)) {
            continue;
          }

          password += char;
          if (canMask) {
            output.write(mask);
          }
        }
      };

      onEnd = () => {
        if (password.length > 0) {
          submit('');
          return;
        }
        cancel('EOF');
      };

      onError = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        stopReading();
        reject(error);
      };

      input.on('data', onData);
      input.once('end', onEnd);
      input.once('error', onError);
      input.resume();
    });
  } finally {
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('error', onError);
    if (canMask) {
      input.setRawMode?.(previousRawMode);
    }
    restoreReadlineInput();
    rl.resume();
  }
}
