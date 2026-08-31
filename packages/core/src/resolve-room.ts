import { RoomRecord } from './types.js';

export function resolveRoom(input: string, rooms: RoomRecord[]): { slug: string; members: string[] } {
  const trimmed = input.trim();
  const bySlug = rooms.find((room) => room.slug === trimmed);
  if (bySlug) {
    return { slug: bySlug.slug, members: bySlug.members ?? [] };
  }

  const byName = rooms.find((room) => room.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return { slug: byName.slug, members: byName.members ?? [] };
  }

  if (/^\d+$/.test(trimmed)) {
    const byId = rooms.find((room) => room.id === Number(trimmed));
    if (byId) {
      return { slug: byId.slug, members: byId.members ?? [] };
    }
  }

  return { slug: trimmed, members: [] };
}
