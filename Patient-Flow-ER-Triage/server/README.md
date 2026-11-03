# TriFlow API

TriFlow uses Fastify, TypeScript and node-postgres. In shared mode the API owns reads and writes and PostgreSQL stores committed state. The Expo client polls the dashboard every three seconds. A failed connection shows an error and retry action. It never switches the data source during a session.

## Local setup

Use Node 24+ and Docker Compose, or a local PostgreSQL 17+ instance. From this directory in PowerShell:

```powershell
npm ci
$env:TRIFLOW_POSTGRES_PASSWORD = [guid]::NewGuid().ToString()
docker compose up -d --wait
$env:DATABASE_URL = "postgresql://triflow:${env:TRIFLOW_POSTGRES_PASSWORD}@127.0.0.1:5432/triflow"
npm run migrate

$env:ADMIN_TOKEN = [guid]::NewGuid().ToString()
$env:REGISTRATION_TOKEN = [guid]::NewGuid().ToString()
$env:CLINICAL_TOKEN = [guid]::NewGuid().ToString()
$env:VIEWER_TOKEN = [guid]::NewGuid().ToString()
$tokens = @{}
$tokens[$env:ADMIN_TOKEN] = @{ id = "dev-admin"; role = "admin" }
$tokens[$env:REGISTRATION_TOKEN] = @{ id = "dev-registration"; role = "registration" }
$tokens[$env:CLINICAL_TOKEN] = @{ id = "dev-clinical"; role = "clinical" }
$tokens[$env:VIEWER_TOKEN] = @{ id = "dev-viewer"; role = "viewer" }
$env:DEV_TOKENS = $tokens | ConvertTo-Json -Compress
$env:CORS_ORIGINS = "http://localhost:8081,http://127.0.0.1:8081"
npm start
```

Keep the local database password consistent across restarts of the same Compose volume. If using an existing instance, supply its connection string and run the migration command. Migrations use a transaction, advisory lock and checksum ledger. Back up the database and run migrations using a migration credential before deploying the application.

| Setting | Use |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `HOST`, `PORT` | Listen address, default `127.0.0.1:3000` |
| `CORS_ORIGINS` | Comma-separated exact origins for Expo web |
| `DEV_TOKENS` | Local-only JSON map of bearer credentials to unique actor IDs and roles. Use random tokens of at least 24 characters. |
| `AUTH_ADAPTER` | Absolute path to an operator-provided ES module exporting an `authenticate` function |
| `TEST_DATABASE_URL` | Dedicated test database. The suite creates and drops its own schemas. |
| `LEGACY_NOTIFICATION_RECIPIENT` | Server actor ID that should own imported global notifications |

The default development adapter rejects production startup. For production, set `NODE_ENV=production` and provide an `AUTH_ADAPTER` module implementing the `Authenticate` signature in `src/auth.ts`. It receives the Authorization header and returns a stable actor ID and a server-mapped role after verifying the credential, or returns undefined on authentication failure. No role in a body, query string or client header grants permission. Deploy behind HTTPS with a restricted runtime database role and separate migration credentials. Restrict origins and apply gateway rate limits, backup and retention policies, and monitoring appropriate to the deployment. An identity provider and site-specific access policies must be configured before handling real patient data.

## Expo

From the Expo project directory in another terminal:

```powershell
npm ci
$env:EXPO_PUBLIC_TRIFLOW_API_URL = "http://127.0.0.1:3000"
npm run web
```

Paste the intended local bearer credential into **Connect to TriFlow**. The server's `/me` response controls the displayed role. The credential lives in memory for the session. For an exported web build, configure the web host to serve the SPA entry point for client routes such as /admin/patients. For a device use a host URL reachable from that device, bind the API on the intended interface and use HTTPS for shared use.

An admin can create treatment bays, staff and resources from the existing admin screens. Register a patient from Patient Management, assign ESI in Inbox, select the waiting encounter to assign a bay, and select the encounter from Treatment Bays to assign staff or discharge/admit. The original SQLite timer and synthetic patients are available when starting a development build with `EXPO_PUBLIC_TRIFLOW_MODE=local` and the API URL unset. The local role setting applies only there. Shared mode uses real timestamps and explicit clinical actions. The timer-driven treatment percentage and synthetic clinical recommendations belong to the simulator. Shared connectivity loss pauses refresh; committed PostgreSQL state remains authoritative.

## HTTP contract

`GET /health` reports process liveness. `GET /ready` checks database connectivity and the migration ledger. `GET /openapi.json` generates OpenAPI from the route definitions. Protected paths are under `/api/v1` and require `Authorization: Bearer <token>`. IDs are decimal strings. Body and row fields use snake_case. A successful response wraps the result in `data`. Errors return `status`, `code`, `message`, `requestId` and optional validation `details`. Responses include `X-Request-Id`.

