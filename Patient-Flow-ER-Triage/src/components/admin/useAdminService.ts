import { useMemo } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { getDatabase } from "../../database/open";
import { createAdminService } from "../../database/adminService";

export function useAdminService() {
  const { actor } = useAuth();
  return useMemo(() => getDatabase().then((database) => createAdminService(database, actor)), [actor]);
}
