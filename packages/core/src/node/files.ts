import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { FileIOAdapter } from '../adapters.js';

export class NodeFileIO implements FileIOAdapter {
  async readFile(path: string): Promise<Uint8Array> {
    const bytes = await readFile(path);
    return new Uint8Array(bytes);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await writeFile(path, data);
  }

  basename(path: string): string {
    return basename(path);
  }
}
