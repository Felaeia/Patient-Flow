import type { AdminActor, Bay, FlowEvent, Patient } from "../database/models";
import { repositories } from "../database/repositories";
import { transaction, type Connection } from "../database/schema";
import { requirePermission } from "../auth/permissions";

type Disposition = "discharged" | "admitted";
type PatientInput = Omit<Patient, "status" | "arrivalTs" | "triageStartTs" | "esi" | "waitStartTs" | "bedId" | "treatmentProgress">;

const complaints = ["Chest Pain", "Fever", "Laceration", "Headache", "Stroke Symptoms"];
function syntheticPatient(id: string, index: number): PatientInput {
  return {
    id, age: 20 + index % 60, sex: index % 2 ? "F" : "M",
    complaint: complaints[index % complaints.length],
    vitals: { hr: 80, bpSys: 120, bpDia: 80, spo2: 98, temp: 37 },
    pain: index % 10, suggestedEsi: index % 5 + 1,
  };
}

/** Serializes simulation commands and returns committed database snapshots to the UI. */
export function createPatientFlow(db: Connection) {
  const repo = repositories(db);
  let pending: Promise<unknown> = Promise.resolve();
  function atomic<T>(work: () => Promise<T>): Promise<T> {
    const result = pending.then(() => transaction(db, work));
    pending = result.catch(() => undefined);
    return result;
  }

  async function clock() {
    const state = await db.getFirstAsync<{ tick: number; seeded: number }>("SELECT tick, seeded FROM SimulationState WHERE id=1");
    if (!state) throw new Error("Simulation state is missing");
    return state;
  }

  async function snapshot(simTime: number) {
    return {
      simTime,
      patients: await repo.patients.all(),
      staff: await repo.staff.all(),
      bays: await repo.bays.all(),
      events: await repo.events.recent(),
      metrics: await repo.dashboard(simTime),
    };
  }

  function log(patientId: string, ts: number, category: string, text: string, type: FlowEvent["type"] = "info") {
    return repo.events.create({ id: `${patientId}:${category}:${ts}`, patientId, ts, category, text, type });
  }

  async function register(input: PatientInput, tick: number) {
    await repo.patients.create({
      ...input, status: "triage", arrivalTs: tick, triageStartTs: tick,
      esi: null, waitStartTs: null, bedId: null, treatmentProgress: 0,
    });
    await repo.queue.add(input.id, "triage", tick);
    await log(input.id, tick, "Registration", `${input.id} registered for triage`);
  }

  async function triage(id: string, esi: number, tick: number) {
    const patient = await repo.patients.byId(id);
    if (!patient || patient.status !== "triage") throw new Error("Patient is no longer awaiting triage");
    await repo.assessments.create(id, esi);
    if (!(await repo.queue.update(id, "waiting", tick, esi)).changes) throw new Error("Patient has no active queue entry");
    await repo.patients.update({ ...patient, status: "waiting" });
    await log(id, tick, "Triage", `${id} triaged as ESI ${esi}.`);
  }

  async function assign(patient: Patient, bay: Bay, staffIds: string[], tick: number) {
    if (patient.status !== "waiting" || bay.status !== "available") throw new Error("Patient or treatment bay is unavailable");
    await repo.assignments.bay(patient.id, bay.id);
    await repo.bays.update(bay.id, "occupied");
    if (!(await repo.queue.complete(patient.id)).changes) throw new Error("Patient has no active queue entry");
    await repo.patients.update({ ...patient, status: "treatment" });
    const availableStaff = await repo.staff.available();
    for (const id of staffIds) {
      if (!availableStaff.some((member) => member.id === id)) throw new Error(`Staff member ${id} is unavailable`);
      await repo.assignments.staff(patient.id, id);
      await repo.staff.update(id, "Busy");
    }
    await log(patient.id, tick, "Bay assignment", `${patient.id} moved to Bay ${bay.id} (ESI ${patient.esi})`);
    if (staffIds.length) await log(patient.id, tick, "Staff assignment", `${patient.id} assigned staff: ${staffIds.join(", ")}`);
  }

  async function finish(patient: Patient, disposition: Disposition, tick: number) {
    if (patient.status !== "treatment") throw new Error("Patient is not under treatment");
    const assignments = (await repo.assignments.active()).filter((assignment) => assignment.patientId === patient.id);
    for (const assignment of assignments) {
      await repo.assignments.release(assignment.id);
      if (assignment.bayId !== null) {
        await repo.bays.update(assignment.bayId, "available");
        await log(patient.id, tick, "Bay release", `Bay ${assignment.bayId} became available`);
      }
      if (assignment.staffId !== null) await repo.staff.update(assignment.staffId, "Idle");
    }
    await repo.patients.update({ ...patient, status: disposition, treatmentProgress: 100 });
    await log(patient.id, tick, "Disposition", `${patient.id} treatment complete. Patient ${disposition}.`, "success");
  }

  return {
    load: () => atomic(async () => snapshot((await clock()).tick)),
    register: (input: PatientInput) => atomic(async () => {
      const { tick } = await clock();
      await register(input, tick);
      return snapshot(tick);
    }),
    triage: (id: string, esi: number, actor: AdminActor) => atomic(async () => {
      requirePermission(actor, "clinical:triage");
      const { tick } = await clock();
      await triage(id, esi, tick);
      return snapshot(tick);
    }),
    assign: (id: string, bayId: number, staffIds: string[]) => atomic(async () => {
      const { tick } = await clock();
      const patient = await repo.patients.byId(id);
      const bay = (await repo.bays.available()).find((candidate) => candidate.id === bayId);
      if (!patient || !bay) throw new Error("Patient or treatment bay is unavailable");
      await assign(patient, bay, staffIds, tick);
      return snapshot(tick);
    }),
    discharge: (id: string) => atomic(async () => {
      const { tick } = await clock();
      const patient = await repo.patients.byId(id);
      if (!patient) throw new Error("Patient does not exist");
      await finish(patient, "discharged", tick);
      return snapshot(tick);
    }),
    tick: () => atomic(async () => {
      const tick = (await clock()).tick + 1;
      await db.runAsync("UPDATE SimulationState SET tick=? WHERE id=1", tick);
      if (tick % 15 === 0 && Math.random() > 0.3) {
        const random = Math.floor(Math.random() * 60);
        await register(syntheticPatient(`P-S${tick}`, random), tick);
      }

      const patients = await repo.patients.all();
      for (const patient of patients.filter((candidate) => candidate.status === "treatment")) {
        const progress = patient.treatmentProgress + (patient.esi ? patient.esi * 1.5 : 5);
        if (progress >= 100) await finish(patient, Math.random() > 0.7 ? "admitted" : "discharged", tick);
        else await repo.patients.update({ ...patient, treatmentProgress: progress });
      }

      const bays = await repo.bays.available();
      const staff = await repo.staff.available();
      const doctors = staff.filter((member) => member.role === "Doctor");
      const nurses = staff.filter((member) => member.role === "Nurse");
      const waiting = patients.filter((patient) => patient.status === "waiting").sort((a, b) =>
        (a.esi ?? 5) - (b.esi ?? 5) || (a.waitStartTs ?? 0) - (b.waitStartTs ?? 0));
      for (const patient of waiting) {
        const bay = bays.shift();
        const doctor = doctors.shift();
        const nurse = nurses.shift();
        if (!bay || !doctor || !nurse) break;
        await assign(patient, bay, [doctor.id, nurse.id], tick);
      }
      return snapshot(tick);
    }),
    seed: () => atomic(async () => {
      const { seeded, tick } = await clock();
      if (seeded) return;
      for (let index = 0; index < 20; index++) {
        const id = `P-DEMO-${index + 1}`;
        if (await repo.patients.byId(id)) continue;
        await register(syntheticPatient(id, index), tick);
        if (index < 10) await triage(id, index % 5 + 1, tick);
      }
      await repo.notifications.create("Demo shift", "Synthetic patients are ready for triage.", "simulation");
      await db.runAsync("UPDATE SimulationState SET seeded=1 WHERE id=1");
    }),
  };
}

export type PatientFlow = ReturnType<typeof createPatientFlow>;
export type FlowSnapshot = Awaited<ReturnType<PatientFlow["load"]>>;
