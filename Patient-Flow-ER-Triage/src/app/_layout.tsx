import { Slot } from "expo-router";
import { AppShell } from "../components/AppShell";
import { SimulationProvider } from "../components/SimulationProvider";
import { AuthProvider } from "../auth/AuthProvider";
import "../../global.css";

export default function RootLayout() {
  return (
    <AuthProvider>
      <SimulationProvider>
        <AppShell>
          <Slot />
        </AppShell>
      </SimulationProvider>
    </AuthProvider>
  );
}
