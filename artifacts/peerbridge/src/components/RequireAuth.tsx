import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, sessionReturnPath } from "@/lib/auth-context";

export function RequireAuth({
  children,
  member = true,
  admin = false,
}: {
  children: ReactNode;
  member?: boolean;
  admin?: boolean;
}) {
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

  if (status === "authenticated" && member && !user?.hasMemberAccess)
    return <VerificationNotice />;
  if (status === "authenticated" && admin && (!user?.isVerified || !user?.isAdmin))
    return (
      <p role="alert" className="px-4 py-20 text-center">
        Administrator access required
      </p>
    );

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
      {user && (status !== "error" || (!member && !admin)) && (
        <Fragment key={user.id}>{children}</Fragment>
      )}
    </>
  );
}

export function VerificationNotice() {
  return (
    <section className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      <p className="my-4">
        Confirm email ownership to discover mentors, post requests and use chat.
      </p>
      <Link href="/verify-email" className="text-primary underline">
        Verify email
      </Link>
    </section>
  );
}
export function RequireAdmin({ children }: { children: ReactNode }) {
  return <RequireAuth admin>{children}</RequireAuth>;
}
