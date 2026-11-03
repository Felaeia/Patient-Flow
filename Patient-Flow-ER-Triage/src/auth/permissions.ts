import type { AdminActor, AdminRole } from "../database/models";

export type Permission = "admin:view" | "patients:write" | "bays:write" | "staff:write" | "resources:write" | "clinical:triage";
const grants: Record<AdminRole, Permission[]> = {
  admin: ["admin:view", "patients:write", "bays:write", "staff:write", "resources:write", "clinical:triage"],
  registration: ["admin:view", "patients:write"],
  clinical: ["admin:view", "clinical:triage"],
  viewer: [],
};

export function can(actor: AdminActor, permission: Permission) {
  return grants[actor.role].includes(permission);
}

export function requirePermission(actor: AdminActor, permission: Permission) {
  if (!can(actor, permission)) throw new Error(`Forbidden: ${permission}`);
}
