import type { Pool, PoolClient } from "pg";
import { missing } from "./errors.js";

export const lists = {
  patient_records: { search: "concat_ws(' ', patient_code, first_name, middle_name, last_name)", filter: "current_status" },
  encounters: { search: "encounter_code", filter: "status" },
  patient_queues: { search: "encounter_id::text", filter: "status" },
  treatment_bays: { search: "concat_ws(' ', code, name)", filter: "operational_status" },
  staff: { search: "concat_ws(' ', employee_code, first_name, last_name)", filter: "concat_ws('|', employment_status, clinical_role, availability)" },
  resources: { search: "concat_ws(' ', code, name)", filter: "concat_ws('|', status, category)" },
  notifications: { search: "title", filter: "CASE WHEN read_at IS NULL THEN 'unread' ELSE 'read' END" },
  event_logs: { search: "category", filter: "category" },
  audit_logs: { search: "entity_id", filter: "action" },
} as const;
export type ListTable = keyof typeof lists;
type Table = ListTable | "triage_assessments" | "patient_assignments" | "resource_transactions";
export interface ListQuery { search?: string; status?: string; page?: number; pageSize?: number; sort?: "asc" | "desc" }
export type Fields = Record<string, unknown>;
const safe = (name: string) => {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid SQL identifier");
  return name;
};

const patientView = `SELECT p.*, e.status current_status, e.encounter_count
  FROM patient_records p LEFT JOIN LATERAL (
    SELECT status, count(*) OVER()::int encounter_count FROM encounters WHERE patient_id=p.id
    ORDER BY arrival_at DESC,id DESC LIMIT 1
  ) e ON true WHERE p.archived_at IS NULL`;
const bayView = `SELECT b.*, CASE WHEN a.id IS NOT NULL THEN 'Occupied' ELSE b.readiness END occupancy_status,
  CASE WHEN a.id IS NOT NULL THEN 'occupied' WHEN b.operational_status='Active' AND b.readiness='Available'
    THEN 'available' ELSE 'unavailable' END status, a.encounter_id patient_id
  FROM treatment_bays b LEFT JOIN patient_assignments a ON a.bay_id=b.id AND a.released_at IS NULL`;
const staffView = `SELECT s.*, clinical_role role, concat_ws(' ',first_name,last_name) name,
  CASE WHEN employment_status='Inactive' THEN 'Unavailable' ELSE CASE availability WHEN 'Available' THEN 'Idle' WHEN 'Busy' THEN 'Busy' ELSE 'Unavailable' END END status,
  a.encounter_id assigned_patient_id FROM staff s
  LEFT JOIN patient_assignments a ON a.staff_id=s.id AND a.released_at IS NULL`;

export class Repository {
  constructor(private db: Pool | PoolClient) {}

  private async rows(sql: string, values: unknown[] = []) {
    return (await this.db.query(sql, values)).rows;
  }

