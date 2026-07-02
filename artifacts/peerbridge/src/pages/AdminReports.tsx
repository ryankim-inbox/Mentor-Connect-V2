import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { getPythonApi, relativeTime } from "@/lib/pythonApi";
import { SourceBadge } from "@/components/SourceBadge";

interface FlaggedUser {
  userId: number;
  name: string;
  email: string;
  district: string;
  reportCount: number;
  blockCount: number;
  lastReportedAt: string | null;
  topReasons: string[];
  status: "active" | "warned" | "serious_warning" | "banned";
}

interface SignupSummary {
  today: number | null;
  thisMonth: number | null;
  thisYear: number | null;
  total: number | null;
}

const STATUS_STYLES: Record<FlaggedUser["status"], { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  warned: { label: "Warning issued", className: "bg-amber-50 text-amber-700 border-amber-200" },
  serious_warning: {
    label: "Serious warning",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  banned: { label: "Banned", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

function isFlaggedStatus(value: unknown): value is FlaggedUser["status"] {
  return value === "active" || value === "warned" || value === "serious_warning" || value === "banned";
}

export default function AdminReports() {
  const { user } = useAuth();

  const flaggedQuery = useQuery({
    queryKey: ["admin", "flagged-users"],
    queryFn: () => getPythonApi<FlaggedUser[]>("/api/admin/flagged-users"),
    enabled: !!user,
  });
  const summaryQuery = useQuery({
    queryKey: ["python-reports", "summary"],
    queryFn: () => getPythonApi<SignupSummary>("/api/python-reports/summary"),
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Sign in to access admin tools</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">
            Sign in
          </button>
        </Link>
      </div>
    );
  }

  const flagged = (Array.isArray(flaggedQuery.data?.data) ? flaggedQuery.data.data : []).filter(
    (u): u is FlaggedUser => typeof u?.userId === "number" && typeof u?.name === "string",
  );

  const totals = {
    flagged: flagged.length,
    banned: flagged.filter((u) => u.status === "banned").length,
    seriousWarnings: flagged.filter((u) => u.status === "serious_warning").length,
    warnings: flagged.filter((u) => u.status === "warned").length,
  };

  const summary = summaryQuery.data?.data;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Safety review</h1>
          <p className="text-muted-foreground mt-1">
            Users with reports or blocks. Review and take action to keep the community safe.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SourceBadge envelope={flaggedQuery.data} />
          <button
            type="button"
            onClick={() => {
              void flaggedQuery.refetch();
              void summaryQuery.refetch();
            }}
            disabled={flaggedQuery.isFetching || summaryQuery.isFetching}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {flaggedQuery.isFetching || summaryQuery.isFetching ? "Refreshing..." : "Load Report Summary"}
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-foreground">{totals.flagged}</p>
          <p className="text-sm text-muted-foreground mt-1">Flagged accounts</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-amber-600">{totals.warnings}</p>
          <p className="text-sm text-muted-foreground mt-1">Warnings</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-orange-600">{totals.seriousWarnings}</p>
          <p className="text-sm text-muted-foreground mt-1">Serious warnings</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-3xl font-bold text-rose-600">{totals.banned}</p>
          <p className="text-sm text-muted-foreground mt-1">Banned</p>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg">New sign-ups</h2>
            <p className="text-xs text-muted-foreground">
              From <span className="font-mono">/api/python-reports/summary</span> — wraps{" "}
              <span className="font-mono">Python/reports.py</span>
            </p>
          </div>
          <SourceBadge envelope={summaryQuery.data} />
        </div>
        {summaryQuery.isLoading ? (
          <div className="h-16 rounded-xl bg-muted animate-pulse" />
        ) : summaryQuery.error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {summaryQuery.error instanceof Error ? summaryQuery.error.message : String(summaryQuery.error)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            {(
              [
                ["Today", summary?.today],
                ["This month", summary?.thisMonth],
                ["This year", summary?.thisYear],
                ["Total users", summary?.total],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-muted/40 border border-border p-3">
                <p className="text-2xl font-bold text-foreground tabular-nums">
                  {typeof value === "number" ? value : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
        {summaryQuery.data?.student_module?.error && (
          <p className="mt-3 text-xs text-amber-700">
            reports.py status: {summaryQuery.data.student_module.status} —{" "}
            {summaryQuery.data.student_module.error}
          </p>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-lg">Flagged users</h2>
          <span className="text-xs text-muted-foreground">Sorted by report count</span>
        </div>

        {flaggedQuery.isLoading ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : flaggedQuery.error ? (
          <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>{flaggedQuery.error instanceof Error ? flaggedQuery.error.message : String(flaggedQuery.error)}</p>
            <button
              type="button"
              onClick={() => void flaggedQuery.refetch()}
              className="mt-2 text-xs font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : flagged.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No reported or blocked users right now.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {flagged.map((u) => {
              const status = STATUS_STYLES[isFlaggedStatus(u.status) ? u.status : "active"];
              return (
                <div key={u.userId} className="p-5 hover:bg-accent/30 transition-colors">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Link href={`/profile/${u.userId}`}>
                          <span className="font-semibold text-foreground hover:text-primary cursor-pointer">
                            {u.name}
                          </span>
                        </Link>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full border ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {u.email} · {u.district}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                        <span>
                          <span className="font-semibold text-rose-600">{u.reportCount}</span>
                          <span className="text-muted-foreground"> reports</span>
                        </span>
                        <span>
                          <span className="font-semibold text-foreground">{u.blockCount}</span>
                          <span className="text-muted-foreground"> blocks</span>
                        </span>
                        <span className="text-muted-foreground">
                          Last report: {relativeTime(u.lastReportedAt)}
                        </span>
                      </div>

                      {(u.topReasons ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(u.topReasons ?? []).map((r) => (
                            <span
                              key={r}
                              className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <Link href={`/profile/${u.userId}`}>
                        <button className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors">
                          View profile
                        </button>
                      </Link>
                      {u.status !== "banned" ? (
                        <button className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors">
                          Ban user
                        </button>
                      ) : (
                        <button className="px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors">
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 p-4 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Action thresholds: </span>
        1 report → warning · 3 reports → serious warning · 5 reports → automatic ban (and added to a
        banned-users table to prevent re-signup).
        {flaggedQuery.data?.student_module?.error && (
          <span className="block mt-1 text-amber-700">
            Python/get_blocks.py status: {flaggedQuery.data.student_module.status} —{" "}
            {flaggedQuery.data.student_module.error}
          </span>
        )}
      </div>
    </div>
  );
}
