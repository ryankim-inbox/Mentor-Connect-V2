import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useGetStatsOverview } from "@workspace/api-client-react";

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

// TODO: connect to Python backend — GET /api/analytics/weekly-matches
const MOCK_WEEKLY: WeeklyMatch[] = [
  { week: "Mar 31", matches: 12 },
  { week: "Apr 7", matches: 18 },
  { week: "Apr 14", matches: 24 },
  { week: "Apr 21", matches: 21 },
  { week: "Apr 28", matches: 31 },
  { week: "May 5", matches: 38 },
];

// TODO: connect to Python backend — GET /api/analytics/popular-subjects
const MOCK_SUBJECTS: SubjectDemand[] = [
  { subject: "Math", requests: 47, color: "#3b82f6" },
  { subject: "Computer Science", requests: 36, color: "#06b6d4" },
  { subject: "Chemistry", requests: 28, color: "#dc2626" },
  { subject: "SAT/ACT", requests: 24, color: "#f97316" },
  { subject: "Biology", requests: 19, color: "#65a30d" },
  { subject: "English", requests: 15, color: "#f59e0b" },
];

// TODO: connect to Python backend — GET /api/analytics/popular-time-slots
const MOCK_TIME_SLOTS: TimeSlotDemand[] = [
  { slot: "Weekday evenings (6–9pm)", count: 64 },
  { slot: "Weekend mornings (9am–12pm)", count: 48 },
  { slot: "Weekend afternoons (1–5pm)", count: 41 },
  { slot: "Friday afternoons (3–6pm)", count: 22 },
  { slot: "Weekday afternoons (3–6pm)", count: 18 },
];

// TODO: connect to Python backend — GET /api/analytics/mentor-response-rates
const MOCK_MENTORS: MentorResponseRate[] = [
  { mentorId: 3, mentorName: "Sophia Lee", responseRate: 0.96, totalRequests: 25, avgResponseHours: 3.2 },
  { mentorId: 7, mentorName: "Daniel Park", responseRate: 0.88, totalRequests: 17, avgResponseHours: 6.5 },
  { mentorId: 12, mentorName: "Mia Chen", responseRate: 0.82, totalRequests: 22, avgResponseHours: 8.1 },
  { mentorId: 18, mentorName: "Jordan Patel", responseRate: 0.71, totalRequests: 14, avgResponseHours: 14.0 },
  { mentorId: 21, mentorName: "Riley Nguyen", responseRate: 0.55, totalRequests: 11, avgResponseHours: 22.4 },
];

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

export default function Analytics() {
  const { user } = useAuth();
  const { data: stats } = useGetStatsOverview();

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

  const maxSubject = Math.max(...MOCK_SUBJECTS.map((s) => s.requests), 1);
  const maxSlot = Math.max(...MOCK_TIME_SLOTS.map((s) => s.count), 1);
  const totalThisWeek = MOCK_WEEKLY[MOCK_WEEKLY.length - 1].matches;
  const prevWeek = MOCK_WEEKLY[MOCK_WEEKLY.length - 2].matches;
  const weekChange = prevWeek > 0 ? ((totalThisWeek - prevWeek) / prevWeek) * 100 : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mentor Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Activity trends across PeerBridge — matches, subjects, time slots, and mentor performance.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700">
          Preview — sample data until analytics endpoints are connected
        </div>
      </div>

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
            {(MOCK_MENTORS.reduce((sum, m) => sum + m.responseRate, 0) / MOCK_MENTORS.length * 100).toFixed(0)}%
          </p>
          <p className="text-sm text-muted-foreground mt-1">Avg mentor response rate</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h2 className="font-semibold text-lg mb-4">Weekly matches</h2>
          <MiniBarChart data={MOCK_WEEKLY} />
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h2 className="font-semibold text-lg mb-4">Most requested subjects</h2>
          <div className="space-y-3">
            {MOCK_SUBJECTS.map((s) => (
              <HorizontalBar key={s.subject} label={s.subject} value={s.requests} max={maxSubject} color={s.color} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h2 className="font-semibold text-lg mb-4">Popular time slots</h2>
          <div className="space-y-3">
            {MOCK_TIME_SLOTS.map((t) => (
              <HorizontalBar key={t.slot} label={t.slot} value={t.count} max={maxSlot} color="#8b5cf6" />
            ))}
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Mentor response rates</h2>
            <span className="text-xs text-muted-foreground">Last 30 days</span>
          </div>
          <div className="space-y-2">
            {MOCK_MENTORS.map((m) => {
              const pct = Math.round(m.responseRate * 100);
              const color = pct >= 90 ? "text-emerald-600" : pct >= 75 ? "text-blue-600" : pct >= 60 ? "text-amber-600" : "text-rose-600";
              return (
                <Link key={m.mentorId} href={`/profile/${m.mentorId}`}>
                  <div className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-accent transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{m.mentorName}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.totalRequests} requests · ~{m.avgResponseHours.toFixed(1)}h avg reply
                      </p>
                    </div>
                    <span className={`text-lg font-bold tabular-nums ${color}`}>{pct}%</span>
                  </div>
                </Link>
              );
            })}
          </div>
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
