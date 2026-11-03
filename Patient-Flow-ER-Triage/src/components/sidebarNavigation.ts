import { BedDouble, Inbox, LayoutDashboard, Users, BriefcaseMedical, UserRoundCog, Boxes } from "lucide-react-native";

/** Primary destinations and their labels in navigation order. */
export const sidebarNavigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/waiting-room", label: "Waiting Room", icon: Users },
  { href: "/treatment-bays", label: "Treatment Bay Availability", icon: BedDouble },
  { href: "/staff-and-resources", label: "Staff and Resources", icon: BriefcaseMedical },
] as const;

export const adminNavigation = [
  { href: "/admin/patients", label: "Patient Management", icon: Users },
  { href: "/admin/bays", label: "Treatment Bay Management", icon: BedDouble },
  { href: "/admin/staff", label: "Staff Management", icon: UserRoundCog },
  { href: "/admin/resources", label: "Resource Management", icon: Boxes },
] as const;
