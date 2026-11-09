import { Text, View } from "react-native";

export default function PipelineStep({ icon: Icon, label, count, isLast = false }: any) {
  return (
    <View className="flex-row items-center">
      <View className="flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-900">
          <Icon size={15} color="white" />
        </View>
        <View>
          <Text numberOfLines={1} className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {label}
          </Text>
          <Text className="text-[18px] font-bold leading-tight text-slate-900">
            {count}
          </Text>
        </View>
      </View>
      {!isLast && <View className="flex-1 h-[1px] bg-slate-200 mx-4" />}
    </View>
  );
}
