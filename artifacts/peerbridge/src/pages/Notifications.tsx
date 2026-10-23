import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  markNotificationsRead,
  type User,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { notificationsQueryKey, useNotifications } from "@/lib/notifications";

export default function Notifications() {
  const { user } = useAuth();
  return user ? <MemberNotifications key={user.id} userId={user.id} /> : null;
}

function MemberNotifications({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const pendingRead = useRef<AbortController | null>(null);
  const attempted = useRef<string | null>(null);
  useEffect(() => () => pendingRead.current?.abort(), []);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  const markRead = useMutation<void, Error, boolean>({
    mutationFn: (all = false) => {
      const current = queryClient.getQueryData<User | null>(getGetMeQueryKey());
      if (
        current?.id !== userId ||
        current.hasMemberAccess !== true ||
        current.isAdmin
      ) {
        throw new Error("Member session changed");
      }
      pendingRead.current = new AbortController();
      const ids = (notifications.data?.items ?? []).filter((item) => !item.read).map((item) => item.id);
      if (!all && !ids.length) throw new Error("No unread notification snapshot");
      return markNotificationsRead(all ? undefined : { ids }, { signal: pendingRead.current.signal });
    },
    onSuccess: () => {
      if (!pendingRead.current?.signal.aborted) {
        return queryClient.invalidateQueries({
          queryKey: notificationsQueryKey(userId),
        });
      }
      return undefined;
    },
  });
  // Attempt once per unread snapshot. A failed mutation waits for explicit retry.
  const data = notifications.isSuccess ? notifications.data : undefined;
  const unreadSnapshot = data?.items.filter((item) => !item.read).map((item) => item.id).join(",") || null;
  const { mutate, isPending, isError } = markRead;
  useEffect(() => {
    if (!unreadSnapshot) attempted.current = null;
    else if (
      visible &&
      !notifications.isFetching &&
      !isPending &&
      !isError &&
      attempted.current !== unreadSnapshot
    ) {
      attempted.current = unreadSnapshot;
      mutate(false);
    }
  }, [unreadSnapshot, visible, notifications.isFetching, isPending, isError, mutate]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Notifications</h1>
      {notifications.isPending && (
        <p role="status" className="text-muted-foreground">
          Loading…
        </p>
      )}
      {notifications.isError && (
        <p role="alert" className="text-red-600">
          Could not load notifications.{" "}
          <button onClick={() => void notifications.refetch()}>
            Retry notifications
          </button>
        </p>
      )}
      {markRead.isError && (
        <div role="alert" className="mb-4 text-red-600">
          <p>Could not mark notifications as read.</p>
          <button
            onClick={() => markRead.mutate(false)}
            disabled={markRead.isPending}
          >
            Retry marking read
          </button>
        </div>
      )}
      {data?.items.length === 0 && (
        <p className="text-muted-foreground">No notifications yet.</p>
      )}
      {!!data?.unreadCount && (
        <button className="mb-4 text-sm text-primary underline" onClick={() => markRead.mutate(true)} disabled={markRead.isPending}>
          Mark all notifications read
        </button>
      )}
      <ul className="flex flex-col gap-3">
        {data?.items.map((item) => (
          <li
            key={item.id}
            className={`rounded-xl border border-border p-4 ${item.read ? "bg-white" : "bg-blue-50"}`}
          >
            {item.requestId ? (
              <Link
                href={`/requests/${item.requestId}`}
                className="font-medium hover:underline"
              >
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
