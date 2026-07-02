import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { getPythonApi, type PyEnvelope } from "@/lib/pythonApi";

interface WeeklyMatch {
  week: string;
  matches: number;
}

interface SubjectDemand {
  subject: string;
  requests: number;
  color: string;
}

interface TimeSlotDemand {
  slot: string;
  count: number;
}

interface MentorResponseRate {
  mentorId: number;
  mentorName: string;
  responseRate: number;
  totalRequests: number;
  avgResponseHours: number;
}

function pythonData<T>(envelope: PyEnvelope<T[]> | undefined): T[] {
  if (!envelope || !(envelope.success ?? envelope.ok)) {
    return [];
  }
  return Array.isArray(envelope.data) ? envelope.data : [];
}

function MiniBarChart({ data }: { data: WeeklyMatch[] }) {
  const max = Math.max(...data.map((d) => d.matches), 1);
  return (
    <div className="flex items-end gap-3 h-40">
      {data.map((d) => {
        const heightPct = (d.matches / max) * 100;
        return (
          <div key={d.week} className="flex-1 flex flex-col items-center gap-2">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full bg-gradient-to-t from-primary to-primary/60 rounded-t-md transition-all"
                style={{ height: `${heightPct}%` }}
                title={`${d.matches} matches`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{d.week}</span>
            <span className="text-xs font-semibold text-foreground -mt-1.5">{d.matches}</span>
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const widthPct = (value / max) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground tabular-nums">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${widthPct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function PythonErrorBox({ envelope }: { envelope: PyEnvelope<unknown> }) {
  const student = envelope.student_module;
  const moduleFile = student?.module ? `Python/${student.module}.py` : "the Python module";
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p className="font-semibold">Python analysis failed.</p>
      {student && (
        <p className="mt-1">
          {student.module}.py — {student.status ?? "error"}
          {envelope.error ? `: ${envelope.error}` : ""}
        </p>
      )}
      {!student && envelope.error && <p className="mt-1">{envelope.error}</p>}
      <p className="mt-2 text-xs">Fix {moduleFile} and run again.</p>
    </div>
  );
}

function PanelBody({
  query,
  isEmpty,
  emptyText,
  children,
}: {
  query: {
    isLoading: boolean;
    error: unknown;
    data: PyEnvelope<unknown> | undefined;
    refetch: () => Promise<unknown>;
  };
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  if (query.isLoading) {
    return <div className="h-40 rounded-xl bg-muted animate-pulse" />;
  }
  if (query.error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{query.error instanceof Error ? query.error.message : String(query.error)}</p>
        <button type="button" onClick={() => void query.refetch()} className="mt-2 text-xs font-semibold underline">
          Retry
        </button>
      </div>
    );
  }
  if (query.data && !(query.data.success ?? query.data.ok)) {
    return <PythonErrorBox envelope={query.data} />;
  }
  if (isEmpty) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return <>{children}</>;
}

export default function Analytics() {
  const { user } = useAuth();

  const statusQuery = useQuery({
    queryKey: ["analysis", "status"],
    queryFn: () => getPythonApi<null>("/api/analysis/status"),
    enabled: !!user,
  });
  const weeklyQuery = useQuery({
    queryKey: ["analytics", "weekly-matches"],
    queryFn: () => getPythonApi<WeeklyMatch[]>("/api/analytics/weekly-matches"),
    enabled: !!user,
  });
  const subjectsQuery = useQuery({
    queryKey: ["analytics", "popular-subjects"],
    queryFn: () => getPythonApi<SubjectDemand[]>("/api/analytics/popular-subjects"),
    enabled: !!user,
  });
  const slotsQuery = useQuery({
    queryKey: ["analytics", "popular-time-slots"],
    queryFn: () => getPythonApi<TimeSlotDemand[]>("/api/analytics/popular-time-slots"),
    enabled: !!user,
  });
  const mentorsQuery = useQuery({
    queryKey: ["analytics", "mentor-response-rates"],
    queryFn: () => getPythonApi<MentorResponseRate[]>("/api/analytics/mentor-response-rates"),
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Sign in to view analytics</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">
            Sign in
          </button>
        </Link>
      </div>
    );
  }

  const weekly = pythonData<WeeklyMatch>(weeklyQuery.data).filter(
    (d) => typeof d?.week === "string" && typeof d?.matches === "number",
  );
  const subjects = pythonData<SubjectDemand>(subjectsQuery.data).filter(
    (s) => typeof s?.subject === "string" && typeof s?.requests === "number",
  );
  const slots = pythonData<TimeSlotDemand>(slotsQuery.data).filter(
    (t) => typeof t?.slot === "string" && typeof t?.count === "number",
  );
  const mentors = pythonData<MentorResponseRate>(mentorsQuery.data).filter(
    (m) => typeof m?.mentorName === "string",
  );

  const maxSubject = Math.max(...subjects.map((s) => s.requests), 1);
  const maxSlot = Math.max(...slots.map((s) => s.count), 1);

  const analysisModule = statusQuery.data?.student_module;
  const isRefreshing =
    weeklyQuery.isFetching || subjectsQuery.isFetching || slotsQuery.isFetching || mentorsQuery.isFetching;
  const refreshAll = () => {
    void statusQuery.refetch();
    void weeklyQuery.refetch();
    void subjectsQuery.refetch();
    void slotsQuery.refetch();
    void mentorsQuery.refetch();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mentor Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Every number on this page comes from the student Python modules in{" "}
            <span className="font-mono">Python/</span> — when a module fails, its error is shown
            instead.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={isRefreshing}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing ? "Refreshing..." : "Run Analysis"}
        </button>
      </div>

      {analysisModule && (
        <div
          className={`mb-6 rounded-xl border p-4 text-sm ${
            analysisModule.importable
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <span className="font-semibold">Python/analysis.py: </span>
          {analysisModule.importable
            ? `importable (functions: ${(analysisModule.available_functions ?? []).join(", ") || "none"})`
            : `${analysisModule.status ?? "unavailable"} — ${analysisModule.error ?? "unknown error"}`}
          {!analysisModule.importable && (
            <span className="block mt-1 text-xs opacity-80">
              Python analysis failed. Fix Python/analysis.py and run again.
            </span>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold text-lg">Weekly matches</h2>
            <span className="text-xs text-muted-foreground font-mono">analysis.py</span>
          </div>
          <PanelBody
            query={weeklyQuery}
            isEmpty={weekly.length === 0}
            emptyText="Python returned no weekly match data."
          >
            <MiniBarChart data={weekly} />
          </PanelBody>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold text-lg">Most requested subjects</h2>
            <span className="text-xs text-muted-foreground font-mono">analysis.py</span>
          </div>
          <PanelBody
            query={subjectsQuery}
            isEmpty={subjects.length === 0}
            emptyText="Python returned no subject demand data."
          >
            <div className="space-y-3">
              {subjects.map((s) => (
                <HorizontalBar key={s.subject} label={s.subject} value={s.requests} max={maxSubject} color={s.color} />
              ))}
            </div>
          </PanelBody>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold text-lg">Popular time slots</h2>
            <span className="text-xs text-muted-foreground font-mono">scheduling.py</span>
          </div>
          <PanelBody
            query={slotsQuery}
            isEmpty={slots.length === 0}
            emptyText="Python returned no time slot data."
          >
            <div className="space-y-3">
              {slots.map((t) => (
                <HorizontalBar key={t.slot} label={t.slot} value={t.count} max={maxSlot} color="#8b5cf6" />
              ))}
            </div>
          </PanelBody>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold text-lg">Mentor response rates</h2>
            <span className="text-xs text-muted-foreground font-mono">analysis.py</span>
          </div>
          <PanelBody
            query={mentorsQuery}
            isEmpty={mentors.length === 0}
            emptyText="Python returned no mentor response data."
          >
            <div className="space-y-2">
              {mentors.map((m) => {
                const pct = typeof m.responseRate === "number" ? Math.round(m.responseRate * 100) : null;
                const color =
                  pct === null
                    ? "text-muted-foreground"
                    : pct >= 90
                      ? "text-emerald-600"
                      : pct >= 75
                        ? "text-blue-600"
                        : pct >= 60
                          ? "text-amber-600"
                          : "text-rose-600";
                return (
                  <Link key={m.mentorId} href={`/profile/${m.mentorId}`}>
                    <div className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-accent transition-colors cursor-pointer">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{m.mentorName}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.totalRequests ?? 0} requests ·{" "}
                          {typeof m.avgResponseHours === "number" ? `~${m.avgResponseHours.toFixed(1)}h avg reply` : "no reply data"}
                        </p>
                      </div>
                      <span className={`text-lg font-bold tabular-nums ${color}`}>
                        {pct === null ? "—" : `${pct}%`}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </PanelBody>
        </div>
      </div>

      <div className="mt-6">
        <Link href="/admin/reports">
          <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-2xl p-5 hover:bg-rose-100 transition-colors cursor-pointer">
            <div>
              <h3 className="font-semibold text-rose-900">Flagged accounts</h3>
              <p className="text-sm text-rose-700 mt-0.5">
                Review users with multiple reports — open the safety review page.
              </p>
            </div>
            <span className="text-rose-700 font-medium">Open →</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
