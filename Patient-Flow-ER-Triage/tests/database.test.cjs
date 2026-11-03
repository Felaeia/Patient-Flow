const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const ts = require("typescript");

// Run the production TypeScript SQL and workflows against a real SQLite file.
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const { initializeDatabase } = require("../src/database/schema.ts");
const { repositories } = require("../src/database/repositories.ts");
const { createPatientFlow } = require("../src/simulation/patientFlow.ts");
const { createAdminService } = require("../src/database/adminService.ts");

function connect(filename) {
  const sqlite = new DatabaseSync(filename, { enableForeignKeyConstraints: false });
  const bindings = (params) => Array.isArray(params[0]) ? params[0] : params;
  return {
    execAsync: async (sql) => sqlite.exec(sql),
    runAsync: async (sql, ...params) => {
      const { changes, lastInsertRowid } = sqlite.prepare(sql).run(...bindings(params));
      return { changes, lastInsertRowId: lastInsertRowid };
    },
    getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...bindings(params)) ?? null,
    getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...bindings(params)),
    close: () => sqlite.close(),
  };
}

test("initialization, CRUD, transactional patient flow, and restart persistence", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "triflow-sqlite-"));
  const filename = path.join(dir, "triflow.db");
  let db = connect(filename);
  const input = {
    id: "P-test", name: "Simulated O'Neil", age: 41, sex: "F", complaint: "Fever",
    vitals: { hr: 80, bpSys: 120, bpDia: 80, spo2: 98, temp: 37 },
    pain: 2, suggestedEsi: 4,
  };
  try {
    await initializeDatabase(db);
    const tables = await db.getAllAsync("SELECT name FROM sqlite_master WHERE type='table'");
    for (const name of ["Patients", "TriageAssessments", "PatientQueues", "TreatmentBays", "Staff", "PatientAssignments", "EventLogs", "Notifications"]) {
      assert.ok(tables.some((table) => table.name === name));
    }
    assert.equal((await db.getFirstAsync("PRAGMA foreign_keys")).foreign_keys, 1);
    assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 2);

    const flow = createPatientFlow(db);
    const repo = repositories(db);
    assert.equal((await flow.load()).metrics.total, 0);
    await flow.register(input);
    assert.equal((await repo.patients.byId(input.id)).name, input.name);
    assert.equal((await repo.queue.active())[0].status, "triage");
    await assert.rejects(repo.assessments.create("missing", 1), /FOREIGN KEY/);
    await assert.rejects(flow.triage(input.id, 6, { id: "admin", role: "admin" }), /CHECK/);
    assert.equal((await repo.patients.byId(input.id)).status, "triage");
    assert.equal((await repo.assessments.byPatient(input.id)).length, 0);

    await flow.triage(input.id, 4, { id: "clinician", role: "clinical" });
    assert.equal((await repo.assessments.latest(input.id)).esi, 4);
    assert.equal((await repo.queue.active())[0].priority, 4);
    assert.equal((await repo.dashboard(7)).averageWait, 7);

    await assert.rejects(flow.assign(input.id, 1, ["s1", "missing"]), /unavailable/);
    assert.equal((await repo.assignments.active()).length, 0);
    assert.equal((await repo.bays.available()).length, 8);
    assert.equal((await repo.queue.active())[0].status, "waiting");
    assert.equal((await repo.patients.byId(input.id)).status, "waiting");
    assert.equal((await repo.staff.available()).length, 6);
    assert.equal((await repo.events.byPatient(input.id)).length, 2);

    await flow.assign(input.id, 1, ["s1", "s3"]);
    assert.equal((await repo.assignments.active()).length, 3);
    assert.equal((await repo.patients.byId(input.id)).bedId, 1);
    assert.equal((await flow.load()).metrics.occupiedBays, 1);
    assert.equal((await repo.staff.available()).length, 4);
    assert.equal((await repo.queue.active()).length, 0);
    await flow.register({ ...input, id: "P-other" });
    await flow.triage("P-other", 3, { id: "clinician", role: "clinical" });
    await assert.rejects(repo.assignments.bay("P-other", 1), /UNIQUE/);
    await assert.rejects(flow.assign("P-other", 1, []), /unavailable/);
    await flow.discharge(input.id);
    assert.equal((await flow.load()).metrics.discharged, 1);
    assert.equal((await repo.bays.available()).length, 8);
    assert.equal((await repo.staff.available()).length, 6);
    assert.equal((await repo.events.byPatient(input.id)).length, 6);

    await repo.bays.update(2, "unavailable");
    await repo.staff.update("s2", "Unavailable");
    assert.equal((await repo.bays.available()).length, 7);
    assert.equal((await repo.staff.available()).length, 5);
    await repo.bays.update(2, "available");
    await repo.staff.update("s2", "Idle");

    const registered = await repo.patients.byId(input.id);
    await repo.patients.create({ ...registered, id: "P-draft", status: "triage" });
    const draft = await repo.patients.byId("P-draft");
    await repo.patients.update({ ...draft, complaint: "Headache" });
    assert.equal((await repo.patients.byId("P-draft")).complaint, "Headache");
    await repo.patients.delete("P-draft");
    assert.equal(await repo.patients.byId("P-draft"), null);
    assert.equal((await repo.patients.delete(input.id)).changes, 0);
    await flow.register({ ...input, id: "P-referenced" });
    await assert.rejects(repo.patients.delete("P-referenced"), /FOREIGN KEY/);

    const notice = await repo.notifications.create("Test", "Simulation notification", "info");
    await repo.notifications.markRead(Number(notice.lastInsertRowId));
    assert.equal((await repo.notifications.all())[0].isRead, 1);

    await flow.seed();
    await flow.seed();
    assert.equal((await flow.load()).metrics.total, 23);
    const tick = await flow.tick();
    assert.equal(tick.simTime, 1);
    assert.ok(tick.metrics.treatment > 0);
    db.close();

    db = connect(filename);
    await initializeDatabase(db);
    await initializeDatabase(db);
    const reopened = createPatientFlow(db);
    await reopened.seed();
    const persisted = await reopened.load();
    assert.deepEqual(persisted.metrics, tick.metrics);
    assert.equal(persisted.simTime, 1);
    assert.equal(persisted.events.length, tick.events.length);
    assert.equal(persisted.patients.find((patient) => patient.id === input.id).status, "discharged");
    assert.equal((await repositories(db).notifications.all()).length, 2);
    assert.deepEqual(await db.getAllAsync("PRAGMA foreign_key_check"), []);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("admin management enforces permissions, validation, history, and operational safeguards", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "triflow-admin-"));
  const filename = path.join(dir, "triflow.db");
  const db = connect(filename);
  try {
    await initializeDatabase(db);
    const admin = createAdminService(db, { id: "test-admin", role: "admin" });
    const viewer = createAdminService(db, { id: "test-viewer", role: "viewer" });
    assert.throws(() => viewer.patients.list(), /Forbidden/);

    const patientId = await admin.patients.create({ firstName: "Morgan", lastName: "Test", sex: "X", chiefComplaint: "Headache" });
    const patientPage = await admin.patients.list("Morgan");
    assert.equal(patientPage.total, 1);
    assert.equal(patientPage.rows[0].currentStatus, "triage");
    const details = await admin.patients.details(patientId);
    assert.equal(details[1].length, 1);
    assert.equal(details[2].length, 0);
    await admin.patients.update(patientId, { patientCode: patientPage.rows[0].patientCode, firstName: "Morgan", lastName: "Updated", sex: "X" });
    await admin.patients.createEncounter(patientId, "Return visit");
    assert.equal((await admin.patients.details(patientId))[1].length, 2);
    assert.equal((await admin.patients.list("Updated")).total, 1);

    await admin.bays.save(null, { code: "BAY-99", name: "Isolation 99", type: "Isolation", location: "Zone Z", operationalStatus: "Active", occupancyStatus: "Available" });
    assert.equal((await admin.bays.list("BAY-99")).total, 1);
    const encounter = await db.getFirstAsync("SELECT operationalPatientId FROM EREncounters WHERE patientRecordId=?", patientId);
    await db.runAsync("INSERT INTO PatientAssignments(patientId,bayId) VALUES (?,1)", encounter.operationalPatientId);
    await assert.rejects(admin.bays.save(1, { code: "BAY-01", name: "Bay 1", type: "General", location: "ED", operationalStatus: "Out of Service", occupancyStatus: "Available" }), /Transfer/);

    await admin.staff.save(null, { employeeCode: "EMP-99", firstName: "Ari", lastName: "Nurse", role: "Nurse", department: "Emergency Department", shift: "Day", availability: "Available", employmentStatus: "Active" });
    await assert.rejects(admin.staff.save(null, { employeeCode: "EMP-99", firstName: "Duplicate", lastName: "Code", role: "Nurse", department: "ED", shift: "Day", availability: "Available", employmentStatus: "Active" }), /UNIQUE/);

    await admin.resources.save(null, { code: "RES-01", name: "Wheelchair", category: "Equipment", kind: "Reusable", quantityTotal: 4, quantityAvailable: 4, unit: "units", location: "Storage", status: "Available" }, "Opening balance");
    const resource = (await admin.resources.list("Wheelchair")).rows[0];
    await admin.resources.save(resource.id, { ...resource, quantityAvailable: 3 }, "Deployed to triage");
    await assert.rejects(admin.resources.save(resource.id, { ...resource, quantityAvailable: 5 }, "Invalid"), /between zero/);
    assert.equal((await db.getAllAsync("SELECT * FROM ResourceTransactions WHERE resourceId=?", resource.id)).length, 2);
    assert.ok((await db.getAllAsync("SELECT * FROM AuditLogs")).length >= 5);
    assert.deepEqual(await db.getAllAsync("PRAGMA foreign_key_check"), []);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