  async get(table: Table, id: string, lock = false) {
    return (await this.rows(`SELECT * FROM ${table} WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]))[0] ?? missing();
  }

  async insert(table: Table, data: Fields) {
    const keys = Object.keys(data).map(safe);
    const binds = keys.map((_, index) => `$${index + 1}`);
    return (await this.rows(`INSERT INTO ${table}(${keys}) VALUES (${binds}) RETURNING *`, Object.values(data)))[0];
  }

  async update(table: Table, id: string, data: Fields) {
    const values = Object.values(data);
    const sets = Object.keys(data).map((key, index) => `${safe(key)}=$${index + 1}`);
    return (await this.rows(`UPDATE ${table} SET ${sets} WHERE id=$${values.length + 1} RETURNING *`, [...values, id]))[0] ?? missing();
  }

  async list(table: ListTable, query: ListQuery, scope?: string) {
    const views = { patient_records: patientView, treatment_bays: bayView, staff: staffView };
    const from = Object.hasOwn(views, table) ? `(${views[table as keyof typeof views]}) records` : table;
    const { search = "", status = "", page = 1, pageSize = 10, sort = "desc" } = query;
    const { search: expression, filter } = lists[table];
    const restriction = table === "notifications" ? " AND recipient_id=$3" :
      table === "encounters" ? " AND patient_id=$3" : table === "resources" ? " AND archived_at IS NULL" : "";
    const where = `WHERE ($1='' OR strpos(lower(${expression}),lower($1))>0)
      AND ($2='' OR $2=ANY(string_to_array(${filter},'|')))${restriction}`;
    const args = restriction.includes("$3") ? [search,status,scope] : [search,status];
    const rows = await this.rows(`SELECT * FROM ${from} ${where} ORDER BY id ${sort === "asc" ? "ASC" : "DESC"}
      LIMIT $${args.length+1} OFFSET $${args.length+2}`, [...args,pageSize,(page-1)*pageSize]);
    const [{ total }] = await this.rows(`SELECT count(*)::int total FROM ${from} ${where}`, args);
    return { rows, total, page, pageSize };
  }

  activeAssignments(column: "encounter_id" | "bay_id" | "staff_id", id: string) {
    return this.rows(`SELECT * FROM patient_assignments WHERE ${column}=$1 AND released_at IS NULL ORDER BY id`, [id]);
  }

  activeQueue(encounterId: string) {
    return this.rows("SELECT * FROM patient_queues WHERE encounter_id=$1 AND exited_at IS NULL FOR UPDATE", [encounterId]);
  }

  async patientDetails(id: string, query: ListQuery) {
    const patient = await this.get("patient_records", id);
    const encounters = await this.list("encounters", query, id);
    const args = [id, query.pageSize ?? 10, ((query.page ?? 1) - 1) * (query.pageSize ?? 10)];
    const history = "JOIN encounters e ON e.id=h.encounter_id WHERE e.patient_id=$1 ORDER BY h.id DESC LIMIT $2 OFFSET $3";
    const assessments = await this.rows(`SELECT h.*,e.encounter_code FROM triage_assessments h ${history}`, args);
    const events = await this.rows(`SELECT h.* FROM event_logs h ${history}`, args);
    const assignments = await this.rows(`SELECT h.*, b.name bay_name, concat_ws(' ',s.first_name,s.last_name) staff_name
      FROM patient_assignments h LEFT JOIN treatment_bays b ON b.id=h.bay_id LEFT JOIN staff s ON s.id=h.staff_id ${history}`, args);
    return { patient, encounters, assessments, events, assignments };
  }

  async dashboard() {
    const patients = await this.rows(`SELECT e.*, concat_ws(' ',p.first_name,p.middle_name,p.last_name) name,
      p.sex, date_part('year',age(p.date_of_birth)) age, (SELECT entered_at FROM patient_queues WHERE encounter_id=e.id AND priority IS NOT NULL ORDER BY id DESC LIMIT 1) queue_entered_at, q.priority esi,
      a.bay_id, (SELECT esi FROM triage_assessments WHERE encounter_id=e.id ORDER BY id DESC LIMIT 1) assessed_esi
      FROM encounters e JOIN patient_records p ON p.id=e.patient_id
      LEFT JOIN patient_queues q ON q.encounter_id=e.id AND q.exited_at IS NULL
      LEFT JOIN patient_assignments a ON a.encounter_id=e.id AND a.bay_id IS NOT NULL AND a.released_at IS NULL
      WHERE e.archived_at IS NULL AND e.status IN ('triage','waiting','treatment') ORDER BY CASE WHEN e.status='waiting' THEN q.priority END NULLS LAST, q.entered_at, e.arrival_at, e.id`);
    const bays = await this.rows(bayView + " ORDER BY b.id");
    const staff = await this.rows(staffView + " ORDER BY s.id");
    const events = await this.rows("SELECT * FROM event_logs ORDER BY id DESC LIMIT 30");
    const counts = await this.rows("SELECT status,count(*)::int total FROM encounters GROUP BY status");
    return { patients, bays, staff, events, counts, now: new Date() };
  }

  async ready() {
    await this.db.query("SELECT 1 FROM schema_migrations WHERE version='004_legacy_metadata.sql'").then(({ rowCount }) => {
      if (rowCount !== 1) throw new Error("Migrations required");
    });
  }
}
