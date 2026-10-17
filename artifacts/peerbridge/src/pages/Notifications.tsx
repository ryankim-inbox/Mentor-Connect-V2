import { useEffect } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type NotificationItem = {
  id: number;
  kind: "request_match" | "request_match_summary";
  requestId: number | null;
  message: string;
  createdAt: string;
  read: boolean;
};

export type NotificationsResponse = {
  unreadCount: number;
  items: NotificationItem[];
};

export const notificationsQueryKey = ["notifications"] as const;

export async function fetchNotifications(): Promise<NotificationsResponse> {
  const response = await fetch("/api/notifications", { credentials: "include" });
  if (!response.ok) throw new Error(`Notifications failed: ${response.status}`);
  return response.json();
}

export default function Notifications() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: fetchNotifications,
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/notifications/read", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Mark read failed: ${response.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
  });

  const unread = data?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0 && !markRead.isPending) markRead.mutate();
    // Mark everything read once when the page shows unread items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Notifications</h1>
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {isError && <p className="text-red-600">Could not load notifications.</p>}
      {data && data.items.length === 0 && (
        <p className="text-muted-foreground">No notifications yet.</p>
      )}
      <ul className="flex flex-col gap-3">
        {data?.items.map((item) => (
          <li
            key={item.id}
            className={`rounded-xl border border-border p-4 ${item.read ? "bg-white" : "bg-blue-50"}`}
          >
            {item.requestId ? (
              <Link href={`/requests/${item.requestId}`} className="font-medium hover:underline">
                {item.message}
              </Link>
            ) : (
              <span className="font-medium">{item.message}</span>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(item.createdAt).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
