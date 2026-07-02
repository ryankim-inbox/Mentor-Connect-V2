import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { getPythonApi, type PyEnvelope } from "@/lib/pythonApi";
import { SourceBadge } from "@/components/SourceBadge";

interface SchedulingOverview {
  topSlots: { slot: string; count: number }[];
  usersWithAvailability: number;
}

interface SuggestUser {
  id: number;
  name: string;
  role: string;
  available_times: string[];
}

interface SuggestResult {
  userA: SuggestUser;
  userB: SuggestUser;
  overlap: string[];
}

function TimeChips({ times, highlight }: { times: string[]; highlight?: string[] }) {
  if (times.length === 0) {
    return <span className="text-xs text-muted-foreground">no availability set</span>;
  }
  const highlighted = new Set(highlight ?? []);
  return (
    <div className="flex flex-wrap gap-1.5">
      {times.map((t) => (
        <span
          key={t}
          className={`text-xs px-2 py-0.5 rounded-full border ${
            highlighted.has(t)
              ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold"
              : "bg-muted text-muted-foreground border-border"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

export default function Scheduling() {
  const { user } = useAuth();
  const [userA, setUserA] = useState("1");
  const [userB, setUserB] = useState("136");
  const [suggestion, setSuggestion] = useState<PyEnvelope<SuggestResult> | null>(null);
  const [suggestError, setSuggestError] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["scheduling", "status"],
    queryFn: () => getPythonApi<null>("/api/scheduling/status"),
    enabled: !!user,
  });
  const overviewQuery = useQuery({
    queryKey: ["scheduling", "overview"],
    queryFn: () => getPythonApi<SchedulingOverview>("/api/scheduling/overview"),
    enabled: !!user,
  });

  const runSuggest = async () => {
    const a = Number(userA);
    const b = Number(userB);
    if (!Number.isInteger(a) || a <= 0 || !Number.isInteger(b) || b <= 0) {
      setSuggestError("Both user ids must be positive integers.");
      return;
    }
    setIsSuggesting(true);
    setSuggestError("");
    try {
      const result = await getPythonApi<SuggestResult>(
        `/api/scheduling/suggest?user_a=${a}&user_b=${b}`,
      );
      setSuggestion(result);
    } catch (error) {
      setSuggestion(null);
      setSuggestError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSuggesting(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Sign in to use scheduling</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">
            Sign in
          </button>
        </Link>
      </div>
    );
  }

  const module = statusQuery.data?.student_module;
  const overview = overviewQuery.data?.data;
  const topSlots = Array.isArray(overview?.topSlots) ? overview.topSlots : [];
  const maxSlot = Math.max(...topSlots.map((s) => s.count), 1);
  const suggestData = suggestion?.data;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Scheduling</h1>
        <p className="text-muted-foreground mt-1">
          Finds overlapping available times between two users. Wraps{" "}
          <span className="font-mono">Python/scheduling.py</span> without modifying it — when the
          student function fails, the adapter computes the overlap from the database instead.
        </p>
      </div>

      <section className="bg-card border border-card-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="font-semibold text-lg">Python/scheduling.py status</h2>
          {module && (
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                module.importable
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}
            >
              {module.importable ? "importable" : module.status ?? "unavailable"}
            </span>
          )}
        </div>
        {statusQuery.isLoading ? (
          <div className="h-10 rounded-xl bg-muted animate-pulse" />
        ) : statusQuery.error ? (
          <p className="text-sm text-red-700">
            {statusQuery.error instanceof Error ? statusQuery.error.message : String(statusQuery.error)}
          </p>
        ) : (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">Available functions:</span>{" "}
              {(module?.available_functions ?? []).join(", ") || "none detected"}
            </p>
            {module?.error && <p className="text-red-700">Error: {module.error}</p>}
          </div>
        )}
      </section>

      <section className="bg-card border border-card-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg">Availability overview</h2>
            <p className="text-xs text-muted-foreground">
              From <span className="font-mono">/api/scheduling/overview</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SourceBadge envelope={overviewQuery.data} />
            <button
              type="button"
              onClick={() => void overviewQuery.refetch()}
              disabled={overviewQuery.isFetching}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {overviewQuery.isFetching ? "Refreshing..." : "Run Scheduling"}
            </button>
          </div>
        </div>
        {overviewQuery.isLoading ? (
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        ) : overviewQuery.error ? (
          <p className="text-sm text-red-700">
            {overviewQuery.error instanceof Error ? overviewQuery.error.message : String(overviewQuery.error)}
          </p>
        ) : topSlots.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No availability data yet — no users have available times set.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              <span className="font-semibold text-foreground">{overview?.usersWithAvailability ?? 0}</span>{" "}
              users have availability set.
            </p>
            <div className="space-y-3">
              {topSlots.map((s) => (
                <div key={s.slot}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-foreground">{s.slot}</span>
                    <span className="text-muted-foreground tabular-nums">{s.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${(s.count / maxSlot) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="bg-card border border-card-border rounded-2xl p-5">
        <h2 className="font-semibold text-lg mb-1">Suggest meeting times</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Calls <span className="font-mono">/api/scheduling/suggest?user_a=&amp;user_b=</span> — tries{" "}
          <span className="font-mono">scheduling.time_dict(student, teacher)</span> first, then the
          adapter overlap.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-semibold text-foreground">
            User A id
            <input
              type="number"
              min="1"
              value={userA}
              onChange={(event) => setUserA(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <label className="text-sm font-semibold text-foreground">
            User B id
            <input
              type="number"
              min="1"
              value={userB}
              onChange={(event) => setUserB(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <button
            type="button"
            onClick={() => void runSuggest()}
            disabled={isSuggesting}
            className="self-end rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSuggesting ? "Suggesting..." : "Suggest times"}
          </button>
        </div>

        {suggestError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {suggestError}
          </div>
        )}

        {suggestData && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              <SourceBadge envelope={suggestion ?? undefined} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[suggestData.userA, suggestData.userB].map((u) => (
                <div key={u.id} className="rounded-xl border border-border p-4">
                  <p className="text-sm font-semibold text-foreground">
                    {u.name} <span className="text-xs font-normal text-muted-foreground">(#{u.id} · {u.role})</span>
                  </p>
                  <div className="mt-2">
                    <TimeChips times={u.available_times ?? []} highlight={suggestData.overlap} />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-900 mb-2">
                Overlapping times ({(suggestData.overlap ?? []).length})
              </p>
              {(suggestData.overlap ?? []).length === 0 ? (
                <p className="text-sm text-emerald-800">No overlapping availability found.</p>
              ) : (
                <TimeChips times={suggestData.overlap} highlight={suggestData.overlap} />
              )}
            </div>
            {suggestion?.student_module?.error && (
              <details className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <summary className="cursor-pointer font-semibold">
                  Student module output (scheduling.time_dict)
                </summary>
                <p className="mt-2">
                  {suggestion.student_module.status}: {suggestion.student_module.error}
                </p>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
