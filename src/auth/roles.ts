export const ROLES = ["client", "artist", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Roles a person may pick for themselves at registration. Elevated roles are granted by an admin. */
export const SELF_REGISTERABLE_ROLES = ["client", "artist"] as const;

export function hasRole(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}
