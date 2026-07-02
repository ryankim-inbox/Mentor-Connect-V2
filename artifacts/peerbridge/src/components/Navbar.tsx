import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export function Navbar() {
  const { user, refetch } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // ignore — we clear local state regardless
    }
    queryClient.setQueryData(getGetMeQueryKey(), null);
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    queryClient.clear();
    refetch();
    navigate("/");
  };

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href={user ? "/dashboard" : "/"}>
              <span className="text-xl font-bold text-primary cursor-pointer">PeerBridge</span>
            </Link>
            {user && (
              <div className="hidden md:flex items-center gap-6">
                <Link href="/dashboard">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Dashboard</span>
                </Link>
                <Link href="/districts">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Districts</span>
                </Link>
                <Link href="/requests">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Browse Requests</span>
                </Link>
                <Link href="/requests/new">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Post a Request</span>
                </Link>
                <Link href="/recommendations">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Matches</span>
                </Link>
                <Link href="/dashboard/practice-lab">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Python Practice Lab</span>
                </Link>
                <Link href="/analytics">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Analytics</span>
                </Link>
                <Link href="/scheduling">
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Scheduling</span>
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link href={`/profile/${user.id}`}>
                  <span className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
                    {user.name}
                  </span>
                </Link>
                <Link href="/settings">
                  <button className="text-sm px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors">
                    Settings
                  </button>
                </Link>
                <button
                  onClick={handleLogout}
                  className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/login">
                  <button className="text-sm px-4 py-2 rounded-md border border-border hover:bg-accent transition-colors">
                    Log in
                  </button>
                </Link>
                <Link href="/register">
                  <button className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                    Sign up
                  </button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
