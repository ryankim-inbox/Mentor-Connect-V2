import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { verificationFragment } from "@/lib/verification-fragment";
import { apiErrorMessage } from "@/lib/api-error-message";

export default function VerifyEmail() {
  const { user, status, refetch } = useAuth();
  const token = useSyncExternalStore(
    verificationFragment.subscribe,
    verificationFragment.snapshot,
  );
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const busy = useRef(false);
  const identity = useRef(user?.id);
  useEffect(() => () => verificationFragment.clear(), []);
  useEffect(() => {
    if (
      status === "anonymous" ||
      (identity.current !== undefined && identity.current !== user?.id)
    )
      verificationFragment.clear();
    identity.current = user?.id;
  }, [status, user?.id]);
  useEffect(() => {
    if (token) {
      setError("");
      setMessage("");
    }
  }, [token]);
  const perform = async (confirm: boolean) => {
    if (busy.current || status !== "authenticated") return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      if (confirm) {
        // A plain call keeps the token out of React Query mutation variables/history.
        await confirmEmailVerification({ token });
        verificationFragment.clear();
        const current = await refetch();
        if (current?.isVerified) setMessage("Your email is verified.");
        else
          setError(
            "Confirmation completed, but ownership could not be refreshed. Recheck your session.",
          );
      } else {
        await requestEmailVerification();
        setMessage(
          "Verification email sent. Open the newest link within 30 minutes. Resends require at least 60 seconds.",
        );
      }
    } catch (e) {
      if (confirm) verificationFragment.clear();
      setError(apiErrorMessage(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <section className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      {status === "loading" && <p role="status">Checking session…</p>}
      {status === "anonymous" && (
        <>
          <p className="my-4">
            Sign in, then request a new verification email. For your privacy,
            this link is cleared before sign-in.
          </p>
          <Link
            href="/login?returnTo=%2Fverify-email"
            className="underline text-primary"
          >
            Sign in to verify
          </Link>
        </>
      )}
      {status === "error" && (
        <p role="alert">
          Could not check your session.{" "}
          <button onClick={() => void refetch().catch(() => {})}>
            Recheck session
          </button>
        </p>
      )}
      {status === "authenticated" && (
        <>
          <p className="my-4">
            Confirm ownership of {user?.email}. Email links expire after 30
            minutes and work once.
          </p>
          {user?.isVerified && !token ? (
            <p>Your email is verified.</p>
          ) : (
            <>
              {token && (
                <button
                  disabled={pending}
                  onClick={() => void perform(true)}
                  className="rounded-lg bg-primary text-primary-foreground px-4 py-2"
                >
                  Confirm email ownership
                </button>
              )}
              <button
                disabled={pending}
                onClick={() => void perform(false)}
                className="m-2 rounded-lg border px-4 py-2"
              >
                Send verification email
              </button>
            </>
          )}
          {user?.isVerified && (
            <Link href="/mentors" className="block my-4 underline text-primary">
              Find mentors
            </Link>
          )}
        </>
      )}
      {message &&
        !(message === "Your email is verified." && user?.isVerified) && (
          <p role="status" className="my-4">
            {message}
          </p>
        )}
      {error && (
        <p role="alert" className="my-4 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
