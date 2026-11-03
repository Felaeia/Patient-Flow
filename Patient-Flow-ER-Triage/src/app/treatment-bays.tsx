import { ModulePage } from "../components/ModulePage";
import { TreatmentBays } from "../components/TreatmentBays";
import { useSimulation } from "../components/SimulationProvider";

export default function TreatmentBaysPage() {
  const { patients, staff, bays, handleSelectPatient } = useSimulation();
  return (
    <ModulePage title="Treatment Bay Availability">
      <TreatmentBays
        beds={bays}
        treatmentPatients={patients.filter((patient) => patient.status === "treatment")}
        staff={staff}
        onSelect={handleSelectPatient}
      />
    </ModulePage>
  );
}
