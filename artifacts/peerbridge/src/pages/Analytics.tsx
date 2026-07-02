import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useGetStatsOverview } from "@workspace/api-client-react";
import { getPythonApi } from "@/lib/pythonApi";
import { SourceBadge } from "@/components/SourceBadge";

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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function PanelBody({
  isLoading,
  error,
  isEmpty,
  emptyText,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText: string;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return <div className="h-40 rounded-xl bg-muted animate-pulse" />;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold underline">
          Retry
        </button>
      </div>
    );
  }
  if (isEmpty) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return <>{children}</>;
}

export default function Analytics() {
  const { user } = useAuth();
  const { data: stats } = useGetStatsOverview();

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

  const weekly = asArray<WeeklyMatch>(weeklyQuery.data?.data).filter(
    (d) => typeof d?.week === "string" && typeof d?.matches === "number",
  );
  const subjects = asArray<SubjectDemand>(subjectsQuery.data?.data).filter(
    (s) => typeof s?.subject === "string" && typeof s?.requests === "number",
  );
  const slots = asArray<TimeSlotDemand>(slotsQuery.data?.data).filter(
    (t) => typeof t?.slot === "string" && typeof t?.count === "number",
  );
  const mentors = asArray<MentorResponseRate>(mentorsQuery.data?.data).filter(
    (m) => typeof m?.mentorName === "string",
  );

  const maxSubject = Math.max(...subjects.map((s) => s.requests), 1);
  const maxSlot = Math.max(...slots.map((s) => s.count), 1);
  const totalThisWeek = weekly.length > 0 ? weekly[weekly.length - 1].matches : 0;
  const prevWeek = weekly.length > 1 ? weekly[weekly.length - 2].matches : 0;
  const weekChange = prevWeek > 0 ? ((totalThisWeek - prevWeek) / prevWeek) * 100 : 0;
  const avgResponseRate =
    mentors.length > 0
      ? (mentors.reduce((sum, m) => sum + (typeof m.responseRate === "number" ? m.responseRate : 0), 0) /
          mentors.length) *
        100
      : null;

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
            Activity trends across PeerBridge — matches, subjects, time slots, and mentor performance.
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
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <span className="font-semibold">Python/analysis.py: </span>
          {analysisModule.importable
            ? `importable (functions: ${(analysisModule.available_functions ?? []).join(", ") || "none"})`
            : `${analysisModule.status ?? "unavailable"} — ${analysisModule.error ?? "unknown error"}`}
          <span className="block mt-1 text-xs opacity-80">
            Charts below use live database numbers from the adapter until the student module returns
            usable results, then switch automatically.
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-blue-600">{totalThisWeek}</p>
          <p className="text-sm text-muted-foreground mt-1">Matches this week</p>
          <p className={`text-xs mt-1 font-medium ${weekChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {weekChange >= 0 ? "+" : ""}
            {weekChange.toFixed(0)}% vs last week
          </p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-emerald-600">{stats?.successfulMatches ?? 0}</p>
          <p className="text-sm text-muted-foreground mt-1">Total successful matches</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-violet-600">{stats?.openRequests ?? 0}</p>
          <p className="text-sm text-muted-foreground mt-1">Currently open requests</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-amber-600">
            {avgResponseRate === null ? "—" : `${avgResponseRate.toFixed(0)}%`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">Avg mentor response rate</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold text-lg">Weekly matches</h2>
            <SourceBadge envelope={weeklyQuery.data} />
          </div>
          <PanelBody
            isLoading={weeklyQuery.isLoading}
            error={weeklyQuery.error}
            isEmpty={weekly.length === 0}
            emptyText="No matches recorded yet."
            onRetry={() => void weeklyQuery.refetch()}
          >
            <MiniBarChart data={weekly} />
          </PanelBody>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold text-lg">Most requested subjects</h2>
            <SourceBadge envelope={subjectsQuery.data} />
          </div>
          <PanelBody
            isLoading={subjectsQuery.isLoading}
            error={subjectsQuery.error}
            isEmpty={subjects.length === 0}
            emptyText="No subject demand data yet."
            onRetry={() => void subjectsQuery.refetch()}
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
            <SourceBadge envelope={slotsQuery.data} />
          </div>
          <PanelBody
            isLoading={slotsQuery.isLoading}
            error={slotsQuery.error}
            isEmpty={slots.length === 0}
            emptyText="No availability data yet — mentors have not set available times."
            onRetry={() => void slotsQuery.refetch()}
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
            <SourceBadge envelope={mentorsQuery.data} />
          </div>
          <PanelBody
            isLoading={mentorsQuery.isLoading}
            error={mentorsQuery.error}
            isEmpty={mentors.length === 0}
            emptyText="No matched requests yet, so response rates cannot be computed."
            onRetry={() => void mentorsQuery.refetch()}
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