| Area | Paths and methods |
| --- | --- |
| Identity and dashboard | GET `/me`, `/dashboard`, `/events` |
| Patients | GET/POST `/patients`, GET/PATCH `/patients/{patientId}`, GET/POST `/patients/{patientId}/encounters` |
| Encounter | GET `/encounters/{encounterId}`, POST its `/triage`, `/bay-assignment`, `/staff-assignments`, `/discharge` |
| Queues | GET `/queues`, PATCH `/queues/{queueId}` |
| Bays | GET/POST `/treatment-bays`, PATCH `/treatment-bays/{bayId}` |
| Assignments | POST `/assignments/{assignmentId}/release` |
| Staff | GET/POST `/staff`, GET/PATCH `/staff/{staffId}` |
| Inventory | GET/POST `/resources`, GET/PATCH `/resources/{resourceId}`, POST `/resources/{resourceId}/adjustments` |
| Notifications and audit | GET `/notifications`, PATCH `/notifications/{notificationId}/read`, GET `/audit-logs` |

Lists accept bounded `search`, `status`, `sort=asc|desc` (by ID), `page` and `pageSize` (1–50). Responses include `rows`, `total`, `page` and `pageSize`. Status matches the relevant list's status/category, or the action for audit logs. Queue search uses encounter ID. Patient detail supports paging its encounters and associated history. Queue priority can be adjusted after triage without changing the recorded ESI. A released bay returns the encounter to waiting and releases its associated staff. Discharge and admission release all assignments together. Resource adjustments accept a signed delta and reason. Administrative resource edits set absolute quantities.

Registration staff can maintain patient identities and create encounters. Clinical staff can triage, reprioritize, allocate and discharge. Admins also manage capacity, inventory and staff and read audit records. Viewers see limited dashboard and queue data. Notifications are scoped to their recipient.

## SQLite cutover

1. Stop local writes and take a consistent, backed-up SQLite v2 snapshot. Include WAL contents using a SQLite backup or a completed checkpoint.
2. Run PostgreSQL migrations on an empty staging destination, set `LEGACY_NOTIFICATION_RECIPIENT` to the designated actor, then run `npm run import:sqlite -- "C:/path/to/snapshot.db"`.
3. Compare record counts and sample longitudinal histories, confirm active assignments and inventory, and rerun migrations to verify the ledger. Rehearse before configuring the shared clients.

The importer runs in one transaction and requires an empty destination. It remaps database IDs and relationships, retaining patient codes, encounter codes, operational IDs, audit details and historical assignments. It uses current operational encounter status where SQLite keeps separate copies, creates identities for simulator-only visits, interprets naive SQLite timestamps as UTC and maps legacy notifications to the designated actor. Legacy audit entity IDs remain in the source namespace. Simulation ticks and progress do not drive shared workflow. Keep the original snapshot for reconciliation. No offline synchronization is performed.

## Verification and load

```powershell
npm run check
$env:TEST_DATABASE_URL = "<dedicated PostgreSQL test URL>"
npm test
# From the Expo directory
npx tsc --noEmit
npx expo lint
npm run test:database
```

Install [Grafana k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) and point it at a dedicated synthetic API/database. Every run creates synthetic records, including the setup for read workloads. Preserve or discard the isolated database according to your test lifecycle.

```powershell
$env:BASE_URL = "http://127.0.0.1:3000"
$env:ALLOW_SYNTHETIC_WRITES = "yes"
# Set ADMIN_TOKEN, REGISTRATION_TOKEN and CLINICAL_TOKEN to the matching server credentials.
foreach ($profile in "smoke", "baseline", "peak", "stress", "soak") {
  $env:PROFILE = $profile
  k6 run load/er.js
}
```

Use `WORKLOAD=mixed|dashboard|search|registration|triage|bay|inventory` to select a scenario's work. Override `VUS`, `DURATION`, `THINK_TIME`, `READ_P95_MS`, `WRITE_P95_MS` and `FAILURE_RATE` as needed. Stress uses a ramp with three stages. Setup races two encounters for one bay and six withdrawals against a single unit. It checks the resulting encounter, bay and stock state. Teardown checks that mixed workloads restored stock and released all bays. Expected contention responses count as successes only for the race requests. The summary reports HTTP throughput, p50, p95, p99 and failed request rate. Default thresholds are read p95 under 500 ms, write p95 under 1 s, and HTTP failures under 1%.
