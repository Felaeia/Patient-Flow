import { Link, usePathname } from "expo-router";
import { ChevronDown, ChevronRight, HeartPulse, PanelLeftClose, PanelLeftOpen, ShieldCheck, X } from "lucide-react-native";
import { ComponentProps, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { adminNavigation, sidebarNavigation } from "./sidebarNavigation";
import { useAuth } from "../auth/AuthProvider";

type Destination = (typeof sidebarNavigation)[number] | (typeof adminNavigation)[number];

// React Native Web Pressable dispatches clicks through onPress.
function NavigationPressable({ onClick, onPress, ...props }: ComponentProps<typeof Pressable> & {
  onClick?: ComponentProps<typeof Pressable>["onPress"];
}) {
  return <Pressable {...props} onPress={onClick ?? onPress} />;
}

function SidebarItem({ destination, active, collapsed, onNavigate }: {
  destination: Destination;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { href, label, icon: Icon } = destination;
  const showTooltip = collapsed && (hovered || focused);

  return (
    <View style={{ zIndex: showTooltip ? 1 : 0 }}>
      <Link href={href} asChild onPress={onNavigate}>
        <NavigationPressable
          accessibilityRole="link"
          accessibilityLabel={label}
          aria-current={active ? "page" : undefined}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`min-h-12 flex-row items-center gap-3 rounded-xl border px-3
            ${focused ? "border-teal-300" : "border-transparent"}
            ${active ? "bg-teal-950" : hovered ? "bg-slate-800" : "bg-slate-900"}`}
        >
          <Icon size={20} color={active ? "#5eead4" : "#cbd5e1"} />
          {!collapsed && (
            <Text className={`flex-1 text-sm font-semibold ${active ? "text-teal-200" : "text-slate-200"}`}>
              {label}
            </Text>
          )}
        </NavigationPressable>
      </Link>
      {showTooltip && (
        <View
          role="tooltip"
          className="absolute left-full top-1 ml-3 rounded-lg bg-slate-900 px-3 py-2"
          style={{ width: 204, pointerEvents: "none" }}
        >
          <Text className="text-sm text-white">{label}</Text>
        </View>
      )}
    </View>
  );
}

/** Renders the same route-aware navigation in the desktop rail and mobile drawer. */
export function Sidebar({ collapsed = false, onToggle, onClose }: {
  collapsed?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const { can } = useAuth();
  const authorized = can("admin:view");
  const [adminOpen, setAdminOpen] = useState(pathname.startsWith("/admin"));
  const ControlIcon = onClose ? X : collapsed ? PanelLeftOpen : PanelLeftClose;
  const controlLabel = onClose ? "Close navigation" : collapsed ? "Expand sidebar" : "Collapse sidebar";
  const links = (
    <View role="navigation" accessibilityLabel="Primary navigation" className="gap-1">
      {sidebarNavigation.map((destination) => (
        <SidebarItem
          key={destination.href}
          destination={destination}
          active={pathname === destination.href || pathname.startsWith(`${destination.href}/`)}
          collapsed={collapsed}
          onNavigate={onClose}
        />
      ))}
      {authorized && (
        <View className="mt-2 border-t border-slate-700 pt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Admin navigation"
            accessibilityState={{ expanded: adminOpen }}
            onPress={() => setAdminOpen((value) => !value)}
            className={`min-h-12 flex-row items-center gap-3 rounded-xl px-3 ${pathname.startsWith("/admin") ? "bg-slate-800" : ""}`}
          >
            <ShieldCheck size={20} color={pathname.startsWith("/admin") ? "#5eead4" : "#cbd5e1"} />
            {!collapsed && <><Text className="flex-1 text-sm font-bold text-slate-200">Admin</Text>{adminOpen ? <ChevronDown size={17} color="#cbd5e1" /> : <ChevronRight size={17} color="#cbd5e1" />}</>}
          </Pressable>
          {(adminOpen || collapsed) && <View className={collapsed ? "gap-1" : "ml-3 gap-1 border-l border-slate-700 pl-2"}>
            {adminNavigation.map((destination) => <SidebarItem key={destination.href} destination={destination} active={pathname === destination.href || pathname.startsWith(`${destination.href}/`)} collapsed={collapsed} onNavigate={onClose} />)}
          </View>}
        </View>
      )}
    </View>
  );

  return (
    <View className="bg-slate-900 px-2 py-3" style={{ width: collapsed ? 68 : 248 }}>
      <View className={`mb-4 items-center gap-2 ${collapsed ? "" : "flex-row px-2"}`}>
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-teal-900">
          <HeartPulse size={20} color="#99f6e4" />
        </View>
        {!collapsed && (
          <View className="flex-1">
            <Text className="text-lg font-bold text-white">TriFlow</Text>
            <Text className="text-xs text-slate-300">ED Command Center</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={controlLabel}
          accessibilityState={onClose ? undefined : { expanded: !collapsed }}
          onPress={onClose ?? onToggle}
          className="h-11 w-11 items-center justify-center rounded-lg border border-transparent hover:bg-slate-800 focus:border-teal-300"
        >
          <ControlIcon size={20} color="#cbd5e1" />
        </Pressable>
      </View>
      {collapsed ? links : <ScrollView>{links}</ScrollView>}
    </View>
  );
}
