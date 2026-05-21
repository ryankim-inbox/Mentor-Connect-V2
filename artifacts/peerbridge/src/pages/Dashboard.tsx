import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useGetStatsOverview, useListRequests, useListDistricts } from "@workspace/api-client-react";
import { RequestCard } from "@/components/RequestCard";
import { TagBadge } from "@/components/TagBadge";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats } = useGetStatsOverview();
  const { data: recentRequests } = useListRequests({ status: "open" }, {
    query: { queryKey: ["listRequests", "open", "dashboard"] }
  });
  const { data: districts } = useListDistricts(undefined, {
    query: { queryKey: ["listDistricts", "dashboard"] }
  });

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Sign in to access your dashboard</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">Sign in</button>
        </Link>
      </div>
    );
  }

  const topDistricts = districts?.slice(0, 6) ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Welcome back, {user.name.split(" ")[0]}</h1>
        <p className="text-muted-foreground mt-1">
          {user.districtName && `${user.districtName} ·`} {user.role === "mentor" ? "Offering mentorship" : user.role === "mentee" ? "Seeking mentorship" : "Mentor & Mentee"}
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Open requests", value: stats?.openRequests ?? 0, color: "text-blue-600" },
          { label: "Successful matches", value: stats?.successfulMatches ?? 0, color: "text-emerald-600" },
          { label: "Active districts", value: stats?.totalDistricts ?? 0, color: "text-violet-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-5">
            <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Recent open requests</h2>
            <Link href="/requests">
              <span className="text-sm text-primary hover:underline">View all</span>
            </Link>
          </div>
          <div className="space-y-3">
            {recentRequests?.slice(0, 5).map((req) => (
              <RequestCard key={req.id} {...req} />
            ))}
            {(!recentRequests || recentRequests.length === 0) && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No open requests yet.</p>
                <Link href="/requests/new">
                  <button className="mt-3 text-sm text-primary hover:underline">Be the first to post one</button>
                </Link>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-4">
            <h2 className="font-semibold text-lg mb-3">Active districts</h2>
            <div className="space-y-2">
              {topDistricts.map((d) => (
                <Link key={d.id} href={`/districts/${d.id}`}>
                  <div className="flex items-center justify-between p-3 bg-card border border-card-border rounded-lg hover:shadow-sm transition-shadow cursor-pointer">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.county} County</p>
                    </div>
                    <span className="shrink-0 ml-2 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      {d.openRequestCount} open
                    </span>
                  </div>
                </Link>
              ))}
              <Link href="/districts">
                <div className="text-center py-2 text-sm text-primary hover:underline cursor-pointer">
                  View all {stats?.totalDistricts} districts
                </div>
              </Link>
            </div>
          </div>

          {stats?.topTags && stats.topTags.length > 0 && (
            <div>
              <h2 className="font-semibold text-lg mb-3">Trending subjects</h2>
              <div className="flex flex-wrap gap-2">
                {stats.topTags.map((tag) => (
                  <Link key={tag.id} href={`/requests?tagId=${tag.id}`}>
                    <span className="cursor-pointer hover:scale-105 transition-transform inline-block">
                      <TagBadge name={tag.name} color={tag.color} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6">
            <Link href="/requests/new">
              <button className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors">
                Post a request
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
