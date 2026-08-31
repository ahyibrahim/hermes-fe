import {
  BrowserFileIO,
  BrowserTransport,
  HermesApi,
  HermesWsClient,
  LocalStorageTokenStore,
  SessionController,
} from '@hermes/core';
import { getApiBaseUrl } from './base-url';

let session: SessionController | undefined;
let files: BrowserFileIO | undefined;
let tokens: LocalStorageTokenStore | undefined;

export function getFileIO(): BrowserFileIO {
  files ??= new BrowserFileIO();
  return files;
}

export function getTokens(): LocalStorageTokenStore {
  tokens ??= new LocalStorageTokenStore();
  return tokens;
}

export function getSession(): SessionController {
  if (!session) {
    const baseUrl = getApiBaseUrl();
    const fileIO = getFileIO();
    session = new SessionController({
      baseUrl,
      api: new HermesApi(baseUrl, fileIO),
      ws: new HermesWsClient(baseUrl, new BrowserTransport()),
      tokens: getTokens(),
    });
  }

  return session;
}

export function resetClient(): void {
  session?.shutdown();
  session = undefined;
  files = undefined;
  tokens = undefined;
}

export async function signOut(): Promise<void> {
  session?.shutdown();
  await getTokens().clear();
  resetClient();
}

export async function downloadAttachment(fileId: string, filename?: string): Promise<void> {
  const fileIO = getFileIO();
  const dest = filename && filename.trim() ? filename.trim() : `file-${fileId}`;
  const saved = await getSession().getFile(fileId, dest);
  const path = saved || dest;
  const bytes = await fileIO.readFile(path);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileIO.basename(path);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
