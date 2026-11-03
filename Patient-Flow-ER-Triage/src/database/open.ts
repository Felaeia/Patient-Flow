import { openDatabaseAsync } from "expo-sqlite";
import { initializeDatabase } from "./schema";
import { createPatientFlow } from "../simulation/patientFlow";

async function openPatientFlow() {
  const db = await openDatabaseAsync("triflow.db");
  try {
    await initializeDatabase(db);
    const flow = createPatientFlow(db);
    if (__DEV__ && process.env.EXPO_PUBLIC_TRIFLOW_SEED === "1") await flow.seed();
    return flow;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

let opening: ReturnType<typeof openPatientFlow> | undefined;

export function getPatientFlow() {
  opening ??= openPatientFlow().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}
