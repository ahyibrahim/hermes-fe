import type { Interface } from 'node:readline/promises';
import * as readline from 'node:readline';
import { stdout as output } from 'node:process';

export function printAbovePrompt(rl: Interface, line: string): void {
  readline.clearLine(output, 0);
  readline.cursorTo(output, 0);
  output.write(`${line}\n`);
  rl.prompt(true);
}

type WritableInterface = Interface & {
  _writeToOutput?: (stringToWrite: string) => void;
  output?: NodeJS.WritableStream;
};

export async function questionPassword(rl: Interface, query: string): Promise<string> {
  const mutableRl = rl as WritableInterface;
  const outputStream = mutableRl.output ?? output;
  const originalWrite = mutableRl._writeToOutput?.bind(mutableRl);

  mutableRl._writeToOutput = (stringToWrite: string) => {
    if (/\r|\n/.test(stringToWrite)) {
      outputStream.write('\n');
      return;
    }

    if (stringToWrite === query || stringToWrite.startsWith(query)) {
      outputStream.write(query);
    }
  };

  try {
    return await rl.question(query);
  } finally {
    if (originalWrite) {
      mutableRl._writeToOutput = originalWrite;
    } else {
      delete mutableRl._writeToOutput;
    }
  }
}
