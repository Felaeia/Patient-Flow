import { Redirect, Slot } from "expo-router";
import { useAuth } from "../../auth/AuthProvider";

export default function AdminLayout() {
  const { can } = useAuth();
  if (!can("admin:view")) return <Redirect href="/" />;
  return <Slot />;
}
