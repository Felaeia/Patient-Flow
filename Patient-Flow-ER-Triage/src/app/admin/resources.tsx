import type { ResourceRecord } from "../../database/models";
import { ManagementPage, type ManagementConfig } from "../../components/admin/ManagementPage";
import { useAdminService } from "../../components/admin/useAdminService";
export default function ResourceManagement() {
  const service = useAdminService();
  const config: ManagementConfig<ResourceRecord> = {
    title: "Resource Management", description: "Track equipment and supplies with audited inventory adjustments.", addLabel: "Add Resource", filterPlaceholder: "Resource status",
    fields: [{ key: "code", label: "Resource Code", required: true }, { key: "name", label: "Resource Name", required: true }, { key: "category", label: "Category", required: true }, { key: "kind", label: "Inventory Type", required: true, placeholder: "Consumable or Reusable" }, { key: "quantityTotal", label: "Quantity Total", required: true, keyboard: "numeric" }, { key: "quantityAvailable", label: "Quantity Available", required: true, keyboard: "numeric" }, { key: "unit", label: "Unit", required: true }, { key: "location", label: "Location", required: true }, { key: "status", label: "Status", required: true, placeholder: "Available, In Use, Maintenance, Unavailable" }, { key: "reason", label: "Adjustment Reason", required: true }],
    initial: { kind: "Reusable", quantityTotal: "0", quantityAvailable: "0", unit: "units", status: "Available", reason: "Administrative adjustment" },
    load: async (...args) => (await service).resources.list(...args), save: async (id, values) => (await service).resources.save(id === null ? null : Number(id), { ...values, quantityTotal: Number(values.quantityTotal), quantityAvailable: Number(values.quantityAvailable) } as any, values.reason),
    summary: (row) => ({ title: row.name, code: row.code, status: row.status, details: [`${row.quantityAvailable} / ${row.quantityTotal} ${row.unit} available`, `Category: ${row.category}`, `Location: ${row.location}`] }),
  }; return <ManagementPage config={config} />;
}
