import { formatTranscriptTimestamp, type LinkPreview, type PublicUser, type SessionController } from '@hermes/core';

type CacheEntry = { url: string | null; inflight?: Promise<string | null> };

const MAX_MD_PREVIEW_BYTES = 200 * 1024;
export type MdPreviewResult = { html: string; truncated: boolean } | null;

const cache = new Map<number, CacheEntry>();
const linkPreviewCache = new Map<string, LinkPreview | null>();
const linkPreviewInflight = new Map<string, Promise<LinkPreview | null>>();
const mdPreviewCache = new Map<string, MdPreviewResult>();
const mdPreviewInflight = new Map<string, Promise<MdPreviewResult>>();

export function getCachedMdPreview(fileId: string | number): MdPreviewResult | undefined {
  return mdPreviewCache.get(String(fileId));
}

export async function loadMdPreview(
  session: SessionController,
  fileId: string | number,
  filename: string
): Promise<MdPreviewResult> {
  const id = String(fileId);
  if (mdPreviewCache.has(id)) {
    return mdPreviewCache.get(id) ?? null;
  }
  const inflight = mdPreviewInflight.get(id);
  if (inflight) {
    return inflight;
  }
  const promise = (async () => {
    try {
      const { bytes, mime } = await session.fetchFile(id);
      const isMd = (() => {
        const type = mime.toLowerCase().split(';')[0].trim();
        if (type === 'text/markdown' || type === 'text/x-markdown') {
          return true;
        }
        return /\.(md|markdown)$/i.test(filename);
      })();
      if (!isMd) {
        mdPreviewCache.set(id, null);
        return null;
      }
      const slice =
        bytes.byteLength > MAX_MD_PREVIEW_BYTES ? bytes.slice(0, MAX_MD_PREVIEW_BYTES) : bytes;
      const truncated = bytes.byteLength > MAX_MD_PREVIEW_BYTES;
      const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      const [{ marked }, DOMPurifyMod] = await Promise.all([import('marked'), import('dompurify')]);
      const purify = DOMPurifyMod.default;
      const rendered = marked.parse(text, { async: false }) as string;
      const html = purify.sanitize(rendered, {
        USE_PROFILES: { html: true },
      });
      const res: MdPreviewResult = { html, truncated };
      mdPreviewCache.set(id, res);
      return res;
    } catch {
      mdPreviewCache.set(id, null);
      return null;
    } finally {
      mdPreviewInflight.delete(id);
    }
  })();
  mdPreviewInflight.set(id, promise);
  return promise;
}

export function getCachedLinkPreview(url: string): LinkPreview | null | undefined {
  return linkPreviewCache.get(url);
}

export async function loadLinkPreview(
  session: SessionController,
  url: string
): Promise<LinkPreview | null> {
  if (linkPreviewCache.has(url)) {
    return linkPreviewCache.get(url) ?? null;
  }
  const inflight = linkPreviewInflight.get(url);
  if (inflight) {
    return inflight;
  }
  const promise = (async () => {
    try {
      const res = await session.getLinkPreview(url);
      linkPreviewCache.set(url, res);
      return res;
    } catch {
      linkPreviewCache.set(url, null);
      return null;
    } finally {
      linkPreviewInflight.delete(url);
    }
  })();
  linkPreviewInflight.set(url, promise);
  return promise;
}

export function portal(node: HTMLElement, target: HTMLElement = document.body) {
  target.appendChild(node);
  return {
    destroy() {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    },
  };
}

export function forgetAvatar(userId: number): void {
  const entry = cache.get(userId);
  if (entry?.url) {
    URL.revokeObjectURL(entry.url);
  }
  cache.delete(userId);
}

export async function loadAvatarUrl(
  session: SessionController,
  user: PublicUser | null | undefined
): Promise<string | null> {
  if (!user?.avatar_file_id) {
    return null;
  }

  const hit = cache.get(user.id);
  if (hit && !hit.inflight) {
    return hit.url;
  }
  if (hit?.inflight) {
    return hit.inflight;
  }

  const inflight = (async () => {
    try {
      const bytes = await session.fetchAvatar(user.id);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const url = URL.createObjectURL(new Blob([copy]));
      cache.set(user.id, { url });
      return url;
    } catch {
      cache.set(user.id, { url: null });
      return null;
    }
  })();

  cache.set(user.id, { url: null, inflight });
  return inflight;
}

export function colorClass(color: string | null | undefined): string {
  return color ? `user-color-${color}` : '';
}

export function isSystemUser(user: PublicUser | null | undefined): boolean {
  return Boolean(user?.system);
}

export function formatUnread(count: number | undefined): string {
  const n = count ?? 0;
  if (n <= 0) {
    return '';
  }
  return n > 99 ? '99+' : String(n);
}

export function formatMessageTime(value: string): string {
  return formatTranscriptTimestamp(value);
}

export const RAIL_ROOMS_KEY = 'hermes.rail.roomsCollapsed';
export const RAIL_PEOPLE_KEY = 'hermes.rail.peopleCollapsed';
export const NOTIFY_MUTE_KEY = 'hermes.notify.muted';

/** Below the old `.shell { min-width: 48rem }` floor. Keep in sync with comments in app.css. */
export const PHONE_MAX_WIDTH_MQ = '(max-width: 47.99rem)';

export function isPhoneViewport(mql?: { matches: boolean }): boolean {
  if (mql) {
    return mql.matches;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(PHONE_MAX_WIDTH_MQ).matches;
}

function draftKey(slug: string): string {
  return `hermes.draft.${slug}`;
}

export function loadDraft(slug: string): string {
  try {
    return localStorage.getItem(draftKey(slug)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(slug: string, text: string): void {
  try {
    if (text) {
      localStorage.setItem(draftKey(slug), text);
    } else {
      localStorage.removeItem(draftKey(slug));
    }
  } catch {
    // Private-mode quota should not break the composer.
  }
}

export function clearDraft(slug: string): void {
  try {
    localStorage.removeItem(draftKey(slug));
  } catch {
    // ignore
  }
}

export function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Private-mode quota should not break the rails.
  }
}

export function readNotifyMuted(): boolean {
  try {
    return localStorage.getItem(NOTIFY_MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeNotifyMuted(muted: boolean): void {
  try {
    if (muted) {
      localStorage.setItem(NOTIFY_MUTE_KEY, '1');
    } else {
      localStorage.removeItem(NOTIFY_MUTE_KEY);
    }
  } catch {
    // Private-mode quota should not break notifications.
  }
}
