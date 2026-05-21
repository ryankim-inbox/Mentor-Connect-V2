import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";

export default function Login() {
  const [, navigate] = useLocation();
  const { refetch } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    loginMutation.mutate(
      { data: { email, password } },
      {
        onSuccess: () => {
          refetch();
          navigate("/dashboard");
        },
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string } };
          setError(e?.data?.error ?? "Login failed. Please try again.");
        },
      }
    );
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="text-muted-foreground mt-1">Sign in to your PeerBridge account</p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">School email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loginMutation.isPending ? "Signing in..." : "Sign in"}
            </button>

            <button
              type="button"
              disabled={loginMutation.isPending}
              onClick={() => {
                setError("");
                loginMutation.mutate(
                  { data: { email: "demo@berkeley.edu", password: "password123" } },
                  {
                    onSuccess: () => {
                      refetch();
                      navigate("/dashboard");
                    },
                    onError: (err: unknown) => {
                      const e = err as { data?: { error?: string } };
                      setError(e?.data?.error ?? "Login failed. Please try again.");
                    },
                  }
                );
              }}
              className="w-full py-2.5 border border-primary text-primary rounded-lg font-semibold hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              테스트 계정으로 로그인
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't have an account?{" "}
            <Link href="/register">
              <span className="text-primary font-medium hover:underline">Sign up</span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
