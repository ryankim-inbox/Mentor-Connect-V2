import { useRef, useState } from "react";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useAuth } from "@/lib/auth-context";
import { useCreateReport } from "@workspace/api-client-react";

interface Props {
  requestId?: number;
  requestTitle?: string;
  reportedUserId: number;
  reportedUserName: string;
  onClose: () => void;
}

const REASONS = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "fake_account", label: "Fake account" },
  { value: "other", label: "Other" },
] as const;

export default function ReportModal({
  requestId,
  requestTitle,
  reportedUserId,
  reportedUserName,
  onClose,
}: Props) {
  const { user, status } = useAuth();
  const busy = useRef(false);
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const createReport = useCreateReport();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || busy.current || Array.from(description).length > 2000)
      return;
    busy.current = true;

    createReport.mutate(
      {
        data: {
          reportedUserId,
          ...(requestId ? { requestId } : {}),
          reason: reason as
            | "spam"
            | "harassment"
            | "inappropriate"
            | "fake_account"
            | "other",
          description: description || null,
        },
      },
      {
        onSuccess: () => setSubmitted(true),
        onSettled: () => {
          busy.current = false;
        },
      },
    );
  };

  if (status !== "authenticated" || !user?.hasMemberAccess || user.isAdmin)
    return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={requestId ? "Report post" : `Report ${reportedUserName}`}
        className="bg-card border border-card-border rounded-2xl p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              Report submitted
            </h3>
            <p className="text-sm text-muted-foreground">
              Thank you for helping keep PeerBridge safe.
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <h3 className="font-semibold text-lg text-foreground mb-1">
              {requestId ? "Report post" : `Report ${reportedUserName}`}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {requestId
                ? `${requestTitle ?? "Mentorship request"} · Posted by ${reportedUserName}`
                : "Help us keep the community safe."}
            </p>
            {createReport.error && (
              <p role="alert">{apiErrorMessage(createReport.error)}</p>
            )}
            {Array.from(description).length > 2000 && (
              <p role="alert">Use at most 2,000 characters.</p>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Reason
                </label>
                <div className="space-y-2">
                  {REASONS.map(({ value, label }) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={value}
                        checked={reason === value}
                        onChange={() => setReason(value)}
                        className="accent-primary"
                      />
                      <span className="text-sm text-foreground">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label
                  htmlFor="report-description"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Additional details (optional)
                </label>
                <textarea
                  id="report-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what happened..."
                  rows={3}
                  className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition resize-none text-sm"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={
                    !reason ||
                    createReport.isPending ||
                    Array.from(description).length > 2000
                  }
                  className="flex-1 py-2.5 bg-destructive text-destructive-foreground rounded-lg text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50"
                >
                  {createReport.isPending ? "Submitting..." : "Submit report"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 border border-border rounded-lg text-sm hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
