import { useQuery } from "@tanstack/react-query";
import { listNotifications } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";

export const notificationsQueryKey = (userId: number | undefined) =>
  ["notifications", userId] as const;

export function useNotifications() {
  const { user, status } = useAuth();
  return useQuery({
    queryKey: notificationsQueryKey(user?.id),
    queryFn: ({ signal }) => listNotifications({ signal }),
    enabled:
      status === "authenticated" &&
      user?.hasMemberAccess === true &&
      !user.isAdmin,
    refetchInterval: (query) => (query.state.error ? false : 30_000),
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}
