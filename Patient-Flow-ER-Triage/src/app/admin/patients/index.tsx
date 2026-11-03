import { router } from "expo-router";
import type { PatientRecord } from "../../../database/models";
import { ManagementPage, type ManagementConfig } from "../../../components/admin/ManagementPage";
import { useAdminService } from "../../../components/admin/useAdminService";

export default function PatientManagement() {
  const service = useAdminService();
  const config: ManagementConfig<PatientRecord> = {
    title: "Patient Management", description: "Register identities and ER encounters without assigning a triage level.", addLabel: "Add Patient",
    filterPlaceholder: "Status: triage, waiting, treatment…",
    fields: [
      { key: "patientCode", label: "Patient Code / MRN", placeholder: "Generated when blank" },
      { key: "firstName", label: "First Name" }, { key: "middleName", label: "Middle Name" }, { key: "lastName", label: "Last Name" },
      { key: "dateOfBirth", label: "Date of Birth", placeholder: "YYYY-MM-DD" }, { key: "sex", label: "Sex", required: true },
      { key: "contactNumber", label: "Contact Number" }, { key: "emergencyContact", label: "Emergency Contact" },
      { key: "chiefComplaint", label: "Chief Complaint", required: true, createOnly: true },
    ],
    load: async (...args) => (await service).patients.list(...args),
    save: async (id, values) => {
      const api = (await service).patients;
      if (id === null) await api.create({ ...values, sex: values.sex, chiefComplaint: values.chiefComplaint });
      else await api.update(Number(id), { ...values, sex: values.sex });
    },
    summary: (row) => ({ title: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ") || "Unidentified Patient", code: row.patientCode, status: row.currentStatus ?? "No active encounter", details: [`Sex: ${row.sex}`, `Encounters: ${row.encounterCount ?? 0}`, row.contactNumber ? `Contact: ${row.contactNumber}` : "Contact unavailable"] }),
    onDetails: (row) => router.push(`/admin/patients/${row.id}`),
  };
  return <ManagementPage config={config} />;
}
