import { buildApp } from "./app.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { developmentAuth, type Authenticate } from "./auth.js";
import { connect, databasePath } from "./db.js";
import { migrate, checkMigrations } from "./migrate.js";

const { DEV_TOKENS, CORS_ORIGINS, HOST = "127.0.0.1", PORT = "3000" } = process.env;
const port = Number(PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const adapter = process.env.AUTH_ADAPTER;
const origins = CORS_ORIGINS !== undefined
  ? CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : !adapter && process.env.NODE_ENV !== "production"
    ? ["http://localhost:8081", "http://127.0.0.1:8081", "http://[::1]:8081"]
    : [];
const authenticate: Authenticate = adapter
  ? (await import(pathToFileURL(resolve(adapter)).href)).authenticate
  : developmentAuth(DEV_TOKENS);
if (typeof authenticate !== "function") throw new Error("AUTH_ADAPTER must export authenticate");
const db = connect(databasePath());
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  migrate(db);
  checkMigrations(db);
  const server = await buildApp(db, authenticate, { origins, logger: true });
  app = server;
  server.addHook("onClose", () => db.close());
  await server.listen({ host: HOST, port });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void server.close());
} catch (error) {
  if (app) await app.close();
  else db.close();
  throw error;
}
