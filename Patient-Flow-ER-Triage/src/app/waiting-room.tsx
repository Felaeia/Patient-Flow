import { ModulePage } from "../components/ModulePage";
import { WaitingRoom } from "../components/WaitingRoom";
import { useSimulation } from "../components/SimulationProvider";

export default function WaitingRoomPage() {
  const { patients, simTime, handleSelectPatient } = useSimulation();
  return (
    <ModulePage title="Waiting Room">
      <WaitingRoom
        patients={patients.filter((patient) => patient.status === "waiting")}
        simTime={simTime}
        onSelect={handleSelectPatient}
      />
    </ModulePage>
  );
}
