import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { connect, transaction } from "./db.js";

const directory = new URL("../migrations/", import.meta.url);
export async function migrate(pool: Pool) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(198274236)");
    await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())");
    for (const version of (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
      const sql = await readFile(new URL(version, directory), "utf8");
      const checksum = createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
      const applied = (await db.query("SELECT checksum FROM schema_migrations WHERE version=$1", [version])).rows[0];
      if (applied) {
        if (applied.checksum !== checksum) throw new Error("Applied migration has changed");
        continue;
      }
      await db.query(sql.trim().replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;$/i, ""));
      await db.query("INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)", [version, checksum]);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = connect(process.env.DATABASE_URL);
  try { await migrate(pool); console.log("Migrations applied"); }
  finally { await pool.end(); }
}
