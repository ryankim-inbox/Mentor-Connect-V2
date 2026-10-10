import { useState } from "react";
import { Link } from "wouter";
import { useListRequests, useListTags, getListRequestsQueryKey } from "@workspace/api-client-react";
import { RequestCard } from "@/components/RequestCard";
import { TagBadge } from "@/components/TagBadge";
import { useAuth } from "@/lib/auth-context";

export default function Requests() {
  const { user } = useAuth();
  const [tagId, setTagId] = useState<number | undefined>();
  const [role, setRole] = useState<"mentor" | "mentee" | undefined>();

  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);

  const { data: tags } = useListTags();

  const params = {
    ...(tagId ? { tagId } : {}),
    ...(role ? { role } : {}),
    status: "open" as const,
    limit: 50,
    ...(before ? { before } : {}),
  };

  const { data: requests, isLoading, isError } = useListRequests(params, {
    query: { queryKey: getListRequestsQueryKey(params) }
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Browse Mentorship Requests</h1>
          <p className="text-muted-foreground mt-1">Find a mentor or connect with someone to mentor</p>
        </div>
        {user && (
          <Link href="/requests/new">
            <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors">
              Post a request
            </button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-card border border-card-border rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Role:</span>
          {(["all", "mentor", "mentee"] as const).map((r) => (
            <button
              key={r}
              onClick={() => { setRole(r === "all" ? undefined : r); setCursors([]); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border capitalize ${
                (r === "all" && !role) || role === r
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-input hover:bg-accent"
              }`}
            >
              {r === "mentor" ? "Offering mentorship" : r === "mentee" ? "Seeking mentor" : "All"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">Subject:</span>
          <button
            onClick={() => { setTagId(undefined); setCursors([]); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              !tagId ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-input hover:bg-accent"
            }`}
          >
            All
          </button>
          {tags?.slice(0, 10).map((tag) => (
            <button
              key={tag.id}
              onClick={() => { setTagId(tagId === tag.id ? undefined : tag.id); setCursors([]); }}
              className={`transition-all ${tagId === tag.id ? "scale-105" : "hover:scale-105"}`}
            >
              <TagBadge name={tag.name} color={tagId === tag.id ? tag.color : "#94a3b8"} />
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {isError && <p role="alert">Could not load requests. Please try again.</p>}

      {!isLoading && !isError && requests && (
        <>
          <p className="text-sm text-muted-foreground mb-4">{requests.length} request{requests.length !== 1 ? "s" : ""} shown</p>
          <div className="grid md:grid-cols-2 gap-4">
            {requests.map((req) => (
              <RequestCard key={req.id} {...req} />
            ))}
          </div>
          {requests.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-lg font-medium mb-2">{before ? "No older requests match your filters" : "No requests match your filters"}</p>
              <p className="text-sm mb-4">{before ? "Use Newer requests to return to the previous page." : "Try changing the filters or be the first to post"}</p>
              {user && !before && (
                <Link href="/requests/new">
                  <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
                    Post a request
                  </button>
                </Link>
              )}
            </div>
          )}
        </>
      )}
      <nav aria-label="Request pages" className="flex gap-3 mt-6">
        <button type="button" className="px-4 py-2 border rounded-lg disabled:opacity-50" disabled={isLoading || cursors.length === 0}
          onClick={() => setCursors((pages) => pages.slice(0, -1))}>Newer requests</button>
        <button type="button" className="px-4 py-2 border rounded-lg disabled:opacity-50" disabled={isLoading || isError || requests?.length !== 50}
          onClick={() => { const last = requests?.at(-1); if (last) setCursors((pages) => [...pages, `${last.createdAt}|${last.id}`]); }}>Older requests</button>
      </nav>
    </div>
  );
}
