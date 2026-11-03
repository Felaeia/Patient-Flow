import { Slot } from "expo-router";
import { AppShell } from "../components/AppShell";
import { SimulationProvider } from "../components/SimulationProvider";
import "../../global.css";

export default function RootLayout() {
  return (
    <SimulationProvider>
      <AppShell>
        <Slot />
      </AppShell>
    </SimulationProvider>
  );
}
