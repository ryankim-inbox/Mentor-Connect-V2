import { Link } from "wouter";
import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications";
import { releaseSurface } from "@/lib/release-flags";

const memberLinks = [
  ["Dashboard", releaseSurface.appRoutes.dashboard],
  ["Districts", releaseSurface.appRoutes.districts],
  ["Requests", releaseSurface.appRoutes.requests],
  ["My connections", "/connections"],
  ["Notifications", "/notifications"],
  ["New Request", "/requests/new"],
  ["Mentors", "/mentors"],
  ["Matches", releaseSurface.appRoutes.matching],
  ["Practice", releaseSurface.appRoutes.practice],
  ["Analytics", releaseSurface.appRoutes.analytics],
  ["Scheduling", releaseSurface.appRoutes.scheduling],
  ["Reports", releaseSurface.appRoutes.admin],
  ["Profile", "/profile"],
  ["Settings", "/settings"],
] as const;

function MemberLinks({ className }: { className: string }) {
  const { user, status } = useAuth();
  const notifications = useNotifications();
  const unread = notifications.isSuccess ? notifications.data.unreadCount : 0;
  const links = memberLinks.filter(([label]) => {
    if (["Profile", "Settings"].includes(label)) return true;
    if (status !== "authenticated" || !user?.hasMemberAccess) return false;
    if (
      user.isAdmin &&
      ["My connections", "Notifications", "New Request"].includes(label)
    )
      return false;
    return (
      !["Matches", "Practice", "Analytics", "Scheduling", "Reports"].includes(
        label,
      ) ||
      (user.isVerified && user.isAdmin)
    );
  });
  return (
    <div className={className}>
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {label}
          {label === "Notifications" && unread > 0 && (
            <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">
              {unread}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleLogout = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await logout();
    } catch {
      setError("Couldn't log out. Please try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-white shadow-sm">
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {user && !user.isVerified && (
        <p className="px-4 py-2 text-sm">
          {user.hasMemberAccess
            ? "Test member access · Email ownership unverified"
            : "Email ownership pending."}{" "}
          <Link href="/verify-email" className="underline">
            Verify email
          </Link>
        </p>
      )}
      <div className="mx-auto max-w-[96rem] px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-4 py-2">
          <div className="flex min-w-0 items-center gap-6">
            <Link
              href={user ? "/profile" : "/"}
              className="shrink-0 text-xl font-bold text-primary"
            >
              PeerBridge
            </Link>
            {user && (
              <MemberLinks className="hidden items-center gap-4 xl:flex" />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {user ? (
              <>
                <details className="relative xl:hidden">
                  <summary className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-medium">
                    Menu
                  </summary>
                  <MemberLinks className="absolute right-0 mt-2 flex w-48 flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-lg" />
                </details>
                <button
                  onClick={handleLogout}
                  disabled={pending}
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  {pending ? "Logging out..." : "Log out"}
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
                >
                  Log in
                </Link>
                <Link
                  href={releaseSurface.appRoutes.register}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
