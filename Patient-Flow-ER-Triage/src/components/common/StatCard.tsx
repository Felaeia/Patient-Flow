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
    // Removed min-w and fixed flex behavior so it shares the row evenly
    <View className="flex-1 rounded-[16px] bg-white border border-slate-200 p-4 shadow-sm">
      <View className="flex flex-row items-center justify-between mb-2">
        <View className="flex flex-1 flex-row items-center gap-1.5 pr-2">
          {Icon && <Icon size={14} color="#64748b" />}
          <Text className="flex-1 text-[11px] font-bold tracking-widest text-slate-500 uppercase">
            {title}
          </Text>
        </View>
        <View
          className={`h-2 w-2 rounded-full ${warn ? "bg-amber-500" : success ? "bg-emerald-500" : "bg-slate-300"}`}
        />
      </View>
      <View className="flex flex-row items-baseline gap-2">
        <Text className="text-[24px] font-bold tracking-tight text-slate-900">
          {value}
        </Text>
        <Text className="text-[11px] text-slate-500">{sub}</Text>
      </View>
    </View>
  );
}