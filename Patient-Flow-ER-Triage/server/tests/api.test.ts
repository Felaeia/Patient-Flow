import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { developmentAuth } from "../src/auth.js";
import { migrate } from "../src/migrate.js";
import { service } from "../src/service.js";
import { importSqlite } from "../src/import-sqlite.js";
import { initializeDatabase, type Connection } from "../../src/database/schema.js";
import { createAdminService } from "../../src/database/adminService.js";
import { createPatientFlow } from "../../src/simulation/patientFlow.js";

const url = process.env.TEST_DATABASE_URL;
const roles = ["admin", "clinical", "registration", "viewer"] as const;
const credentials = Object.fromEntries(roles.map((role) => [role, randomUUID()]));
const auth = developmentAuth(JSON.stringify(Object.fromEntries(roles.map((role) => [credentials[role], { id: role, role }]))));

async function isolated(run: (pool: pg.Pool) => Promise<void>) {
  const root = new pg.Pool({ connectionString: url });
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
  try {
    await root.query(`CREATE SCHEMA ${schema}`);
    await run(pool);
  } finally {
    await pool.end();
    try { await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await root.end(); }
  }
}

test("API authorization, validation, persistence and concurrent workflows", { skip: !url }, async (t) => isolated(async (pool) => {
  const app = await buildApp(pool, auth);
  const send = (method: "GET" | "POST" | "PATCH", path: string, payload?: object, role: typeof roles[number] | null = "admin") =>
    app.inject({ method, url: "/api/v1" + path, payload, headers: role ? { authorization: "Bearer " + credentials[role] } : {} });
  const count = async (table: string) => (await pool.query(`SELECT count(*)::int total FROM ${table}`)).rows[0].total;
  const register = async (code: string) => {
    const response = await send("POST", "/patients", { sex: "F", patient_code: code, chief_complaint: "Synthetic complaint" }, "registration");
    assert.equal(response.statusCode, 201, response.body);
    return response.json().data;
  };

  try {
    assert.equal((await app.inject("/health")).statusCode, 200);
    assert.equal((await app.inject("/ready")).statusCode, 503);
    await migrate(pool);
    await migrate(pool);
    assert.equal((await app.inject("/ready")).statusCode, 200);

    await t.test("permissions, parameter validation and OpenAPI", async () => {
      assert.equal((await send("GET", "/dashboard", undefined, null)).statusCode, 401);
      assert.equal((await send("GET", "/patients", undefined, "viewer")).statusCode, 403);
      assert.equal((await send("GET", "/audit-logs", undefined, "clinical")).statusCode, 403);
      assert.throws(() => service(pool, { id: "viewer", role: "viewer" }).register({}), /Permission denied/);
      const invalid = await send("GET", "/patients?pageSize=51");
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.json().requestId, invalid.headers["x-request-id"]);
      assert.equal((await send("GET", "/patients/nope")).statusCode, 400);
      assert.equal((await send("POST", "/patients", { sex: "F", chief_complaint: "Test", role: "admin" })).statusCode, 400);
      const doc = await app.inject("/openapi.json");
      assert.equal(doc.statusCode, 200);
      assert.ok(doc.json().paths["/api/v1/patients"].post.requestBody);
    });

    let first: any;
    let second: any;
    await t.test("registration, returning encounter, search and dashboard", async () => {
      first = await register("SYNTH-1");
      second = await register("SYNTH-2");
      assert.equal(await count("patient_records"), 2);
      assert.equal(await count("patient_queues"), 2);
      assert.equal(await count("event_logs"), 2);
      assert.equal(await count("audit_logs"), 4);
      assert.equal(await count("triage_assessments"), 0);
      const path = "/patients/" + first.patient.id + "/encounters";
      assert.equal((await send("POST", path, { chief_complaint: "Returning visit" }, "registration")).statusCode, 201);
      assert.equal((await send("GET", path)).json().data.total, 2);
      assert.equal((await send("GET", "/patients?search=synth-1&status=triage")).json().data.total, 1);
      const details = await send("GET", "/patients/" + first.patient.id);
      assert.equal(details.statusCode, 200, details.body);
      assert.equal(details.json().data.events.length, 2);
      const dashboard = await send("GET", "/dashboard");
      assert.equal(dashboard.statusCode, 200, dashboard.body);
      assert.equal(dashboard.json().data.patients.length, 3);
      assert.equal((await send("GET", "/dashboard", undefined, "viewer")).json().data.patients[0].chief_complaint, undefined);
    });

    await t.test("late failure rolls back all registration writes", async () => {
      await pool.query("ALTER TABLE audit_logs ADD CONSTRAINT simulated_failure CHECK (action <> 'CREATE') NOT VALID");
      try {
        const result = await send("POST", "/patients", { sex: "F", patient_code: "ROLLBACK", chief_complaint: "Synthetic" });
        assert.equal(result.statusCode, 409);
        assert.equal(await count("patient_records"), 2);
        assert.equal(await count("encounters"), 3);
        assert.equal(await count("patient_queues"), 3);
        assert.equal(await count("event_logs"), 3);
        assert.equal(await count("audit_logs"), 5);
      } finally { await pool.query("ALTER TABLE audit_logs DROP CONSTRAINT simulated_failure"); }
    });

    await t.test("clinical permissions, concurrent bay assignment and discharge", async () => {
      const visits: string[] = [first.encounter.id, second.encounter.id];
      for (const id of visits) {
        const path = "/encounters/" + id + "/triage";
        assert.equal((await send("POST", path, { esi: 2 }, "registration")).statusCode, 403);
        assert.equal((await send("POST", path, { esi: 6 }, "clinical")).statusCode, 400);
        const triaged = await send("POST", path, { esi: 2 }, "clinical");
        assert.equal(triaged.statusCode, 201, triaged.body);
        assert.equal(triaged.json().data.assessed_by, "clinical");
        assert.equal((await send("POST", path, { esi: 2 }, "clinical")).statusCode, 409);
      }
      const bay = (await send("POST", "/treatment-bays", {
        code: "SYNTH", name: "Synthetic bay", type: "General", location: "Test", operational_status: "Active", readiness: "Available",
      })).json().data;
      const staff = (await send("POST", "/staff", {
        employee_code: "SYNTH", first_name: "Synthetic", last_name: "Nurse", clinical_role: "Nurse",
        department: "ER", shift: "Day", employment_status: "Active", availability: "Available",
      })).json().data;
      const outcomes = await Promise.all(visits.map((id) => send("POST", "/encounters/" + id + "/bay-assignment", { bay_id: bay.id }, "clinical")));
      assert.deepEqual(outcomes.map((outcome) => outcome.statusCode).sort(), [201, 409]);
      const id = visits[outcomes.findIndex((outcome) => outcome.statusCode === 201)];
      assert.equal(await count("patient_assignments"), 1);
      assert.equal((await send("POST", "/encounters/" + id + "/staff-assignments", { staff_id: staff.id }, "clinical")).statusCode, 201);
      assert.equal((await send("PATCH", "/staff/" + staff.id, { employment_status: "Inactive" })).statusCode, 409);
      assert.equal((await send("POST", "/encounters/" + id + "/discharge", {}, "clinical")).statusCode, 200);
      assert.equal((await send("GET", "/treatment-bays")).json().data.rows[0].status, "available");
      assert.equal((await send("GET", "/staff/" + staff.id)).json().data.availability, "Available");
      assert.equal((await pool.query("SELECT count(*)::int total FROM patient_assignments WHERE released_at IS NULL")).rows[0].total, 0);
    });

    await t.test("reprioritize, release and notification recipient scope", async () => {
      const waiting = (await send("GET", "/queues?status=waiting")).json().data.rows[0];
      const priority = await send("PATCH", "/queues/" + waiting.id, { priority: 1 }, "clinical");
      assert.equal(priority.statusCode, 200, priority.body);
      const bay = (await send("GET", "/treatment-bays")).json().data.rows[0];
      const assignment = await send("POST", "/encounters/" + waiting.encounter_id + "/bay-assignment", { bay_id: bay.id }, "clinical");
      assert.equal(assignment.statusCode, 201, assignment.body);
      assert.equal((await send("PATCH", "/treatment-bays/" + bay.id, { operational_status: "Maintenance" })).statusCode, 409);
      const release = "/assignments/" + assignment.json().data.id + "/release";
      assert.equal((await send("POST", release, undefined, "clinical")).statusCode, 200);
      assert.equal((await send("POST", release, undefined, "clinical")).statusCode, 409);
      assert.equal((await send("GET", "/queues?status=waiting")).json().data.rows[0].priority, 1);

      const notification = (await pool.query(
        "INSERT INTO notifications(recipient_id,title,message) VALUES ($1,$2,$3) RETURNING id",
        ["clinical", "Synthetic notice", "Synthetic text"],
      )).rows[0];
      const path = "/notifications/" + notification.id + "/read";
      assert.equal((await send("GET", "/notifications", undefined, "registration")).json().data.total, 0);
      assert.equal((await send("PATCH", path, undefined, "registration")).statusCode, 404);
      assert.equal((await send("PATCH", path, undefined, "clinical")).statusCode, 200);
      assert.equal((await send("GET", "/notifications?status=read", undefined, "clinical")).json().data.total, 1);
    });

    await t.test("concurrent inventory adjustments and immutable ledger", async () => {
      const resource = (await send("POST", "/resources", {
        code: "SYNTH", name: "Synthetic stock", category: "Test", kind: "Consumable",
        quantity_total: 1, quantity_available: 1, unit: "each", location: "Test", status: "Available",
      })).json().data;
      const path = "/resources/" + resource.id;
      const outcomes = await Promise.all(Array.from({ length: 8 }, () => send("POST", path + "/adjustments", { delta: -1, reason: "Synthetic test" })));
      assert.equal(outcomes.filter((result) => result.statusCode === 200).length, 1);
      assert.equal(outcomes.filter((result) => result.statusCode === 409).length, 7);
      assert.equal((await send("GET", path)).json().data.quantity_available, 0);
      assert.equal(await count("resource_transactions"), 2);
      await assert.rejects(pool.query("UPDATE resource_transactions SET quantity_delta=0"), { code: "23514" });
      await assert.rejects(pool.query("UPDATE resources SET quantity_available=-1"), { code: "23514" });
    });

    const restarted = await buildApp(pool, auth);
    try {
      const result = await restarted.inject({ url: "/api/v1/patients?search=SYNTH-1", headers: { authorization: "Bearer " + credentials.admin } });
      assert.equal(result.json().data.total, 1);
    } finally { await restarted.close(); }
  } finally { await app.close(); }
}));

