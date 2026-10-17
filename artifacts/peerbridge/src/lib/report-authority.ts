import type { QueryClient } from "@tanstack/react-query";
import { getListAdminReportsQueryKey } from "@workspace/api-client-react";

export const reportAuthorityKey = (userId: number | undefined) =>
  ["account-trust", "report-authority-denied", userId] as const;

export function discardReportState(client: QueryClient) {
  void client.cancelQueries({ queryKey: getListAdminReportsQueryKey() });
  client.removeQueries({ queryKey: getListAdminReportsQueryKey() });
  client.getMutationCache().clear();
}
