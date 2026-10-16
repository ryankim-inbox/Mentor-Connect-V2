import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useConnections, useRequestActivity } from "@/lib/journey-queries";
import { MessageButton } from "@/lib/chat-navigation";
import { apiErrorMessage } from "@/lib/api-error-message";

export default function Connections() {
  const { user } = useAuth();
  return user ? <ConnectionsContent key={user.id} userId={user.id} /> : null;
}
function ConnectionsContent({ userId }: { userId: number }) {
  const connections = useConnections(userId);
  const activity = useRequestActivity(userId);
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">My connections</h1>
      <p className="text-muted-foreground mb-6">
        Message accepted connections and follow requests you posted or applied
        to.
      </p>
      <section className="rounded-2xl border bg-card p-5 mb-6">
        <h2 className="font-semibold mb-3">People</h2>
        {connections.isPending && <p role="status">Loading connections…</p>}
        {connections.error && (
          <p role="alert">
            {apiErrorMessage(connections.error)}{" "}
            <button onClick={() => void connections.refetch()}>Retry</button>
          </p>
        )}
        {connections.data?.pages.flat().length === 0 && (
          <p className="text-sm text-muted-foreground">
            An accepted application creates a connection. Browse requests to get
            started.
          </p>
        )}
        {connections.data?.pages.flat().map((c) => (
          <div
            key={c.userId}
            className="flex flex-wrap justify-between items-center gap-3 py-3 border-t"
          >
            <div>
              <p className="font-medium">{c.name}</p>
              <Link
                href={`/requests/${c.requestId}`}
                className="text-sm text-primary"
              >
                {c.requestTitle}
              </Link>
            </div>
            <MessageButton userId={c.userId} name={c.name} />
          </div>
        ))}
        {connections.hasNextPage && (
          <button
            disabled={connections.isFetchingNextPage}
            onClick={() => void connections.fetchNextPage()}
          >
            Load more connections
          </button>
        )}
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold mb-3">My requests and applications</h2>
        {activity.isPending && <p role="status">Loading activity…</p>}
        {activity.error && (
          <p role="alert">
            {apiErrorMessage(activity.error)}{" "}
            <button onClick={() => void activity.refetch()}>Retry</button>
          </p>
        )}
        {activity.data?.pages.flat().length === 0 && (
          <p className="text-sm text-muted-foreground">
            Your requests and applications will appear here.
          </p>
        )}
        {activity.data?.pages.flat().map((r) => (
          <Link
            key={r.id}
            href={`/requests/${r.id}`}
            className="block border-t py-3"
          >
            <p className="font-medium text-primary">{r.title}</p>
            <p className="text-sm text-muted-foreground">
              {r.authorId === userId ? "Your request" : `By ${r.authorName}`} ·{" "}
              {r.status}
            </p>
          </Link>
        ))}
        {activity.hasNextPage && (
          <button
            disabled={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            Load older activity
          </button>
        )}
      </section>
    </div>
  );
}
