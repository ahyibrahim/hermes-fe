import { formatTranscriptTimestamp, type PublicUser, type SessionController } from '@hermes/core';

type CacheEntry = { url: string | null; inflight?: Promise<string | null> };

const cache = new Map<number, CacheEntry>();

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
