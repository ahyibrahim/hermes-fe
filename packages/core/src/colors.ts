export const USER_COLOR_PALETTE = [
  'ember',
  'moss',
  'lake',
  'plum',
  'rust',
  'teal',
  'gold',
  'indigo',
  'rose',
  'slate',
] as const;

export type UserColor = (typeof USER_COLOR_PALETTE)[number];

export function isUserColor(value: string): value is UserColor {
  return (USER_COLOR_PALETTE as readonly string[]).includes(value);
}

export function nextUserColor(taken: Iterable<string | null | undefined>): UserColor {
  const used = new Set(
    [...taken].filter((value): value is string => typeof value === 'string' && value.length > 0)
  );
  const free = USER_COLOR_PALETTE.find((color) => !used.has(color));
  if (free) {
    return free;
  }
  return USER_COLOR_PALETTE[used.size % USER_COLOR_PALETTE.length] as UserColor;
}
