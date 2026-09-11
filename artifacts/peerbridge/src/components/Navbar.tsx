import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { releaseSurface } from "@/lib/release-flags";

const memberLinks = [
  ["Dashboard", releaseSurface.appRoutes.dashboard],
  ["Districts", releaseSurface.appRoutes.districts],
  ["Requests", releaseSurface.appRoutes.requests],
  ["New Request", "/requests/new"],
  ["Matches", releaseSurface.appRoutes.matching],
  ["Practice", releaseSurface.appRoutes.practice],
  ["Analytics", releaseSurface.appRoutes.analytics],
  ["Scheduling", releaseSurface.appRoutes.scheduling],
  ["Reports", releaseSurface.appRoutes.admin],
  ["Profile", "/profile"],
  ["Settings", "/settings"],
] as const;

function MemberLinks({ className }: { className: string }) {
  return (
    <div className={className}>
      {memberLinks.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

export function Navbar() {
  const { user, refetch } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // The local session is cleared even when the server is unavailable.
    }
    queryClient.setQueryData(getGetMeQueryKey(), null);
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    queryClient.clear();
    refetch();
    navigate("/");
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-white shadow-sm">
      <div className="mx-auto max-w-[96rem] px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-4 py-2">
          <div className="flex min-w-0 items-center gap-6">
            <Link href={user ? "/profile" : "/"} className="shrink-0 text-xl font-bold text-primary">
              PeerBridge
            </Link>
            {user && <MemberLinks className="hidden items-center gap-4 xl:flex" />}
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
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  Log out
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
