import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  blockUser,
  getGetUserQueryKey,
  listBlocks,
  unblockUser,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { apiErrorMessage } from "@/lib/api-error-message";
import ReportModal from "./ReportModal";

export function MemberSafety({
  userId,
  name,
  onBlocked,
}: {
  userId: number;
  name: string;
  onBlocked?: () => void;
}) {
  const { user, status } = useAuth();
  const client = useQueryClient();
  const [report, setReport] = useState(false);
  const block = useMutation({
    mutationFn: () => blockUser({ blockedUserId: userId }),
    retry: false,
    onSuccess: () => {
      onBlocked?.();
      client.removeQueries({ queryKey: getGetUserQueryKey(userId) });
      void client.invalidateQueries();
    },
  });
  if (
    status !== "authenticated" ||
    !user?.hasMemberAccess ||
    user.isAdmin ||
    user.id === userId
  )
    return null;
  return (
    <div className="mt-5 space-x-3">
      <button
        onClick={() => setReport(true)}
        className="rounded-lg border px-3 py-2"
      >
        Report member
      </button>
      <button
        disabled={block.isPending || block.isSuccess}
        onClick={() => block.mutate()}
        className="rounded-lg border px-3 py-2"
      >
        Block member
      </button>
      {block.isSuccess && <p role="status">Member blocked.</p>}
      {block.error && <p role="alert">{apiErrorMessage(block.error)}</p>}
      {report && (
        <ReportModal
          reportedUserId={userId}
          reportedUserName={name}
          onClose={() => setReport(false)}
        />
      )}
    </div>
  );
}
export function BlockedMembers() {
  const { user, status } = useAuth();
  const client = useQueryClient();
  const key = ["safety", user?.id, "blocks"];
  const blocks = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listBlocks({ signal }),
    enabled:
      status === "authenticated" &&
      user?.hasMemberAccess === true &&
      !user.isAdmin,
  });
  const unblock = useMutation({
    mutationFn: (id: number) => unblockUser(id),
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
  if (status !== "authenticated" || !user?.hasMemberAccess || user.isAdmin)
    return null;
  return (
    <section className="rounded-2xl border p-6">
      <h2 className="text-lg font-semibold">Blocked members</h2>
      {blocks.isPending && <p role="status">Loading blocked members…</p>}
      {blocks.error && (
        <p role="alert">
          {apiErrorMessage(blocks.error)}{" "}
          <button onClick={() => void blocks.refetch()}>
            Retry blocked members
          </button>
        </p>
      )}
      {blocks.data?.length === 0 && <p>No blocked members.</p>}
      <ul>
        {blocks.data?.map((b) => (
          <li
            key={b.id}
            className="my-3 flex items-center justify-between gap-4"
          >
            <span>{b.blockedUserName}</span>
            <button
              disabled={unblock.isPending}
              onClick={() => unblock.mutate(b.blockedUserId)}
              aria-label={`Unblock ${b.blockedUserName}`}
              className="rounded-lg border px-3 py-2"
            >
              Unblock
            </button>
          </li>
        ))}
      </ul>
      {unblock.error && <p role="alert">{apiErrorMessage(unblock.error)}</p>}
    </section>
  );
}
