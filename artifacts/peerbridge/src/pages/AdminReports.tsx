import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SourceBadge } from "@/components/SourceBadge";
import { getPythonApi, type PyEnvelope } from "@/lib/pythonApi";

type FlaggedUser = {
  userId: number;
  name: string;
  reportCount: number;
  blockCount: number;
  status: string;
  lastReportedAt: string | null;
  topReasons: string[];
};

type SignupSummary = {
  today: number;
  thisMonth: number;
  thisYear: number;
  total: number | null;
};

function QueryError({
  error,
  label,
  retry,
}: {
  error: unknown;
  label: string;
  retry: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <button type="button" onClick={retry} className="mt-2 text-xs font-semibold underline">
        Retry {label}
      </button>
    </div>
  );
}

export default function AdminReports() {
  const flagged = useQuery({
    queryKey: ["learning", "flagged-users"],
    queryFn: ({ signal }) => getPythonApi<FlaggedUser[]>("/api/admin/flagged-users", { signal }),
  });
  const signups = useQuery({
    queryKey: ["learning", "signup-summary"],
    queryFn: ({ signal }) => getPythonApi<SignupSummary>("/api/python-reports/summary", { signal }),
  });

  const flaggedUsers = Array.isArray(flagged.data?.data) ? flagged.data.data : [];
  const signupSummary = signups.data?.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Learning Reports</h1>
        <p className="mt-1 text-muted-foreground">
          Review the current Python report outputs and signup summary.
        </p>
      </div>

      <section className="mb-6 rounded-2xl border border-card-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Signup summary</h2>
          <SourceBadge envelope={signups.data as PyEnvelope<unknown> | undefined} />
        </div>
        {signups.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" role="status" />
        ) : signups.error ? (
          <QueryError
            error={signups.error}
            label="signup summary"
            retry={() => void signups.refetch()}
          />
        ) : signupSummary ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Today", signupSummary.today],
              ["This month", signupSummary.thisMonth],
              ["This year", signupSummary.thisYear],
              ["Total", signupSummary.total ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-2xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No signup summary is available yet.</p>
        )}
      </section>

      <section className="rounded-2xl border border-card-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Flagged users</h2>
          <SourceBadge envelope={flagged.data as PyEnvelope<unknown> | undefined} />
        </div>
        {flagged.isLoading ? (
          <div className="h-32 animate-pulse rounded-xl bg-muted" role="status" />
        ) : flagged.error ? (
          <QueryError
            error={flagged.error}
            label="flagged users"
            retry={() => void flagged.refetch()}
          />
        ) : flaggedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flagged users were returned.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Reports</th>
                  <th className="px-3 py-2 font-medium">Blocks</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {flaggedUsers.map((user) => (
                  <tr key={user.userId} className="border-b border-border last:border-0">
                    <td className="px-3 py-3 font-medium">
                      <Link href={`/profile/${user.userId}`} className="text-primary hover:underline">
                        {user.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{user.reportCount}</td>
                    <td className="px-3 py-3 tabular-nums">{user.blockCount}</td>
                    <td className="px-3 py-3">{user.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
