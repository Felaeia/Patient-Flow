import { Text, View } from "react-native";

export default function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  warn = false,
  success = false,
}: any) {
  return (
    <View className="min-h-[88px] flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <View className="mb-1.5 flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-1.5 pr-1">
          {Icon && <Icon size={15} color="#0f766e" />}
          <Text numberOfLines={2} className="flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {title}
          </Text>
        </View>
        <View
          className={`h-2 w-2 rounded-full ${warn ? "bg-amber-500" : success ? "bg-emerald-500" : "bg-slate-300"}`}
        />
      </View>
      <View className="flex-row items-baseline gap-1.5">
        <Text className="text-[22px] font-bold tracking-tight text-slate-900">
          {value}
        </Text>
        <Text className="text-[11px] text-slate-500">{sub}</Text>
      </View>
    </View>
  );
}
