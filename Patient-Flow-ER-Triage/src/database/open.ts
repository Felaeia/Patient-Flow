import { openDatabaseAsync } from "expo-sqlite";
import { initializeDatabase } from "./schema";
import { createPatientFlow } from "../simulation/patientFlow";

async function openPatientFlow() {
  const db = await getDatabase();
  try {
    const flow = createPatientFlow(db);
    if (__DEV__ && process.env.EXPO_PUBLIC_TRIFLOW_SEED === "1") await flow.seed();
    return flow;
  } catch (error) {
    throw error;
  }
}

let databaseOpening: ReturnType<typeof openDatabaseAsync> | undefined;
export function getDatabase() {
  databaseOpening ??= openDatabaseAsync("triflow.db").then(async (db) => {
    await initializeDatabase(db);
    return db;
  }).catch((error: unknown) => {
    databaseOpening = undefined;
    throw error;
  });
  return databaseOpening;
}

let opening: ReturnType<typeof openPatientFlow> | undefined;

export function getPatientFlow() {
  opening ??= openPatientFlow().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}
