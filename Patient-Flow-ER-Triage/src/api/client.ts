export const apiBase = process.env.EXPO_PUBLIC_TRIFLOW_API_URL?.trim().replace(/\/+$/, "");
export const localMode = __DEV__ && process.env.EXPO_PUBLIC_TRIFLOW_MODE === "local" && !apiBase;

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
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "TriFlow request failed");
      return result.data as T;
    } finally {
      clearTimeout(timer);
    }
  };
}
export type Client = ReturnType<typeof createClient>;
