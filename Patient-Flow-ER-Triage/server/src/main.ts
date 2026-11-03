import { buildApp } from "./app.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { developmentAuth, type Authenticate } from "./auth.js";
import { connect } from "./db.js";

const { DATABASE_URL, DEV_TOKENS, CORS_ORIGINS, HOST = "127.0.0.1", PORT = "3000" } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const port = Number(PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const adapter = process.env.AUTH_ADAPTER;
const authenticate: Authenticate = adapter
  ? (await import(pathToFileURL(resolve(adapter)).href)).authenticate
  : developmentAuth(DEV_TOKENS);
if (typeof authenticate !== "function") throw new Error("AUTH_ADAPTER must export authenticate");
const pool = connect(DATABASE_URL);
pool.on("error", () => console.error("Idle database connection failed"));
const app = await buildApp(pool, authenticate, { origins: CORS_ORIGINS?.split(",").map((s) => s.trim()), logger: true });
app.addHook("onClose", () => pool.end());
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void app.close());
try { await app.listen({ host: HOST, port }); }
catch { await app.close(); throw new Error("Could not start the API"); }
