import { useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, sessionReturnPath } from "@/lib/auth-context";
import { apiErrorMessage } from "@/lib/api-error-message";

export default function Login() {
  const [, navigate] = useLocation();
  const { refetch } = useAuth();
  const queryClient = useQueryClient();
  const search = useSearch();
  const destination = sessionReturnPath(
    new URLSearchParams(search).get("returnTo"),
  );
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const confirmSession = async () => {
    try {
      const user = await refetch();
      if (user) navigate(destination);
      else
        setError(
          "Your session isn't active yet. Recheck your session or sign in again.",
        );
    } catch {
      setError(
        "Your account was accepted, but we couldn't verify the session. Please recheck it.",
      );
    }
  };
  const retrySession = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await confirmSession();
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    setError("");

    busy.current = true;
    setPending(true);
    setNeedsConfirmation(false);
    try {
      await queryClient.cancelQueries({ queryKey: getGetMeQueryKey() });
      const response = await loginMutation.mutateAsync({
        data: { email, password },
      });
      await queryClient.cancelQueries();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== getGetMeQueryKey()[0],
      });
      queryClient.setQueryData(getGetMeQueryKey(), response.user);
      setNeedsConfirmation(true);
      await confirmSession();
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="text-muted-foreground mt-1">
            Sign in to your PeerBridge account
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4" aria-busy={pending}>
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-foreground mb-1.5">
                School email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2" role="alert">
                {error}
              </p>
            )}

            {needsConfirmation && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void retrySession()}
                className="w-full rounded-lg border px-3 py-2 disabled:opacity-50"
              >
                Recheck session
              </button>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Explore requests, matching, and chat in this learning app.
          </p>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Need an account?{" "}
            <Link
              href="/register"
              className="font-medium text-primary hover:underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
