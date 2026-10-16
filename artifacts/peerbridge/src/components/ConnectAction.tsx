import { useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  applyToRequest,
  actOnRequestApplication,
  listRequestApplications,
  getGetRequestQueryKey,
  type ApplicationAction,
} from "@workspace/api-client-react";
import { apiErrorMessage } from "@/lib/api-error-message";

export default function ConnectAction({
  requestId,
  userId,
  isAuthor,
  status,
}: {
  requestId: number;
  userId: number;
  isAuthor: boolean;
  status: string;
}) {
  const client = useQueryClient();
  const busy = useRef(false);
  const applications = useInfiniteQuery({
    queryKey: ["journey", userId, "applications", requestId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      listRequestApplications(
        requestId,
        { limit: 50, beforeId: pageParam },
        { signal },
      ),
    getNextPageParam: (rows) =>
      rows.length === 50 ? rows.at(-1)?.id : undefined,
    staleTime: 0,
    refetchInterval: 10_000,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: (operation: {
      id?: number;
      action?: ApplicationAction["action"];
    }) =>
      operation.id && operation.action
        ? actOnRequestApplication(requestId, operation.id, {
            action: operation.action,
          })
        : applyToRequest(requestId),
    onSettled: () => {
      busy.current = false;
      void client.invalidateQueries({ queryKey: ["journey", userId] });
      void client.invalidateQueries({
        queryKey: getGetRequestQueryKey(requestId),
      });
      void client.invalidateQueries({ queryKey: ["/api/requests"] });
    },
  });
  const act = (id?: number, action?: ApplicationAction["action"]) => {
    if (busy.current) return;
    busy.current = true;
    mutation.mutate({ id, action });
  };
  const rows = applications.data?.pages.flat() ?? [];
  const own = rows.find((a) => a.applicantId === userId);
  const label = (value: string) =>
    ({
      pending: "Application pending",
      accepted: "Application accepted",
      rejected: "Application declined",
      cancelled: "Application cancelled",
    })[value];
  const buttonClass =
    "rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50";
  return (
    <section
      aria-label="Connection applications"
      className="rounded-2xl border border-card-border bg-card p-5 mb-4"
    >
      <h2 className="font-semibold mb-3">
        {isAuthor ? "Connection applications" : "Connect with the author"}
      </h2>
      {applications.isPending && <p role="status">Loading applications…</p>}
      {applications.error && (
        <p role="alert">
          {apiErrorMessage(applications.error)}{" "}
          <button onClick={() => void applications.refetch()}>Retry</button>
        </p>
      )}
      {isAuthor ? (
        <>
          {!applications.isPending &&
            !applications.error &&
            rows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No applications yet.
              </p>
            )}
          {rows.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t py-3"
            >
              <div>
                <p className="font-medium">{a.applicantName}</p>
                <p className="text-sm text-muted-foreground">
                  {label(a.status)}
                </p>
              </div>
              {a.status === "pending" && status === "open" && (
                <div className="flex gap-2">
                  <button
                    className={buttonClass}
                    disabled={mutation.isPending}
                    aria-label={`Accept ${a.applicantName}`}
                    onClick={() => act(a.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className={buttonClass}
                    disabled={mutation.isPending}
                    aria-label={`Decline ${a.applicantName}`}
                    onClick={() => act(a.id, "reject")}
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      ) : (
        <>
          {own && (
            <p className="mb-3 text-sm" role="status">
              {label(own.status)}
            </p>
          )}
          {status === "open" &&
            !applications.isPending &&
            !applications.error &&
            (!own || own.status === "cancelled") && (
              <button
                className={buttonClass}
                disabled={mutation.isPending}
                onClick={() => act()}
              >
                {own ? "Apply again" : "Apply to connect"}
              </button>
            )}
          {own?.status === "pending" && (
            <button
              className={buttonClass}
              disabled={mutation.isPending}
              onClick={() => act(own.id, "cancel")}
            >
              Cancel application
            </button>
          )}
          {!own && status !== "open" && (
            <p className="text-sm text-muted-foreground">
              This request is no longer open.
            </p>
          )}
        </>
      )}
      {applications.hasNextPage && (
        <button
          className={buttonClass}
          disabled={applications.isFetchingNextPage}
          onClick={() => void applications.fetchNextPage()}
        >
          Load older applications
        </button>
      )}
      {mutation.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {apiErrorMessage(mutation.error)} Refresh or retry the action.
        </p>
      )}
    </section>
  );
}
