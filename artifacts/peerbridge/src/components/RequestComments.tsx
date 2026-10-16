import { useRef, useState, type FormEvent } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRequestComment,
  listRequestComments,
  type CreateCommentBody,
  type RequestComment,
} from "@workspace/api-client-react";
import { apiErrorMessage } from "@/lib/api-error-message";

export default function RequestComments({
  requestId,
  userId,
}: {
  requestId: number;
  userId: number;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<RequestComment | null>(null);
  const busy = useRef(false);
  const attempt = useRef<CreateCommentBody | null>(null);
  const queryKey = ["journey", userId, "comments", requestId];
  const comments = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      listRequestComments(
        requestId,
        { beforeId: pageParam, limit: 50 },
        { signal },
      ),
    getNextPageParam: (rows) => (rows.length === 50 ? rows[0]?.id : undefined),
    staleTime: 0,
    refetchInterval: 10_000,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: (body: CreateCommentBody) =>
      createRequestComment(requestId, body),
    onSuccess: (_, sent) => {
      setDraft((current) => (current.trim() === sent.body ? "" : current));
      setReply(null);
      attempt.current = null;
      void client.invalidateQueries({ queryKey });
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim(),
      parentId = reply?.id ?? null;
    if (!body || busy.current) return;
    busy.current = true;
    if (
      attempt.current?.body !== body ||
      attempt.current?.parentId !== parentId
    )
      attempt.current = {
        body,
        parentId,
        clientCommentId: crypto.randomUUID(),
      };
    mutation.mutate(attempt.current);
  };
  const rows = [
    ...new Map(
      (comments.data?.pages.flat() ?? []).map((c) => [c.id, c]),
    ).values(),
  ].sort((a, b) => a.id - b.id);
  return (
    <section
      aria-labelledby="comments-title"
      className="rounded-2xl border border-card-border bg-card p-5"
    >
      <h2 id="comments-title" className="font-semibold mb-3">
        Discussion
      </h2>
      {comments.isPending && <p role="status">Loading comments…</p>}
      {comments.error && (
        <p role="alert">
          {apiErrorMessage(comments.error)}{" "}
          <button onClick={() => void comments.refetch()}>Retry</button>
        </p>
      )}
      {comments.hasNextPage && (
        <button
          className="text-primary text-sm mb-3"
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          Load older comments
        </button>
      )}
      {!comments.isPending && !comments.error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground mb-4">
          No comments yet. Start the discussion.
        </p>
      )}
      <ol className="space-y-3 mb-5">
        {rows.map((c) => (
          <li
            key={c.id}
            className={`rounded-lg bg-muted p-3 ${c.parentId ? "ml-5 border-l-2 border-primary/30" : ""}`}
          >
            <p className="text-sm font-medium">
              {c.authorName}{" "}
              <time
                className="font-normal text-xs text-muted-foreground"
                dateTime={c.createdAt}
              >
                {new Date(c.createdAt).toLocaleString()}
              </time>
            </p>
            {c.parentId && (
              <p className="text-xs text-muted-foreground">
                Reply to {c.parentAuthorName ?? "comment"}
              </p>
            )}
            <p className="whitespace-pre-wrap break-words text-sm mt-1">
              {c.body}
            </p>
            {!c.parentId && (
              <button
                type="button"
                className="text-xs text-primary mt-2"
                onClick={() => setReply(c)}
              >
                Reply
              </button>
            )}
          </li>
        ))}
      </ol>
      <form onSubmit={submit}>
        {reply && (
          <p className="text-sm mb-2">
            Replying to {reply.authorName}{" "}
            <button
              type="button"
              className="text-primary"
              onClick={() => setReply(null)}
            >
              Cancel reply
            </button>
          </p>
        )}
        <label
          htmlFor="request-comment"
          className="block text-sm font-medium mb-2"
        >
          Comment
        </label>
        <textarea
          id="request-comment"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded-lg border p-3 text-sm"
        />
        <button
          type="submit"
          disabled={!draft.trim() || mutation.isPending}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {reply ? "Post reply" : "Post comment"}
        </button>
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive mt-2">
            {apiErrorMessage(mutation.error)} You can retry this unchanged
            comment safely.
          </p>
        )}
      </form>
    </section>
  );
}
