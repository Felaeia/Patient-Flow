import { BedDouble, Inbox, LayoutDashboard, Users, BriefcaseMedical } from "lucide-react-native";

/** Primary destinations and their labels in navigation order. */
export const sidebarNavigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/waiting-room", label: "Waiting Room", icon: Users },
  { href: "/treatment-bays", label: "Treatment Bay Availability", icon: BedDouble },
  { href: "/staff-and-resources", label: "Staff and Resources", icon: BriefcaseMedical },
] as const;
