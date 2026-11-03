import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import { apiFlow } from "../api/flow";
import { localMode } from "../api/client";
import { getPatientFlow } from "../database/open";
import type { FlowSnapshot } from "../simulation/patientFlow";
import { PatientModal } from "./PatientModal";
import { useAuth } from "../auth/AuthProvider";

type SimulationView = FlowSnapshot & {
  handleSelectPatient: (id: string | null) => void;
  handleTriage?: (id: string, esi: number) => void;
  busy: boolean;
};
const SimulationContext = createContext<SimulationView | null>(null);

/** Presents committed flow state from the configured data source. */
export function SimulationProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<FlowSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const { actor, request, can } = useAuth();
  const remote = useMemo(() => request && apiFlow(request), [request]);
  const pending = useRef(false);
  const mutation = useRef(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function start() {
      try {
        const flow = remote || (localMode ? await getPatientFlow() : undefined);
        if (!flow) return;
        const initial = await flow.load();
        if (!active) return;
        setSnapshot(initial);

        const tick = async () => {
          try {
            const revision = mutation.current;
            const next = await flow.tick();
            if (!active) return;
            if (!pending.current && revision === mutation.current) setSnapshot(next);
            timer = setTimeout(tick, remote ? 3000 : 1000);
          } catch (cause) {
            if (active) setError(`Refresh paused. ${String(cause)}`);
          }
        };

        timer = setTimeout(tick, remote ? 3000 : 1000);
      } catch (cause) {
        if (active) setError(`Could not load TriFlow. ${String(cause)}`);
      }
    }
    void start();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt, remote]);

  async function command(run: () => Promise<FlowSnapshot>) {
    if (pending.current || !can("clinical:triage")) return;
    pending.current = true;
    mutation.current += 1;
    setBusy(true);
    setError(null);
    try { setSnapshot(await run()); }
    catch (cause) { setError(String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }

  function handleTriage(id: string, esi: number) {
    return command(async () => remote ? remote.triage(id, esi) : (await getPatientFlow()).triage(id, esi, actor));
  }

  function clinicalAction(id: string, action: string, body: object) {
    if (!request || !remote) return;
    void command(async () => {
      await request("/encounters/" + id + "/" + action, "POST", body);
      return remote.load();
    });
  }
  return (
    <SimulationContext.Provider value={snapshot && {
      ...snapshot, busy, handleSelectPatient: setSelectedPatientId,
      handleTriage: can("clinical:triage") ? handleTriage : undefined,
    }}>
      {error && (
        <View className="gap-2 bg-red-50 p-4">
          <Text accessibilityRole="alert" className="text-red-900">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            setError(null);
            setAttempt((previous) => previous + 1);
          }}>
            <Text className="font-semibold text-red-900">Retry loading TriFlow</Text>
          </Pressable>
        </View>
      )}
      {snapshot ? children : !error && <Text className="p-4">Loading TriFlow…</Text>}
      <PatientModal
        patient={snapshot?.patients.find((patient) => patient.id === selectedPatientId)}
        onClose={() => setSelectedPatientId(null)}
        onTriage={can("clinical:triage") ? handleTriage : undefined}
        busy={busy}
        error={error}
        shared={!!remote}
        bays={snapshot?.bays}
        staff={snapshot?.staff}
        onAction={remote && can("clinical:triage") ? clinicalAction : undefined}
      />
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  const simulation = useContext(SimulationContext);
  if (!simulation) throw new Error("SimulationProvider is required");
  return simulation;
}
