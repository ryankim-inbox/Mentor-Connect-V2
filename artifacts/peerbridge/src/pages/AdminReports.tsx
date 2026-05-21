import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";

interface FlaggedUser {
  userId: number;
  name: string;
  email: string;
  district: string;
  reportCount: number;
  blockCount: number;
  lastReportedAt: string;
  topReasons: string[];
  status: "active" | "warned" | "serious_warning" | "banned";
}

// TODO: connect to Python backend — GET /api/admin/flagged-users
// Logic per Python/get_blocks.py docstring:
//   - 1+ reports: warning
//   - 3+ reports: serious warning
//   - 5+ reports: ban (and add to a banned-users table to prevent re-signup)
const MOCK_FLAGGED: FlaggedUser[] = [
  {
    userId: 42,
    name: "Marcus Doe",
    email: "marcus.d@students.fremontunified.org",
    district: "Fremont Unified",
    reportCount: 6,
    blockCount: 4,
    lastReportedAt: "2 days ago",
    topReasons: ["Inappropriate language", "No-show for sessions"],
    status: "banned",
  },
  {
    userId: 88,
    name: "Jamie Rivera",
    email: "j.rivera@students.cupertinounion.org",
    district: "Cupertino Union",
    reportCount: 4,
    blockCount: 2,
    lastReportedAt: "5 days ago",
    topReasons: ["Spam messaging", "Asking for off-platform contact"],
    status: "serious_warning",
  },
  {
    userId: 105,
    name: "Sam Patel",
    email: "spatel@students.paloaltounified.org",
    district: "Palo Alto Unified",
    reportCount: 3,
    blockCount: 1,
    lastReportedAt: "1 week ago",
    topReasons: ["Misleading subject expertise"],
    status: "serious_warning",
  },
  {
    userId: 132,
    name: "Taylor Kim",
    email: "tkim@students.berkeleyusd.org",
    district: "Berkeley Unified",
    reportCount: 2,
    blockCount: 1,
    lastReportedAt: "3 days ago",
    topReasons: ["Unprofessional behavior"],
    status: "warned",
  },
  {
    userId: 167,
    name: "Casey Tran",
    email: "casey.t@students.santaclaraunified.org",
    district: "Santa Clara Unified",
    reportCount: 1,
    blockCount: 0,
    lastReportedAt: "yesterday",
    topReasons: ["Late to scheduled meeting"],
    status: "warned",
  },
];

const STATUS_STYLES: Record<FlaggedUser["status"], { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  warned: { label: "Warning issued", className: "bg-amber-50 text-amber-700 border-amber-200" },
  serious_warning: {
    label: "Serious warning",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  banned: { label: "Banned", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

export default function AdminReports() {
  const { user } = useAuth();

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

  const totals = {
    flagged: MOCK_FLAGGED.length,
    banned: MOCK_FLAGGED.filter((u) => u.status === "banned").length,
    seriousWarnings: MOCK_FLAGGED.filter((u) => u.status === "serious_warning").length,
    warnings: MOCK_FLAGGED.filter((u) => u.status === "warned").length,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Safety review</h1>
          <p className="text-muted-foreground mt-1">
            Users with reports or blocks. Review and take action to keep the community safe.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700">
          Preview — sample data until reports endpoint is connected
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

      <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-lg">Flagged users</h2>
          <span className="text-xs text-muted-foreground">Sorted by report count</span>
        </div>

        <div className="divide-y divide-border">
          {MOCK_FLAGGED.map((u) => {
            const status = STATUS_STYLES[u.status];
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
                      <span className="text-muted-foreground">Last report: {u.lastReportedAt}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {u.topReasons.map((r) => (
                        <span
                          key={r}
                          className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
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
      </div>

      <div className="mt-6 p-4 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Action thresholds: </span>
        1 report → warning · 3 reports → serious warning · 5 reports → automatic ban (and added to a
        banned-users table to prevent re-signup).
      </div>
    </div>
  );
}
