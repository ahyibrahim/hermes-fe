export const USER_ROLES = ['guest', 'member', 'admin', 'master'] as const;

export type UserRole = (typeof USER_ROLES)[number];

const RANK: Record<UserRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  master: 3,
};

export function roleRank(role: string | null | undefined): number {
  if (role && Object.prototype.hasOwnProperty.call(RANK, role)) {
    return RANK[role as UserRole];
  }
  return RANK.guest;
}

export function roleAtLeast(role: string | null | undefined, floor: UserRole): boolean {
  return roleRank(role) >= RANK[floor];
}

export function outranks(actor: string | null | undefined, target: string | null | undefined): boolean {
  return roleRank(actor) > roleRank(target);
}
