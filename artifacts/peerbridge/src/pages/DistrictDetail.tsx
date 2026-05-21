import { Link } from "wouter";
import { useGetDistrict, useListRequests, useGetDistrictStats, getGetDistrictQueryKey, getListRequestsQueryKey, getGetDistrictStatsQueryKey } from "@workspace/api-client-react";
import { RequestCard } from "@/components/RequestCard";
import { TagBadge } from "@/components/TagBadge";
import { useAuth } from "@/lib/auth-context";

interface Props {
  id: string;
}

export default function DistrictDetail({ id }: Props) {
  const districtId = Number(id);
  const { user } = useAuth();

  const { data: district, isLoading: districtLoading } = useGetDistrict(districtId, {
    query: { queryKey: getGetDistrictQueryKey(districtId), enabled: !!districtId }
  });

  const { data: requests, isLoading: reqLoading } = useListRequests({ districtId, status: "open" }, {
    query: { queryKey: getListRequestsQueryKey({ districtId, status: "open" }), enabled: !!districtId }
  });

  const { data: stats } = useGetDistrictStats(districtId, {
    query: { queryKey: getGetDistrictStatsQueryKey(districtId), enabled: !!districtId }
  });

  if (districtLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="h-32 bg-card border border-card-border rounded-2xl animate-pulse mb-6" />
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-card border border-card-border rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!district) {
    return <div className="max-w-4xl mx-auto px-4 py-12 text-center text-muted-foreground">District not found.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/districts">
          <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">Districts</span>
        </Link>
        <span className="text-muted-foreground mx-2">/</span>
        <span className="text-sm text-foreground">{district.name}</span>
      </div>

      <div className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{district.name}</h1>
            <p className="text-muted-foreground mt-1">{district.county} County · {district.type.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())} District</p>
          </div>
          {user && (
            <Link href={`/requests/new?districtId=${districtId}`}>
              <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors">
                Post a request here
              </button>
            </Link>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            {[
              { label: "Members", value: stats.memberCount },
              { label: "Mentors", value: stats.mentorCount },
              { label: "Mentees", value: stats.menteeCount },
              { label: "Open requests", value: stats.openRequests },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-bold text-primary">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {stats?.topTags && stats.topTags.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Popular subjects in this district</h2>
          <div className="flex flex-wrap gap-2">
            {stats.topTags.map((tag) => (
              <TagBadge key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold text-lg mb-4">Open requests ({requests?.length ?? 0})</h2>
        {reqLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-28 bg-card border border-card-border rounded-xl animate-pulse" />)}
          </div>
        )}
        <div className="space-y-3">
          {requests?.map((req) => (
            <RequestCard key={req.id} {...req} />
          ))}
          {!reqLoading && (!requests || requests.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No open requests in this district yet.</p>
              {user && (
                <Link href={`/requests/new?districtId=${districtId}`}>
                  <button className="mt-3 text-sm text-primary hover:underline">Be the first to post one</button>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
