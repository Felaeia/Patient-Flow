import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { permit, type Actor, type Permission } from "./auth.js";
import { transaction } from "./db.js";
import { conflict, missing } from "./errors.js";
import { Repository, type Fields, type ListTable, type ListQuery } from "./repository.js";

const readGrants: Record<ListTable, Permission> = {
  patient_records: "records", encounters: "records", patient_queues: "read", treatment_bays: "read",
  staff: "records", resources: "records", event_logs: "records", audit_logs: "audit", notifications: "read",
};
const management = { treatment_bays: "manageBay", staff: "manageStaff", resources: "manageResource" } as const;
type Managed = keyof typeof management;

export function service(pool: Pool, actor: Actor) {
  const repo = new Repository(pool);
  function write<T>(permission: Permission, work: (r: Repository) => Promise<T>) {
    permit(actor, permission);
    return transaction(pool, (db) => work(new Repository(db)));
  }
  const audit = (r: Repository, action: string, entity: string, id: string, details = {}) =>
    r.insert("audit_logs", { actor_id: actor.id, action, entity_type: entity, entity_id: id, details });
  const event = (r: Repository, id: string, category: string, message: string) =>
    r.insert("event_logs", { encounter_id: id, category, message, type: category === "Disposition" ? "success" : "info" });
  async function encounter(r: Repository, patientId: string, complaint: unknown) {
    const row = await r.insert("encounters", { patient_id: patientId, chief_complaint: complaint });
    await r.insert("patient_queues", { encounter_id: row.id, status: "triage" });
    await event(r, row.id, "Registration", "Encounter registered for triage");
    await audit(r, "CREATE", "EREncounter", row.id);
    return row;
  }
  async function queue(r: Repository, id: string) {
    return (await r.activeQueue(id))[0] ?? conflict("Encounter has no active queue");
  }
  async function release(r: Repository, assignment: Fields & { id: string }, now: Date) {
    const bay = assignment.bay_id as string | null;
    const staff = assignment.staff_id as string | null;
    if (bay) await r.get("treatment_bays", bay, true);
    if (staff) await r.get("staff", staff, true);
    const result = await r.update("patient_assignments", assignment.id, { released_at: now });
    if (bay) await r.update("treatment_bays", bay, { readiness: "Available" });
    if (staff) await r.update("staff", staff, { availability: "Available" });
    return result;
  }

  return {
    list(table: ListTable, query: ListQuery, id?: string) {
      permit(actor, readGrants[table]);
      return transaction(pool, async (db) => {
        const reader = new Repository(db);
        if (table === "encounters" && id) await reader.get("patient_records", id);
        return reader.list(table, query, table === "notifications" ? actor.id : id);
      }, true);
    },
    get(table: ListTable, id: string) {
      permit(actor, readGrants[table]);
      return repo.get(table, id);
    },
    details(id: string, query: ListQuery) {
      permit(actor, "records");
      return transaction(pool, (db) => new Repository(db).patientDetails(id, query), true);
    },
    async dashboard() {
      permit(actor, "read");
      const dashboard = await transaction(pool, (db) => new Repository(db).dashboard(), true);
      if (actor.role === "viewer") {
        dashboard.patients = dashboard.patients.map(({ id, status, arrival_at, queue_entered_at, esi, assessed_esi, bay_id }) =>
          ({ id, status, arrival_at, queue_entered_at, esi, assessed_esi, bay_id }));
        dashboard.events = [];
      }
      return dashboard;
    },
    register(input: Fields) {
      return write("register", async (r) => {
        const { chief_complaint, ...data } = input;
        const patient = await r.insert("patient_records", { patient_code: "MRN-" + randomUUID(), ...data });
        const visit = await encounter(r, patient.id, chief_complaint);
        await audit(r, "CREATE", "PatientRecord", patient.id);
        return { patient, encounter: visit };
      });
    },
    updatePatient(id: string, data: Fields) {
      return write("register", async (r) => {
        if ((await r.get("patient_records", id, true)).archived_at) missing();
        const result = await r.update("patient_records", id, { ...data, updated_at: new Date() });
        await audit(r, "UPDATE", "PatientRecord", id, { fields: Object.keys(data) });
        return result;
      });
    },
    returnPatient(id: string, complaint: string) {
      return write("register", async (r) => {
        if ((await r.get("patient_records", id, true)).archived_at) missing();
        return encounter(r, id, complaint);
      });
    },
    triage(id: string, data: Fields) {
      return write("triage", async (r) => {
        if ((await r.get("encounters", id, true)).status !== "triage") conflict("Encounter is no longer awaiting triage");
        const current = await queue(r, id);
        const result = await r.insert("triage_assessments", { ...data, encounter_id: id, assessed_by: actor.id });
        await r.update("encounters", id, { status: "waiting" });
        await r.update("patient_queues", current.id, { status: "waiting", priority: data.esi, entered_at: new Date() });
        await event(r, id, "Triage", "Triage assessment recorded");
        await audit(r, "TRIAGE", "EREncounter", id, { assessmentId: result.id });
        return result;
      });
    },
    prioritize(id: string, priority: number) {
      return write("triage", async (r) => {
        const entry = await r.get("patient_queues", id);
        const visit = await r.get("encounters", entry.encounter_id, true);
        const current = await queue(r, visit.id);
        if (visit.status !== "waiting" || current.id !== id) conflict("Only the active waiting queue can be reprioritized");
        const result = await r.update("patient_queues", id, { priority });
        await audit(r, "REPRIORITIZE", "PatientQueue", id, { priority });
        await event(r, visit.id, "Queue", "Waiting priority updated");
        return result;
      });
    },
    assignBay(id: string, bayId: string) {
      return write("allocate", async (r) => {
        if ((await r.get("encounters", id, true)).status !== "waiting") conflict("Encounter is not waiting for treatment");
        const entry = await queue(r, id);
        const bay = await r.get("treatment_bays", bayId, true);
        if (bay.operational_status !== "Active" || bay.readiness !== "Available") conflict("Bay is unavailable");
        const result = await r.insert("patient_assignments", { encounter_id: id, bay_id: bayId });
        await r.update("treatment_bays", bayId, { readiness: "Reserved" });
        await r.update("patient_queues", entry.id, { status: "completed", exited_at: new Date() });
        await r.update("encounters", id, { status: "treatment", treatment_priority: entry.priority });
        await event(r, id, "Bay assignment", "Encounter moved to treatment");
        await audit(r, "ASSIGN", "TreatmentBay", bayId, { assignmentId: result.id });
        return result;
      });
    },
    assignStaff(id: string, staffId: string) {
      return write("allocate", async (r) => {
        if ((await r.get("encounters", id, true)).status !== "treatment") conflict("Encounter is not under treatment");
        const staff = await r.get("staff", staffId, true);
        if (staff.employment_status !== "Active" || staff.availability !== "Available") conflict("Staff member is unavailable");
        const result = await r.insert("patient_assignments", { encounter_id: id, staff_id: staffId });
        await r.update("staff", staffId, { availability: "Busy" });
        await event(r, id, "Staff assignment", "Staff responsibility assigned");
        await audit(r, "ASSIGN", "Staff", staffId, { assignmentId: result.id });
        return result;
      });
    },
    releaseAssignment(id: string) {
      return write("allocate", async (r) => {
        const original = await r.get("patient_assignments", id);
        const visit = await r.get("encounters", original.encounter_id, true);
        const current = await r.get("patient_assignments", id);
        if (current.released_at) conflict("Assignment has already been released");
        const result = await release(r, current, new Date());
        if (current.bay_id) {
          const assignments = await r.activeAssignments("encounter_id", visit.id);
          for (const assignment of assignments) await release(r, assignment, new Date());
          await r.update("encounters", visit.id, { status: "waiting" });
          await r.insert("patient_queues", { encounter_id: visit.id, status: "waiting", priority: visit.treatment_priority });
        }
        await event(r, visit.id, "Assignment release", "Assignment released");
        await audit(r, "RELEASE", "PatientAssignment", id);
        return result;
      });
    },
    discharge(id: string, disposition: "discharged" | "admitted") {
      return write("allocate", async (r) => {
        if ((await r.get("encounters", id, true)).status !== "treatment") conflict("Encounter is not under treatment");
        const now = new Date();
        for (const assignment of await r.activeAssignments("encounter_id", id)) await release(r, assignment, now);
        const result = await r.update("encounters", id, { status: disposition, discharged_at: now });
        await event(r, id, "Disposition", "Treatment completed");
        await audit(r, "DISPOSITION", "EREncounter", id, { disposition });
        return result;
      });
    },
    save(table: Managed, id: string | undefined, data: Fields, reason?: string) {
      return write(management[table], async (r) => {
        const previous = id ? await r.get(table, id, true) : undefined;
        const next = { ...previous, ...data };
        if (table === "staff" && id && (await r.activeAssignments("staff_id", id)).length &&
            (next.employment_status !== "Active" || next.availability !== "Busy")) conflict("Staff member has active responsibilities");
        if (table === "treatment_bays") {
          const occupied = id && (await r.activeAssignments("bay_id", id)).length > 0;
          if (occupied && (next.operational_status !== "Active" || ("readiness" in data && next.readiness !== "Occupied"))) {
            conflict("Bay has an active assignment");
          }
          if (data.readiness === "Occupied") {
            if (!occupied) conflict("Occupancy requires an active assignment");
            data = { ...data, readiness: previous.readiness };
          }
        }
        if (table === "resources" && next.quantity_available > next.quantity_total) conflict("Available inventory exceeds capacity");
        if (!Object.keys(data).length) conflict("At least one record field is required");
        if (table === "resources" && id) data = { ...data, updated_at: new Date() };
        const result = id ? await r.update(table, id, data) : await r.insert(table, data);
        if (table === "resources") {
          await r.insert("resource_transactions", {
            resource_id: result.id, quantity_delta: result.quantity_available - (previous?.quantity_available ?? 0),
            reason: reason ?? "Administrative adjustment", actor_id: actor.id,
          });
        }
        await audit(r, id ? "UPDATE" : "CREATE", table, result.id, { fields: Object.keys(data) });
        return result;
      });
    },
    adjust(id: string, delta: number, reason: string) {
      return write("manageResource", async (r) => {
        const row = await r.get("resources", id, true);
        const quantity = row.quantity_available + delta;
        if (quantity < 0 || quantity > row.quantity_total) conflict("Adjustment exceeds inventory bounds");
        const result = await r.update("resources", id, { quantity_available: quantity, updated_at: new Date() });
        const adjustment = await r.insert("resource_transactions", {
          resource_id: id, quantity_delta: delta, reason, actor_id: actor.id,
        });
        await audit(r, "ADJUST", "Resource", id, { transactionId: adjustment.id, delta });
        return result;
      });
    },
    readNotification(id: string) {
      return write("read", async (r) => {
        const row = await r.get("notifications", id, true);
        if (row.recipient_id !== actor.id) missing();
        return row.read_at ? row : r.update("notifications", id, { read_at: new Date() });
      });
    },
  };
}
