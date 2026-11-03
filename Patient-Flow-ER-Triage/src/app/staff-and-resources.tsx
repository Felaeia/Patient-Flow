import { ModulePage } from "../components/ModulePage";
import { StaffResources } from "../components/StaffResources";
import { useSimulation } from "../components/SimulationProvider";

export default function StaffAndResourcesPage() {
  const { staff } = useSimulation();
  return (
    <ModulePage title="Staff and Resources">
      <StaffResources staff={staff} />
    </ModulePage>
  );
}
