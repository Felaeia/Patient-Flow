import type { AdminBay } from "../../database/models";
import { ManagementPage, type ManagementConfig } from "../../components/admin/ManagementPage";
import { useAdminService } from "../../components/admin/useAdminService";
export default function BayManagement() {
  const service = useAdminService();
  const config: ManagementConfig<AdminBay> = {
    title: "Treatment Bay Management", description: "Manage bay configuration and operational availability.", addLabel: "Add Treatment Bay", filterPlaceholder: "Operational status",
    fields: [{ key: "code", label: "Bay Code", required: true }, { key: "name", label: "Bay Name", required: true }, { key: "type", label: "Bay Type", required: true }, { key: "location", label: "Location", required: true }, { key: "operationalStatus", label: "Operational Status", required: true, placeholder: "Active, Maintenance, Out of Service" }, { key: "occupancyStatus", label: "Occupancy Status", required: true, placeholder: "Available, Reserved, Cleaning" }],
    initial: { type: "General", location: "Emergency Department", operationalStatus: "Active", occupancyStatus: "Available" },
    load: async (...args) => (await service).bays.list(...args), save: async (id, values) => (await service).bays.save(id === null ? null : Number(id), values as any),
    stats: async () => { const counts = await (await service).bays.counts(); return `${counts?.available ?? 0} available · ${counts?.occupied ?? 0} occupied`; },
    summary: (row) => ({ title: row.name, code: row.code, status: `${row.operationalStatus} · ${row.occupancyStatus}`, details: [`Type: ${row.type}`, `Location: ${row.location}`] }),
  }; return <ManagementPage config={config} />;
}
