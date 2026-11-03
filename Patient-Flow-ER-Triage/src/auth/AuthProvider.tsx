import { createContext, useContext } from "react";
import type { PropsWithChildren } from "react";
import type { AdminActor, AdminRole } from "../database/models";
import { can, type Permission } from "./permissions";

const configuredRole = process.env.EXPO_PUBLIC_TRIFLOW_ROLE as AdminRole | undefined;
const actor: AdminActor = { id: "local-admin", role: configuredRole ?? "admin" };
const AuthContext = createContext(actor);

/** Supplies the local development identity. Replace this provider when authentication is connected. */
export function AuthProvider({ children }: PropsWithChildren) {
  return <AuthContext.Provider value={actor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const current = useContext(AuthContext);
  return { actor: current, can: (permission: Permission) => can(current, permission) };
}
