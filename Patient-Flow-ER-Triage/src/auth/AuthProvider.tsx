import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { AdminActor, AdminRole } from "../database/models";
import { can, type Permission } from "./permissions";
import { apiBase, createClient, localMode, type Client } from "../api/client";

const configuredRole = process.env.EXPO_PUBLIC_TRIFLOW_ROLE as AdminRole | undefined;
const localActor: AdminActor = { id: "local-admin", role: configuredRole && ["admin", "registration", "clinical", "viewer"].includes(configuredRole) ? configuredRole : "admin" };
type Session = { actor: AdminActor; request?: Client };
const AuthContext = createContext<Session>({ actor: localActor });

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function signIn() {
    if (submitting.current || !token.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const request = createClient(token.trim());
      setSession({ actor: await request<AdminActor>("/me"), request });
      setToken("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (localMode) return <AuthContext.Provider value={{ actor: localActor }}>{children}</AuthContext.Provider>;
  if (!apiBase) return <Text className="p-4">Configure the TriFlow API URL to connect to shared data.</Text>;
  if (session) return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
  return <View className="m-4 max-w-[480px] gap-3 rounded-xl border border-slate-300 p-4">
    <Text accessibilityRole="header" className="text-xl font-bold">Connect to TriFlow</Text>
    <TextInput accessibilityLabel="Bearer credential" secureTextEntry autoCapitalize="none" value={token}
      onChangeText={setToken} onSubmitEditing={signIn} placeholder="Bearer credential" className="rounded-lg border border-slate-300 p-3" />
    <Pressable accessibilityRole="button" disabled={busy} onPress={signIn} className="rounded-lg bg-teal-900 p-3">
      <Text className="font-bold text-white">{busy ? "Connecting…" : "Connect"}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" className="text-red-800">{error}</Text>}
  </View>;
}

export function useAuth() {
  const current = useContext(AuthContext);
  return useMemo(() => ({ ...current, can: (permission: Permission) => can(current.actor, permission) }), [current]);
}
