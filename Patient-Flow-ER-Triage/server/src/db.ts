import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type Database = DatabaseSync;

export function databasePath() {
  const configured = process.env.SQLITE_PATH?.trim();
  if (configured) return resolve(configured);
  if (process.env.DATABASE_URL) {
    throw new Error("Replace DATABASE_URL with SQLITE_PATH to select a SQLite database");
  }
  return fileURLToPath(new URL("../data/triflow.sqlite", import.meta.url));
}

export function connect(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    db.function("fold_case", { deterministic: true }, (value) =>
      typeof value === "string" ? value.toLowerCase() : null);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Keep callbacks synchronous so another request cannot join an open transaction.
export function transaction<T>(db: Database, run: (db: Database) => T, readOnly = false): T {
  db.exec(readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
  try {
    const result = run(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* SQLite may have already rolled back. */ }
    throw error;
  }
}
