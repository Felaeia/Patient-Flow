import { Platform } from "react-native";

const configuredApi = process.env.EXPO_PUBLIC_TRIFLOW_API_URL?.trim().replace(/\/+$/, "");
export const localMode = __DEV__ && process.env.EXPO_PUBLIC_TRIFLOW_MODE === "local" && !configuredApi;
const loopbackWeb = Platform.OS === "web" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(globalThis.location?.hostname);
export const apiBase = configuredApi || (__DEV__ && loopbackWeb && !localMode ? "http://127.0.0.1:3000" : undefined);
export const automaticToken = process.env.EXPO_PUBLIC_TRIFLOW_TOKEN?.trim() ||
  (__DEV__ ? "triflow-local-development-admin" : "");

export function createClient(token: string) {
  return async function request<T>(path: string, method = "GET", body?: object): Promise<T> {
    if (!apiBase) throw new Error("Configure the TriFlow API URL");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(apiBase + "/api/v1" + path, {
        method, signal: controller.signal,
        headers: { Authorization: "Bearer " + token, ...(body && { "Content-Type": "application/json" }) },
        body: body && JSON.stringify(body),
      }).catch(() => {
        throw new Error(controller.signal.aborted
          ? `TriFlow at ${apiBase} took too long to respond.`
          : `Could not reach TriFlow at ${apiBase}. Check that the API is running and allows this web origin if you're using a browser.`);
      });
      const result = await response.json().catch(() => {
        throw new Error(`The server at ${apiBase} did not return a TriFlow API response.`);
      });
      if (!response.ok) throw new Error(result.message ?? "TriFlow request failed");
      return result.data as T;
    } finally {
      clearTimeout(timer);
    }
  };
}
export type Client = ReturnType<typeof createClient>;
