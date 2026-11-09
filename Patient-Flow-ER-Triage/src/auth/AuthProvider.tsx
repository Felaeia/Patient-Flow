import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import type { AdminActor, AdminRole } from "../database/models";
import { can, type Permission } from "./permissions";
import { apiBase, automaticToken, createClient, localMode, type Client } from "../api/client";

const configuredRole = process.env.EXPO_PUBLIC_TRIFLOW_ROLE as AdminRole | undefined;
const localActor: AdminActor = { id: "local-admin", role: configuredRole && ["admin", "registration", "clinical", "viewer"].includes(configuredRole) ? configuredRole : "admin" };
type Session = { actor: AdminActor; request?: Client };
const AuthContext = createContext<Session>({ actor: localActor });

async function automaticSession(): Promise<Session> {
  const request = createClient(automaticToken);
  return { actor: await request<AdminActor>("/me"), request };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!localMode && apiBase && automaticToken) {
      void automaticSession().then(
        (next) => { if (active) setSession(next); },
        (cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); },
      );
    }
    return () => { active = false; };
  }, []);

  function retry() {
    setError("");
    void automaticSession().then(setSession, (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)));
  }

  if (localMode) return <AuthContext.Provider value={{ actor: localActor }}>{children}</AuthContext.Provider>;
  if (!apiBase) return <Text className="p-4">Set EXPO_PUBLIC_TRIFLOW_API_URL to your TriFlow backend URL and reload the app.</Text>;
  if (!automaticToken) return <Text className="p-4">Set EXPO_PUBLIC_TRIFLOW_TOKEN for automatic sign-in and reload the app.</Text>;
  if (session) return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
  return <View className="m-4 gap-3 p-4">
    {!error && <Text>Signing in to TriFlow…</Text>}
    {!!error && <>
      <Text accessibilityRole="alert" className="text-red-800">Automatic sign-in failed. {error}</Text>
      <Pressable accessibilityRole="button" onPress={retry}
        className="self-start rounded-lg bg-teal-900 px-4 py-3">
        <Text className="font-bold text-white">Retry</Text>
      </Pressable>
    </>}
  </View>;
}

export function useAuth() {
  const current = useContext(AuthContext);
  return useMemo(() => ({ ...current, can: (permission: Permission) => can(current.actor, permission) }), [current]);
}
