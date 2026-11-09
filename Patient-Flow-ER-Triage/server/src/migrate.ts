import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { connect, databasePath, transaction, type Database } from "./db.js";

const directory = new URL("../migrations/", import.meta.url);
const migrations = readdirSync(directory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort().map((version) => {
  const sql = readFileSync(new URL(version, directory), "utf8").replaceAll("\r\n", "\n");
  return { version, sql, checksum: createHash("sha256").update(sql).digest("hex") };
});

export function migrate(database: Database) {
  transaction(database, (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) STRICT`);
    const select = db.prepare("SELECT checksum FROM schema_migrations WHERE version=?");
    const insert = db.prepare("INSERT INTO schema_migrations(version,checksum) VALUES (?,?)");
    for (const { version, sql, checksum } of migrations) {
      const applied = select.get(version);
      if (applied) {
        if (applied.checksum !== checksum) throw new Error("Applied migration has changed");
        continue;
      }
      db.exec(sql);
      insert.run(version, checksum);
    }
  });
}

export function checkMigrations(db: Database) {
  const applied = db.prepare("SELECT version, checksum FROM schema_migrations").all();
  const ledger = new Map(applied.map(({ version, checksum }) => [version, checksum]));
  if (ledger.size !== migrations.length || migrations.some(({ version, checksum }) => ledger.get(version) !== checksum)) {
    throw new Error("Migrations required");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = connect(databasePath());
  try { migrate(db); console.log("Migrations applied"); }
  finally { db.close(); }
}
