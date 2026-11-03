import pg from "pg";
import type { Pool, PoolClient } from "pg";

export function connect(connectionString: string) {
  return new pg.Pool({ connectionString, options: "-c timezone=UTC -c statement_timeout=10000", connectionTimeoutMillis: 5000 });
}

export async function transaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>, readOnly = false) {
  const db = await pool.connect();
  let discard = false;
  try {
    await db.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch { discard = true; }
    throw error;
  } finally {
    db.release(discard);
  }
}
