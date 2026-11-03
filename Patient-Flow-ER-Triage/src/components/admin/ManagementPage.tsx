import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Plus, Search, X } from "lucide-react-native";

export interface Field { key: string; label: string; required?: boolean; keyboard?: "default" | "numeric"; placeholder?: string; createOnly?: boolean }
export interface ManagementConfig<T extends { id: string | number }> {
  title: string; description: string; addLabel: string; fields: Field[];
  load: (search: string, filter: string, page: number) => Promise<{ rows: T[]; total: number; pageSize: number }>;
  save: (id: T["id"] | null, values: Record<string, string>) => Promise<void>;
  summary: (row: T) => { title: string; code: string; status: string; details: string[] };
  initial?: Partial<Record<string, string>>;
  filterPlaceholder?: string;
  onDetails?: (row: T) => void;
  stats?: () => Promise<string>;
}

/** Shared responsive search, pagination, card table, and add/edit modal for admin records. */
export function ManagementPage<T extends { id: string | number }>({ config }: { config: ManagementConfig<T> }) {
  const [rows, setRows] = useState<T[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const result = await config.load(search, filter, page);
      setRows(result.rows); setTotal(result.total); setPageSize(result.pageSize);
      if (config.stats) setStats(await config.stats());
    } catch (error) { setMessage(String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
    // The config functions are page-level adapters. Query state controls reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, page]);

  function show(row: T | null) {
    setEditing(row);
    const source = row as Record<string, unknown> | null;
    setValues(Object.fromEntries(config.fields.map((field) => [field.key,
      source?.[field.key] === null || source?.[field.key] === undefined ? config.initial?.[field.key] ?? "" : String(source[field.key])])));
    setOpen(true); setMessage(""); setConfirming(false);
  }
  async function submit() {
    const visibleFields = config.fields.filter((field) => !editing || !field.createOnly);
    const missing = visibleFields.find((field) => field.required && !values[field.key]?.trim());
    if (missing) { setMessage(`${missing.label} is required`); return; }
    const highImpact = editing && [values.status, values.operationalStatus, values.employmentStatus].some((value) => ["Inactive", "Unavailable", "Maintenance", "Out of Service"].includes(value));
    if (highImpact && !confirming) { setConfirming(true); setMessage("Review this high-impact status change, then select Confirm save."); return; }
    try {
      await config.save(editing?.id ?? null, values);
      setOpen(false); await refresh(); setMessage(`${config.title} saved successfully`);
    } catch (error) { setMessage(String(error)); }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <View className="min-w-0">
          <Text accessibilityRole="header" className="text-2xl font-bold text-slate-900">{config.title}</Text>
          <Text className="mt-1 text-sm text-slate-600">{config.description}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => show(null)} className="flex-row items-center gap-2 rounded-xl bg-teal-900 px-4 py-3">
          <Plus size={18} color="white" /><Text className="font-semibold text-white">{config.addLabel}</Text>
        </Pressable>
      </View>
      {!!stats && <Text className="text-sm font-semibold text-slate-700">{stats}</Text>}
      <View className="flex-row flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <View className="min-w-[220px] flex-1 flex-row items-center gap-2 rounded-xl border border-slate-300 px-3">
          <Search size={18} color="#64748b" />
          <TextInput accessibilityLabel={`Search ${config.title}`} value={search} onChangeText={(text) => { setSearch(text); setPage(1); }} placeholder="Search by code or name" className="min-h-11 flex-1" />
        </View>
        <TextInput accessibilityLabel={`Filter ${config.title}`} value={filter} onChangeText={(text) => { setFilter(text); setPage(1); }} placeholder={config.filterPlaceholder ?? "Filter status (optional)"} className="min-h-11 min-w-[190px] flex-1 rounded-xl border border-slate-300 px-3" />
      </View>
      {!!message && <Text accessibilityRole="alert" className={message.includes("successfully") ? "text-emerald-700" : "text-red-700"}>{message}</Text>}
      {loading ? <Text className="p-8 text-center text-slate-600">Loading records…</Text> : rows.length === 0 ? (
        <View className="rounded-2xl border border-dashed border-slate-300 bg-white p-10"><Text className="text-center text-slate-600">No matching records</Text></View>
      ) : <View className="gap-3">{rows.map((row) => {
        const item = config.summary(row);
        return <View key={String(row.id)} className="gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <View className="flex-row flex-wrap items-start justify-between gap-3">
            <View className="min-w-0 flex-1"><Text className="text-base font-bold text-slate-900">{item.title}</Text><Text className="text-xs font-medium text-slate-500">{item.code}</Text></View>
            <Text className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">{item.status}</Text>
          </View>
          <View className="flex-row flex-wrap gap-x-6 gap-y-1">{item.details.map((detail) => <Text key={detail} className="text-sm text-slate-600">{detail}</Text>)}</View>
          <View className="flex-row gap-2">
            {config.onDetails && <Pressable accessibilityRole="button" onPress={() => config.onDetails?.(row)} className="rounded-lg border border-slate-300 px-3 py-2"><Text className="font-semibold text-slate-700">Details</Text></Pressable>}
            <Pressable accessibilityRole="button" onPress={() => show(row)} className="rounded-lg border border-teal-700 px-3 py-2"><Text className="font-semibold text-teal-800">Edit</Text></Pressable>
          </View>
        </View>;
      })}</View>}
      <View className="flex-row items-center justify-between">
        <Pressable disabled={page <= 1} onPress={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40"><Text>Previous</Text></Pressable>
        <Text className="text-sm text-slate-600">Page {page} of {pages} · {total} records</Text>
        <Pressable disabled={page >= pages} onPress={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40"><Text>Next</Text></Pressable>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 items-center justify-center bg-slate-950/50 p-4">
          <View className="max-h-[90%] w-full max-w-[620px] rounded-2xl bg-white p-5">
            <View className="mb-4 flex-row items-center justify-between"><Text accessibilityRole="header" className="text-xl font-bold">{editing ? "Edit" : "Add"} {config.title}</Text><Pressable accessibilityLabel="Close form" onPress={() => setOpen(false)}><X size={22} /></Pressable></View>
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              {config.fields.filter((field) => !editing || !field.createOnly).map((field) => <View key={field.key} className="gap-1"><Text className="text-sm font-semibold text-slate-700">{field.label}{field.required ? " *" : ""}</Text><TextInput accessibilityLabel={field.label} keyboardType={field.keyboard} value={values[field.key] ?? ""} onChangeText={(text) => { setConfirming(false); setValues((current) => ({ ...current, [field.key]: text })); }} placeholder={field.placeholder} className="min-h-11 rounded-xl border border-slate-300 px-3" /></View>)}
              {!!message && open && <Text accessibilityRole="alert" className={confirming ? "text-amber-700" : "text-red-700"}>{message}</Text>}
              <Pressable accessibilityRole="button" onPress={submit} className="mt-2 items-center rounded-xl bg-teal-900 px-4 py-3"><Text className="font-bold text-white">{confirming ? "Confirm save" : "Save record"}</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
