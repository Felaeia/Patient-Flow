import { z } from "zod";

const text = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(2000);
const optional = z.string().trim().max(200).transform((value) => value || null).nullable().optional();
const date = z.union([z.iso.date(), z.literal("").transform(() => null), z.null()]).optional();
const code = text.regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const qty = z.number().int().min(0).max(2147483647);
export const id = z.string().regex(/^[1-9][0-9]{0,18}$/).refine((value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
export const priority = z.number().int().min(1).max(5);
export const listQuery = z.strictObject({
  search: z.string().trim().max(200).optional(), status: z.string().trim().max(100).optional(),
  page: z.string().regex(/^\d{1,6}$/).transform(Number).pipe(z.number().min(1)).optional(),
  pageSize: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().min(1).max(50)).optional(),
  sort: z.enum(["asc", "desc"]).optional(),
});
export const patient = z.strictObject({
  patient_code: code.optional(), first_name: optional, middle_name: optional, last_name: optional,
  date_of_birth: date, sex: text, contact_number: optional, emergency_contact: optional,
});
export const visit = z.strictObject({ chief_complaint: note });
export const registration = patient.extend(visit.shape);
export const bay = z.strictObject({
  code, name: text, type: text, location: text,
  operational_status: z.enum(["Active", "Maintenance", "Out of Service"]),
  readiness: z.enum(["Available", "Reserved", "Cleaning", "Occupied"]),
});
export const staff = z.strictObject({
  employee_code: code, first_name: text, last_name: text, clinical_role: z.enum(["Doctor", "Nurse", "Triage"]), department: text, shift: text,
  employment_status: z.enum(["Active", "Inactive"]), availability: z.enum(["Available", "Busy", "On Break", "Off Duty"]),
});
export const resource = z.strictObject({
  code, name: text, category: text, kind: z.enum(["Consumable", "Reusable"]),
  quantity_total: qty, quantity_available: qty, unit: text, location: text,
  status: z.enum(["Available", "In Use", "Maintenance", "Unavailable"]), reason: note.optional(),
});
export const adjustment = z.strictObject({ delta: z.number().int().min(-2147483647).max(2147483647).refine((value) => value !== 0), reason: note });
export const patch = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.partial().refine((value) => Object.keys(value).length > 0, "At least one field is required");
