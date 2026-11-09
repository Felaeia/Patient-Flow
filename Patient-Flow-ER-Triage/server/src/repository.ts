import type { SQLInputValue } from "node:sqlite";
import type { Database } from "./db.js";
import { missing } from "./errors.js";

export const lists = {
  patient_records: { search: "concat_ws(' ', patient_code, first_name, middle_name, last_name)", filter: "current_status" },
  encounters: { search: "encounter_code", filter: "status" },
  patient_queues: { search: "CAST(encounter_id AS TEXT)", filter: "status" },
  treatment_bays: { search: "concat_ws(' ', code, name)", filter: "operational_status" },
  staff: { search: "concat_ws(' ', employee_code, first_name, last_name)", filter: "employment_status, clinical_role, availability" },
  resources: { search: "concat_ws(' ', code, name)", filter: "status, category" },
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

const patientView = `SELECT p.*, e.status current_status,
  CASE WHEN e.id IS NOT NULL THEN (SELECT count(*) FROM encounters WHERE patient_id=p.id) END encounter_count
  FROM patient_records p LEFT JOIN encounters e ON e.id=(
    SELECT id FROM encounters WHERE patient_id=p.id ORDER BY arrival_at DESC, id DESC LIMIT 1
  ) WHERE p.archived_at IS NULL`;
const bayView = `SELECT b.*, CASE WHEN a.id IS NOT NULL THEN 'Occupied' ELSE b.readiness END occupancy_status,
  CASE WHEN a.id IS NOT NULL THEN 'occupied' WHEN b.operational_status='Active' AND b.readiness='Available'
    THEN 'available' ELSE 'unavailable' END status, a.encounter_id patient_id
  FROM treatment_bays b LEFT JOIN patient_assignments a ON a.bay_id=b.id AND a.released_at IS NULL`;
const staffView = `SELECT s.*, clinical_role role, concat_ws(' ',first_name,last_name) name,
  CASE WHEN employment_status='Inactive' THEN 'Unavailable' ELSE CASE availability WHEN 'Available' THEN 'Idle' WHEN 'Busy' THEN 'Busy' ELSE 'Unavailable' END END status,
  a.encounter_id assigned_patient_id FROM staff s
  LEFT JOIN patient_assignments a ON a.staff_id=s.id AND a.released_at IS NULL`;

const jsonFields = new Set(["details", "vitals"]);
const booleanFields = new Set(["is_unidentified", "legacy_unidentified"]);

function encode(value: unknown, column?: string): SQLInputValue {
  if (value == null) return null;
  if (column && jsonFields.has(column)) return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new TypeError("Unsupported SQLite parameter");
}

export class Repository {
  constructor(private db: Database) {}

  private rows(sql: string, values: unknown[] = []): any[] {
    const statement = this.db.prepare(sql);
    // Keep 64-bit IDs exact and preserve the API's decimal string representation.
    statement.setReadBigInts(true);
    const bindings = Object.fromEntries(values.map((value, index) => ["$" + (index + 1), encode(value)]));
    return statement.all(bindings).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (typeof value === "bigint") {
        if (booleanFields.has(key)) return [key, value !== 0n];
        if (key === "id" || key.endsWith("_id")) return [key, value.toString()];
        return [key, Number(value)];
      }
      return [key, typeof value === "string" && jsonFields.has(key) ? JSON.parse(value) : value];
    })));
  }

  get(table: Table, id: string) {
    return this.rows(`SELECT * FROM ${table} WHERE id=$1`, [id])[0] ?? missing();
  }

  insert(table: Table, data: Fields) {
    const keys = Object.keys(data).map(safe);
    const binds = keys.map((_, index) => `$${index + 1}`);
    const values = keys.map((key) => encode(data[key], key));
    return this.rows(`INSERT INTO ${table}(${keys}) VALUES (${binds}) RETURNING *`, values)[0];
  }

  update(table: Table, id: string, data: Fields) {
    const values = Object.entries(data).map(([key, value]) => encode(value, key));
    const sets = Object.keys(data).map((key, index) => `${safe(key)}=$${index + 1}`);
    return this.rows(`UPDATE ${table} SET ${sets} WHERE id=$${values.length + 1} RETURNING *`, [...values, id])[0] ?? missing();
  }

  list(table: ListTable, query: ListQuery, scope?: string) {
    const views = { patient_records: patientView, treatment_bays: bayView, staff: staffView };
    const from = Object.hasOwn(views, table) ? `(${views[table as keyof typeof views]}) records` : table;
    const { search = "", status = "", page = 1, pageSize = 10, sort = "desc" } = query;
    const { search: expression, filter } = lists[table];
    const restriction = table === "notifications" ? " AND recipient_id=$3" :
      table === "encounters" ? " AND patient_id=$3" : table === "resources" ? " AND archived_at IS NULL" : "";
    const where = `WHERE ($1='' OR instr(fold_case(${expression}),fold_case($1))>0)
      AND ($2='' OR $2 IN (${filter}))${restriction}`;
    const args = restriction.includes("$3") ? [search,status,scope] : [search,status];
    const rows = this.rows(`SELECT * FROM ${from} ${where} ORDER BY id ${sort === "asc" ? "ASC" : "DESC"}
      LIMIT $${args.length+1} OFFSET $${args.length+2}`, [...args,pageSize,(page-1)*pageSize]);
    const [{ total }] = this.rows(`SELECT count(*) total FROM ${from} ${where}`, args);
    return { rows, total, page, pageSize };
  }

  activeAssignments(column: "encounter_id" | "bay_id" | "staff_id", id: string) {
    return this.rows(`SELECT * FROM patient_assignments WHERE ${column}=$1 AND released_at IS NULL ORDER BY id`, [id]);
  }

  activeQueue(encounterId: string) {
    return this.rows("SELECT * FROM patient_queues WHERE encounter_id=$1 AND exited_at IS NULL", [encounterId]);
  }

  patientDetails(id: string, query: ListQuery) {
    const patient = this.get("patient_records", id);
    const encounters = this.list("encounters", query, id);
    const args = [id, query.pageSize ?? 10, ((query.page ?? 1) - 1) * (query.pageSize ?? 10)];
    const history = "JOIN encounters e ON e.id=h.encounter_id WHERE e.patient_id=$1 ORDER BY h.id DESC LIMIT $2 OFFSET $3";
    const assessments = this.rows(`SELECT h.*,e.encounter_code FROM triage_assessments h ${history}`, args);
    const events = this.rows(`SELECT h.* FROM event_logs h ${history}`, args);
    const assignments = this.rows(`SELECT h.*, b.name bay_name, concat_ws(' ',s.first_name,s.last_name) staff_name
      FROM patient_assignments h LEFT JOIN treatment_bays b ON b.id=h.bay_id LEFT JOIN staff s ON s.id=h.staff_id ${history}`, args);
    return { patient, encounters, assessments, events, assignments };
  }

  dashboard() {
    const patients = this.rows(`SELECT e.*, concat_ws(' ',p.first_name,p.middle_name,p.last_name) name,
      p.sex, CAST(strftime('%Y','now') AS INTEGER) - CAST(strftime('%Y',p.date_of_birth) AS INTEGER)
        - CASE WHEN p.date_of_birth <= date('now') THEN strftime('%m-%d','now') < substr(p.date_of_birth,6)
          ELSE -(strftime('%m-%d','now') > substr(p.date_of_birth,6)) END age,
      (SELECT entered_at FROM patient_queues WHERE encounter_id=e.id AND priority IS NOT NULL ORDER BY id DESC LIMIT 1) queue_entered_at, q.priority esi,
      a.bay_id, (SELECT esi FROM triage_assessments WHERE encounter_id=e.id ORDER BY id DESC LIMIT 1) assessed_esi
      FROM encounters e JOIN patient_records p ON p.id=e.patient_id
      LEFT JOIN patient_queues q ON q.encounter_id=e.id AND q.exited_at IS NULL
      LEFT JOIN patient_assignments a ON a.encounter_id=e.id AND a.bay_id IS NOT NULL AND a.released_at IS NULL
      WHERE e.archived_at IS NULL AND e.status IN ('triage','waiting','treatment') ORDER BY CASE WHEN e.status='waiting' THEN q.priority END NULLS LAST, q.entered_at NULLS LAST, e.arrival_at, e.id`);
    const bays = this.rows(bayView + " ORDER BY b.id");
    const staff = this.rows(staffView + " ORDER BY s.id");
    const events = this.rows("SELECT * FROM event_logs ORDER BY id DESC LIMIT 30");
    const counts = this.rows("SELECT status,count(*) total FROM encounters GROUP BY status");
    return { patients, bays, staff, events, counts, now: new Date() };
  }
}