test("import a SQLite snapshot and rerun PostgreSQL migrations", { skip: !url }, async () => isolated(async (pool) => {
  const directory = await mkdtemp(join(tmpdir(), "triflow-import-"));
  const filename = join(directory, "fixture.db");
  try {
    const sqlite = new DatabaseSync(filename);
    const bind = (params: any[]) => Array.isArray(params[0]) ? params[0] : params;
    const db = {
      execAsync: async (sql: string) => sqlite.exec(sql),
      runAsync: async (sql: string, ...params: any[]) => {
        const result = sqlite.prepare(sql).run(...bind(params));
        return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
      },
      getFirstAsync: async (sql: string, ...params: any[]) => sqlite.prepare(sql).get(...bind(params)) ?? null,
      getAllAsync: async (sql: string, ...params: any[]) => sqlite.prepare(sql).all(...bind(params)),
    } as Connection;
    try {
      await initializeDatabase(db);
      const patient = await createAdminService(db, { id: "legacy-user", role: "admin" }).patients.create({
        patientCode: "MIGRATION-SYNTHETIC", sex: "F", chiefComplaint: "Synthetic import test",
      });
      const record = sqlite.prepare("SELECT operationalPatientId FROM EREncounters WHERE patientRecordId=?").get(patient);
      await createPatientFlow(db).triage(String(record?.operationalPatientId), 3, { id: "legacy-user", role: "admin" });
    } finally { sqlite.close(); }
    await migrate(pool);
    await importSqlite(pool, filename, "admin");
    await migrate(pool);
    await assert.rejects(importSqlite(pool, filename, "admin"), /empty migrated destination/);
    const api = service(pool, { id: "admin", role: "admin" });
    const patients = await api.list("patient_records", { search: "MIGRATION-SYNTHETIC" });
    assert.equal(patients.total, 1);
    const details = await api.details(patients.rows[0].id, {});
    assert.equal(details.encounters.rows[0].status, "waiting");
    assert.equal(details.assessments[0].esi, 3);
    assert.equal(details.events.length, 2);
    assert.equal((await api.list("audit_logs", {})).total, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
