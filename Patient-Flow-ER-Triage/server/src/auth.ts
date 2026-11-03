import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.js";

const grants = {
  admin: ["read", "records", "register", "triage", "allocate", "manageBay", "manageStaff", "manageResource", "audit"],
  registration: ["read", "records", "register"],
  clinical: ["read", "records", "triage", "allocate"],
  viewer: ["read"],
} as const;
export type Role = keyof typeof grants;
export type Permission = typeof grants.admin[number];
export interface Actor { id: string; role: Role }
export type Authenticate = (authorization?: string) => Promise<Actor | undefined>;

export function permit(actor: Actor, permission: Permission) {
  const permissions: readonly Permission[] = Object.hasOwn(grants, actor.role) ? grants[actor.role] : [];
  if (!permissions.includes(permission)) throw new ApiError(403, "FORBIDDEN", "Permission denied");
}

export function developmentAuth(tokens: string | undefined): Authenticate {
  if (process.env.NODE_ENV === "production") throw new Error("Production requires an identity adapter");
  const entries = Object.entries(JSON.parse(tokens ?? "{}") as Record<string, Actor>);
  const ids = new Set<string>();
  for (const [token, actor] of entries) {
    if (token.length < 24 || !actor || typeof actor.id !== "string" || !actor.id.trim() ||
        actor.id.length > 128 || !Object.hasOwn(grants, actor.role) || ids.has(actor.id)) {
      throw new Error("Invalid development identity configuration");
    }
    ids.add(actor.id);
  }
  return async (header) => {
    if (!header?.startsWith("Bearer ")) return;
    const supplied = Buffer.from(header.slice(7));
    return entries.find(([token]) => {
      const expected = Buffer.from(token);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    })?.[1];
  };
}
