import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  useListAdminReports,
  listAdminReports,
  getListAdminReportsQueryKey,
  moderateReport,
  type ModerationReport,
  type ModerateReportBodyStatus,
} from "@workspace/api-client-react";
import { discardReportState, reportAuthorityKey } from "@/lib/report-authority";
import { useAuth } from "@/lib/auth-context";
import { apiErrorMessage } from "@/lib/api-error-message";
const statuses: ModerateReportBodyStatus[] = [
  "open",
  "reviewing",
  "resolved",
  "dismissed",
];
function authorityDenied(error: unknown): error is ApiError {
  return error instanceof ApiError && [401, 403].includes(error.status);
}
function Review({
  report,
  onDenied,
}: {
  report: ModerationReport;
  onDenied: (error: unknown) => void;
}) {
  const client = useQueryClient();
  const [status, setStatus] = useState(report.status),
    [note, setNote] = useState(report.note ?? "");
  const [noteChanged, setNoteChanged] = useState(false);
  const noteValid = !noteChanged || Array.from(note).length <= 2000;
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      moderateReport(report.id, {
        status,
        ...(noteChanged ? { note: note || null } : {}),
      }),
    onError: (error) => {
      if (authorityDenied(error)) onDenied(error);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["/api/admin/reports"] });
    },
  });
  return (
    <article className="my-4 rounded-xl border p-5">
      <h3 className="font-semibold">
        Report #{report.id}: {report.reportedUserName}
      </h3>
      <p>
        Reported by {report.reporterName} · {report.reason}
      </p>
      <p className="my-3 whitespace-pre-wrap break-words">
        {report.description || "No description provided."}
      </p>
      <p className="text-sm">
        Status: {report.status}
        {report.reviewedAt &&
          ` · Reviewed ${new Date(report.reviewedAt).toLocaleString()} by administrator #${report.reviewedBy}`}
      </p>
      {report.note && (
        <p className="whitespace-pre-wrap break-words">
          Internal note: {report.note}
        </p>
      )}
      <form
        className="my-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (noteValid && !save.isPending) save.mutate();
        }}
      >
        <label className="block">
          Review status
          <select
            aria-label={`Review status for report ${report.id}`}
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as ModerateReportBodyStatus)
            }
            className="ml-3 rounded border p-2"
          >
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          Internal note
          <textarea
            aria-label={`Internal note for report ${report.id}`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteChanged(true);
            }}
            className="block w-full rounded border p-2"
          />
        </label>
        {!noteValid && (
          <p role="alert">
            New notes must be at most 2,000 characters. The saved note above
            remains readable.
          </p>
        )}
        <button
          disabled={save.isPending || !noteValid}
          className="rounded border px-3 py-2"
        >
          Save review
        </button>
        {save.error && <p role="alert">{apiErrorMessage(save.error)}</p>}
        {save.isSuccess && <p role="status">Review saved.</p>}
      </form>
    </article>
  );
}
function ReportQueueContents({
  onDenied,
}: {
  onDenied: (error: unknown) => void;
}) {
  const [status, setStatus] = useState<ModerateReportBodyStatus | "">("");
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const params = {
    status: status || undefined,
    limit: 50,
    beforeId: cursors.at(-1),
  };
  const reports = useListAdminReports(params, {
    query: {
      queryKey: getListAdminReportsQueryKey(params),
      queryFn: async ({ signal }) => {
        try {
          return await listAdminReports(params, { signal });
        } catch (error) {
          if (authorityDenied(error)) onDenied(error);
          throw error;
        }
      },
    },
  });
  return (
    <section className="mb-6 rounded-2xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Report queue</h2>
      <p className="my-3">
        Report details and review notes are visible only to administrators.
      </p>
      <label>
        Filter report status
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setCursors([undefined]);
          }}
          className="ml-3 border rounded p-2"
        >
          <option value="">All</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {reports.isPending && <p role="status">Loading reports…</p>}
      {reports.error && (
        <p role="alert">
          {apiErrorMessage(reports.error)}{" "}
          <button onClick={() => void reports.refetch()}>Retry reports</button>
        </p>
      )}
      {reports.data?.length === 0 && (
        <p className="my-4">No reports in this queue.</p>
      )}
      {reports.data?.map((report) => (
        <Review key={report.id} report={report} onDenied={onDenied} />
      ))}
      <div className="flex gap-4">
        <button
          disabled={cursors.length === 1 || reports.isFetching}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          Previous reports
        </button>
        <button
          disabled={reports.data?.length !== 50 || reports.isFetching}
          onClick={() => setCursors((c) => [...c, reports.data?.at(-1)?.id])}
        >
          More reports
        </button>
      </div>
    </section>
  );
}

// An endpoint denial is a new authority boundary even if /auth/me was cached.
export default function ReportQueue() {
  const client = useQueryClient();
  const { user, refetch } = useAuth();
  // Only a denial bit survives route changes; rows, mutation data and form drafts do not.
  // The identity provider clears this account-scoped metadata on logout/identity changes.
  const authorityKey = useMemo(() => reportAuthorityKey(user?.id), [user?.id]);
  const { data: denied } = useQuery({
    queryKey: authorityKey,
    queryFn: async () => false,
    enabled: false,
    initialData: false,
    gcTime: Infinity,
  });
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const discard = useCallback(() => discardReportState(client), [client]);
  const revoke = useCallback(
    (error: unknown) => {
      client.setQueryData(authorityKey, true);
      setMessage(apiErrorMessage(error));
      discard();
      void refetch().catch(() => {});
    },
    [authorityKey, client, discard, refetch],
  );
  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const current = await refetch();
      if (
        mounted.current &&
        current?.id === user?.id &&
        current?.isVerified &&
        current?.isAdmin
      ) {
        discard();
        // The remounted contents must obtain a fresh successful report read.
        client.setQueryData(authorityKey, false);
      }
    } catch {
      /* RequireAdmin also fails closed when identity cannot be refreshed. */
    } finally {
      if (mounted.current) setChecking(false);
    }
  };
  if (denied)
    return (
      <section className="mb-6 rounded-2xl border p-5">
        <p role="alert">
          {message} Private reports have been cleared. Recheck administrator
          access before reopening the queue.
        </p>
        <button
          className="mt-3 rounded border px-3 py-2"
          disabled={checking}
          onClick={() => void recheck()}
        >
          {checking ? "Checking report access…" : "Recheck report access"}
        </button>
      </section>
    );
  return <ReportQueueContents onDenied={revoke} />;
}
