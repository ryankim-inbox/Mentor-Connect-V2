import { Bell } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications";

export function NotificationBell() {
  const { user, status } = useAuth();
  const notifications = useNotifications();
  if (status !== "authenticated" || !user?.hasMemberAccess || user.isAdmin)
    return null;
  const unread = notifications.isSuccess ? notifications.data.unreadCount : 0;
  const description = notifications.isError
    ? "unread count unavailable"
    : notifications.isPending
      ? "checking unread notifications"
      : unread
        ? `${unread} unread`
        : "no unread notifications";
  return (
    <Link
      href="/notifications"
      aria-label={`Open notifications, ${description}`}
      title={`Notifications: ${description}`}
      className="fixed bottom-4 left-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-card text-primary shadow-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <Bell aria-hidden="true" className="h-5 w-5" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold text-white"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
