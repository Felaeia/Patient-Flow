import type {
  AdminBay,
  AdminStaff,
  PatientRecord,
  ResourceRecord,
} from "../database/models";
import type {
  BayInput,
  Page,
  PatientInput,
  ResourceInput,
  StaffInput,
} from "../database/adminService";
import type { Client } from "./client";

const snake = (key: string) =>
  key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
function encode(input: object) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [snake(key), value]),
  );
}
function decode<T>(row: Record<string, unknown>, numericId = true): T {
  const converted = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
  if (numericId && "id" in converted) converted.id = Number(converted.id);
  if (typeof converted.dateOfBirth === "string")
    converted.dateOfBirth = converted.dateOfBirth.slice(0, 10);
  if (typeof converted.isUnidentified === "boolean")
    converted.isUnidentified = converted.isUnidentified ? 1 : 0;
  return converted as T;
}
type Row = Record<string, unknown>;

export function apiAdmin(request: Client) {
  const list =
    <T>(path: string, numericId = true) =>
    async (
      search = "",
      status = "",
      page = 1,
      pageSize = 10,
    ): Promise<Page<T>> => {
      const query = new URLSearchParams({
        search,
        status,
        page: String(page),
        pageSize: String(pageSize),
      });
      const result = await request<Page<Row>>(path + "?" + query);
      return {
        ...result,
        rows: result.rows.map((row) => decode<T>(row, numericId)),
      };
    };
  async function save(path: string, id: number | string | null, input: object) {
    await request(
      id === null ? path : path + "/" + id,
      id === null ? "POST" : "PATCH",
      encode(input),
    );
  }
  return {
    patients: {
      list: list<PatientRecord>("/patients"),
      async details(
        id: number,
      ): Promise<[PatientRecord | null, Row[], Row[], Row[], Row[]]> {
        const value = await request<{
          patient: Row;
          encounters: Page<Row>;
          assessments: Row[];
          events: Row[];
          assignments: Row[];
        }>("/patients/" + id + "?pageSize=50");
        return [
          decode<PatientRecord>(value.patient),
          value.encounters.rows.map((row) => decode<Row>(row)),
          value.assessments.map((row) =>
            decode<Row>({ ...row, assessed_at: row.created_at }),
          ),
          value.events.map((row) => decode<Row>({ ...row, text: row.message })),
          value.assignments.map((row) => decode<Row>(row)),
        ];
      },
      async create(input: PatientInput) {
        const value = await request<{ patient: { id: string } }>(
          "/patients",
          "POST",
          encode({
            ...input,
            patientCode: input.patientCode?.trim() || undefined,
          }),
        );
        return Number(value.patient.id);
      },
      async update(id: number, input: Omit<PatientInput, "chiefComplaint">) {
        const { chiefComplaint: _, ...demographics } = input as PatientInput;
        await save("/patients", id, {
          ...demographics,
          patientCode: input.patientCode?.trim() || undefined,
        });
      },
      async createEncounter(id: number, complaint: string) {
        await request("/patients/" + id + "/encounters", "POST", {
          chief_complaint: complaint,
        });
      },
    },
    bays: {
      list: list<AdminBay>("/treatment-bays"),
      async counts() {
        const { bays } = await request<{ bays: AdminBay[] }>("/dashboard");
        return {
          available: bays.filter((row) => row.status === "available").length,
          occupied: bays.filter((row) => row.status === "occupied").length,
        };
      },
      save(id: number | null, { occupancyStatus, ...input }: BayInput) {
        return save("/treatment-bays", id, {
          ...input,
          readiness: occupancyStatus,
        });
      },
    },
    staff: {
      list: list<AdminStaff>("/staff", false),
      save(id: string | null, { role, ...input }: StaffInput) {
        return save("/staff", id, { ...input, clinicalRole: role });
      },
    },
    resources: {
      list: list<ResourceRecord>("/resources"),
      save(id: number | null, input: ResourceInput, reason: string) {
        return save("/resources", id, {
          ...input,
          reason: reason.trim() || undefined,
        });
      },
    },
  };
}
