import { ModulePage } from "../components/ModulePage";
import { TriageInbox } from "../components/TriageInbox";
import { useSimulation } from "../components/SimulationProvider";

export default function InboxPage() {
  const { patients, simTime, handleSelectPatient, handleTriage, busy } = useSimulation();
  return (
    <ModulePage title="Inbox">
      <TriageInbox
        patients={patients.filter((patient) => patient.status === "triage")}
        simTime={simTime}
        onSelect={handleSelectPatient}
        onTriage={handleTriage}
        busy={busy}
      />
    </ModulePage>
  );
}
