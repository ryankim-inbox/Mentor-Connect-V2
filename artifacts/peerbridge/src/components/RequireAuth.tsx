import { useEffect, type ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth-context";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login");
    }
  }, [isLoading, user, navigate]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-3">Sign in to continue</h2>
        <p className="text-muted-foreground mb-5">This page is for PeerBridge members only.</p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/login">
            <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">
              Log in
            </button>
          </Link>
          <Link href="/register">
            <button className="px-6 py-2.5 border border-border rounded-lg font-semibold hover:bg-accent transition-colors">
              Sign up
            </button>
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
