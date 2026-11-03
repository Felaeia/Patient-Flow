import type { AdminStaff } from "../../database/models";
import { ManagementPage, type ManagementConfig } from "../../components/admin/ManagementPage";
import { useAdminService } from "../../components/admin/useAdminService";
export default function StaffManagement() {
  const service = useAdminService();
  const config: ManagementConfig<AdminStaff> = {
    title: "Staff Management", description: "Manage personnel records, shifts, and operational availability.", addLabel: "Add Staff", filterPlaceholder: "Employment status",
    fields: [{ key: "employeeCode", label: "Employee Code", required: true }, { key: "firstName", label: "First Name", required: true }, { key: "lastName", label: "Last Name", required: true }, { key: "role", label: "Clinical Role", required: true, placeholder: "Doctor, Nurse, Triage" }, { key: "department", label: "Department", required: true }, { key: "shift", label: "Shift", required: true }, { key: "availability", label: "Availability", required: true, placeholder: "Available, Busy, On Break, Off Duty" }, { key: "employmentStatus", label: "Employment Status", required: true, placeholder: "Active or Inactive" }],
    initial: { department: "Emergency Department", shift: "Unassigned", availability: "Available", employmentStatus: "Active" },
    load: async (...args) => (await service).staff.list(...args), save: async (id, values) => (await service).staff.save(id === null ? null : String(id), values as any),
    summary: (row) => ({ title: row.name, code: row.employeeCode, status: `${row.employmentStatus} · ${row.availability}`, details: [`Role: ${row.role}`, `Department: ${row.department}`, `Shift: ${row.shift}`] }),
  }; return <ManagementPage config={config} />;
}
