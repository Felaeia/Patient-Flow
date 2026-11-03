import { createContext, useContext, useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import { getPatientFlow } from "../database/open";
import type { FlowSnapshot } from "../simulation/patientFlow";
import { PatientModal } from "./PatientModal";
import { useAuth } from "../auth/AuthProvider";

type SimulationView = FlowSnapshot & {
  handleSelectPatient: (id: string | null) => void;
  handleTriage: (id: string, esi: number) => void;
};
const SimulationContext = createContext<SimulationView | null>(null);

/** Presents committed SQLite state and forwards actions to the simulation service. */
export function SimulationProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<FlowSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const { actor } = useAuth();

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function start() {
      try {
        const flow = await getPatientFlow();
        const initial = await flow.load();
        if (!active) return;
        setSnapshot(initial);

        async function tick() {
          try {
            const next = await flow.tick();
            if (!active) return;
            setSnapshot(next);
            timer = setTimeout(tick, 1000);
          } catch (cause) {
            if (active) setError(`Simulation paused. ${String(cause)}`);
          }
        }

        timer = setTimeout(tick, 1000);
      } catch (cause) {
        if (active) setError(`Could not load TriFlow database. ${String(cause)}`);
      }
    }
    void start();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt]);

  async function handleTriage(id: string, esi: number) {
    try {
      const flow = await getPatientFlow();
      setSnapshot(await flow.triage(id, esi, actor));
    } catch (cause) {
      setError(`Could not save triage. ${String(cause)}`);
    }
  }

  return (
    <SimulationContext.Provider value={snapshot && {
      ...snapshot, handleSelectPatient: setSelectedPatientId, handleTriage,
    }}>
      {error && (
        <View className="gap-2 bg-red-50 p-4">
          <Text accessibilityRole="alert" className="text-red-900">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            setError(null);
            setAttempt((previous) => previous + 1);
          }}>
            <Text className="font-semibold text-red-900">Reload database view</Text>
          </Pressable>
        </View>
      )}
      {snapshot ? children : !error && <Text className="p-4">Opening TriFlow database…</Text>}
      <PatientModal
        patient={snapshot?.patients.find((patient) => patient.id === selectedPatientId)}
        onClose={() => setSelectedPatientId(null)}
        onTriage={handleTriage}
      />
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  const simulation = useContext(SimulationContext);
  if (!simulation) throw new Error("SimulationProvider is required");
  return simulation;
}
