import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth, sessionReturnPath } from "@/lib/auth-context";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, status, refetch } = useAuth();
  const [location, navigate] = useLocation();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (status === "anonymous") {
      navigate(
        `/login?returnTo=${encodeURIComponent(sessionReturnPath(location))}`,
        { replace: true },
      );
    }
  }, [status, location, navigate]);

  const retry = async () => {
    setRetrying(true);
    try {
      await refetch();
    } catch {
      /* The context keeps the retryable error visible. */
    } finally {
      setRetrying(false);
    }
  };

  if (status === "loading")
    return (
      <p className="px-4 py-20 text-center text-muted-foreground">Loading…</p>
    );
  if (status === "anonymous")
    return <p className="px-4 py-20 text-center">Sign in to continue</p>;

  return (
    <>
      {status === "error" && (
        <div role="alert" className="mx-auto max-w-2xl px-4 py-6 text-center">
          <p>We couldn't verify your session. Please try again.</p>
          <button
            disabled={retrying}
            onClick={() => void retry()}
            className="mt-3 rounded-lg border px-4 py-2 disabled:opacity-50"
          >
            {retrying ? "Checking session..." : "Retry session"}
          </button>
        </div>
      )}
      {user && children}
    </>
  );
}
