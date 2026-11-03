import { useMemo } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { getDatabase } from "../../database/open";
import { createAdminService } from "../../database/adminService";
import { apiAdmin } from "../../api/admin";
import { localMode } from "../../api/client";

export function useAdminService() {
  const { actor, request } = useAuth();
  return useMemo(() => {
    if (request) return Promise.resolve(apiAdmin(request));
    if (!localMode) throw new Error("TriFlow session required");
    return getDatabase().then((database) => createAdminService(database, actor));
  }, [actor, request]);
}
