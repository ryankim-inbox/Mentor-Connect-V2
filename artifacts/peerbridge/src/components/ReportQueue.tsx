import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListAdminReports,
  moderateReport,
  type ModerationReport,
  type ModerateReportBodyStatus,
} from "@workspace/api-client-react";
import { apiErrorMessage } from "@/lib/api-error-message";
const statuses: ModerateReportBodyStatus[] = [
  "open",
  "reviewing",
  "resolved",
  "dismissed",
];
function Review({ report }: { report: ModerationReport }) {
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
export default function ReportQueue() {
  const [status, setStatus] = useState<ModerateReportBodyStatus | "">("");
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const reports = useListAdminReports({
    status: status || undefined,
    limit: 50,
    beforeId: cursors.at(-1),
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
        <Review key={report.id} report={report} />
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
