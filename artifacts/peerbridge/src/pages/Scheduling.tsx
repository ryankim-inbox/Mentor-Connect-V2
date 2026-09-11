import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiErrorMessage } from "@/lib/api-error-message";
import { getPythonApi, type PyEnvelope } from "@/lib/pythonApi";
import { SourceBadge } from "@/components/SourceBadge";

interface SchedulingOverview {
  topSlots: { slot: string; count: number }[];
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

function envelopeSucceeded(envelope: PyEnvelope<unknown> | undefined): boolean {
  return !!envelope && (envelope.success ?? envelope.ok);
}

function PythonErrorBox({
  envelope,
  fallbackModule,
  onRetry,
}: {
  envelope: PyEnvelope<unknown>;
  fallbackModule: string;
  onRetry: () => void;
}) {
  const student = envelope.student_module;
  const moduleName = student?.module ?? fallbackModule;
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      role="alert"
    >
      <p className="font-semibold">Python scheduling failed.</p>
      <p className="mt-1">
        {moduleName}.py — {student?.status ?? "error"}
      </p>
      <p className="mt-2 text-xs">Fix Python/{moduleName}.py and run again.</p>
      <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold underline">
        Retry
      </button>
    </div>
  );
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
  const [userA, setUserA] = useState("");
  const [userB, setUserB] = useState("");
  const [suggestion, setSuggestion] = useState<PyEnvelope<SuggestResult> | null>(null);
  const [suggestError, setSuggestError] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["scheduling", "status"],
    queryFn: ({ signal }) => getPythonApi<null>("/api/scheduling/status", { signal }),
    enabled: !!user,
  });
  const overviewQuery = useQuery({
    queryKey: ["scheduling", "overview"],
    queryFn: ({ signal }) => getPythonApi<SchedulingOverview>("/api/scheduling/overview", { signal }),
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
      setSuggestError(apiErrorMessage(error));
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
  const statusOk = envelopeSucceeded(statusQuery.data);
  const overviewOk = envelopeSucceeded(overviewQuery.data);
  const topSlots = overviewOk && Array.isArray(overviewQuery.data?.data?.topSlots)
    ? overviewQuery.data.data.topSlots
    : [];
  const maxSlot = Math.max(...topSlots.map((s) => s.count), 1);
  const suggestOk = envelopeSucceeded(suggestion ?? undefined);
  const suggestData = suggestOk ? suggestion?.data : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Scheduling</h1>
        <p className="text-muted-foreground mt-1">
          Finds overlapping available times between two users by running{" "}
          <span className="font-mono">Python/scheduling.py</span>. Results come only from the
          student module — when it fails, its error is shown instead.
        </p>
      </div>

      <section className="bg-card border border-card-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="font-semibold text-lg">Python/scheduling.py status</h2>
          {module && (
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                statusOk
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}
            >
              {statusOk ? "importable" : module.status ?? "unavailable"}
            </span>
          )}
        </div>
        {statusQuery.isLoading ? (
          <div className="h-10 rounded-xl bg-muted animate-pulse" />
        ) : statusQuery.error ? (
          <div className="text-sm text-red-700" role="alert">
            <p>{apiErrorMessage(statusQuery.error)}</p>
            <button type="button" onClick={() => void statusQuery.refetch()} className="mt-2 text-xs font-semibold underline">
              Retry
            </button>
          </div>
        ) : statusQuery.data && !statusOk ? (
          <PythonErrorBox
            envelope={statusQuery.data}
            fallbackModule="scheduling"
            onRetry={() => void statusQuery.refetch()}
          />
        ) : (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">Available functions:</span>{" "}
              {(module?.available_functions ?? []).join(", ") || "none detected"}
            </p>
          </div>
        )}
      </section>

      <section className="bg-card border border-card-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg">Availability overview</h2>
            <p className="text-xs text-muted-foreground">
              From <span className="font-mono">scheduling.receive_time_data()</span> via{" "}
              <span className="font-mono">/api/scheduling/overview</span>
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
          <div className="text-sm text-red-700" role="alert">
            <p>{apiErrorMessage(overviewQuery.error)}</p>
            <button type="button" onClick={() => void overviewQuery.refetch()} className="mt-2 text-xs font-semibold underline">
              Retry
            </button>
          </div>
        ) : overviewQuery.data && !overviewOk ? (
          <PythonErrorBox
            envelope={overviewQuery.data}
            fallbackModule="scheduling"
            onRetry={() => void overviewQuery.refetch()}
          />
        ) : topSlots.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Python returned no availability data.
          </p>
        ) : (
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
        )}
      </section>

      <section className="bg-card border border-card-border rounded-2xl p-5">
        <h2 className="font-semibold text-lg mb-1">Suggest meeting times</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Calls <span className="font-mono">scheduling.time_dict(student, teacher)</span> via{" "}
          <span className="font-mono">/api/scheduling/suggest?user_a=&amp;user_b=</span> — the
          overlap shown is exactly what the student function returns.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-semibold text-foreground">
            User A id
            <input
              type="number"
              min="1"
              value={userA}
              placeholder="e.g. 1"
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
              placeholder="e.g. 2"
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
          <div
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            role="alert"
          >
            {suggestError}
            <button type="button" onClick={() => void runSuggest()} className="ml-2 font-semibold underline">
              Retry
            </button>
          </div>
        )}

        {suggestion && !suggestOk && (
          <div className="mt-5">
            <PythonErrorBox
              envelope={suggestion}
              fallbackModule="scheduling"
              onRetry={() => void runSuggest()}
            />
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
          </div>
        )}
      </section>
    </div>
  );
}
