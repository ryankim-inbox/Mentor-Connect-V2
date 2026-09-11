import { lazy, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetRequest,
  useDeleteRequest,
  getGetRequestQueryKey,
  getListRequestsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagBadge } from "@/components/TagBadge";
import { useAuth } from "@/lib/auth-context";
import { sortTimeSlots } from "@/lib/timeSlots";
import { apiErrorMessage } from "@/lib/api-error-message";
import ReportModal from "@/components/ReportModal";

interface Props {
  id: string;
}

const ConnectAction = lazy(() => import("@/components/ConnectAction"));

export default function RequestDetail({ id }: Props) {
  const requestId = Number(id);
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showReport, setShowReport] = useState(false);

  const { data: request, error: requestError, isLoading, refetch } = useGetRequest(requestId, {
    query: { queryKey: getGetRequestQueryKey(requestId), enabled: !!requestId }
  });

  const isAuthor = user?.id === request?.authorId;
  const isMatched = user?.id === request?.matchedUserId;
  const showMatchedPanel = request?.status === "matched" && (isAuthor || isMatched);

  const deleteMutation = useDeleteRequest();

  const handleMatched = () => {
    void queryClient.invalidateQueries({ queryKey: getGetRequestQueryKey(requestId) });
  };

  const handleMatchFailed = () => {
    void queryClient.invalidateQueries({ queryKey: getGetRequestQueryKey(requestId) });
  };

  const handleDelete = () => {
    if (!confirm("Delete this request?")) return;
    deleteMutation.mutate({ id: requestId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey() });
        navigate("/requests");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="h-64 bg-card border border-card-border rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (requestError && !request) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center" role="alert">
        <p className="text-destructive">{apiErrorMessage(requestError)}</p>
        <button type="button" onClick={() => void refetch()} className="mt-4 text-primary underline">
          Retry
        </button>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Request not found.</p>
        <Link href="/requests"><button className="mt-4 text-primary hover:underline text-sm">Back to requests</button></Link>
      </div>
    );
  }

  const canMatch =
    user !== null &&
    user !== undefined &&
    !isAuthor &&
    request.status === "open";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/requests"><span className="hover:text-foreground transition-colors">Requests</span></Link>
        <span>/</span>
        <span className="text-foreground truncate">{request.title}</span>
      </div>

      {showMatchedPanel && (
        <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-green-800 text-base">
                This request has been matched
              </h3>
              <p className="text-green-700 text-sm mt-1">
                Minimum member profiles include names, subjects, and join dates.
              </p>
              <div className="mt-4 sm:w-52 bg-white border border-green-100 rounded-xl p-4">
                <p className="text-xs text-green-600 font-medium uppercase tracking-wide mb-2">Tips</p>
                <ul className="text-xs text-muted-foreground space-y-1.5">
                  <li>Use the approved contact flow when it becomes available.</li>
                  <li>Set clear expectations before scheduling a meeting.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-card-border rounded-2xl p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                request.authorRole === "mentor"
                  ? "text-blue-600 bg-blue-50 border-blue-100"
                  : "text-emerald-600 bg-emerald-50 border-emerald-100"
              }`}>
                {request.authorRole === "mentor" ? "Offering mentorship" : "Seeking a mentor"}
              </span>
              {request.status !== "open" && (
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                  request.status === "matched" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                }`}>
                  {request.status}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-foreground">{request.title}</h1>
          </div>
        </div>

        <p className="text-foreground leading-relaxed mb-5 whitespace-pre-wrap">{request.description}</p>

        <div className="flex flex-wrap gap-2 mb-5">
          {request.tags.map((tag) => (
            <TagBadge key={tag.id} name={tag.name} color={tag.color} />
          ))}
        </div>

        {request.preferredTimes && request.preferredTimes.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Preferred times</p>
            <div className="flex flex-wrap gap-1.5">
              {sortTimeSlots(request.preferredTimes).map((slot) => (
                <span
                  key={slot}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 tabular-nums"
                >
                  {slot}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-border pt-4 flex items-center justify-between">
          <div>
            <span className="font-semibold text-foreground">{request.authorName}</span>
            <span className="text-muted-foreground mx-2">·</span>
            <Link href={`/districts/${request.districtId}`}>
              <span className="text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors">{request.districtName}</span>
            </Link>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(request.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>

          <div className="flex gap-2">
            {canMatch && (
              <ConnectAction
                requestId={requestId}
                onMatched={handleMatched}
                onFailed={handleMatchFailed}
              />
            )}
            {!isAuthor && user && (
              <button
                onClick={() => setShowReport(true)}
                className="px-3 py-2 border border-destructive/30 text-destructive rounded-lg text-sm hover:bg-destructive/5 transition-colors"
              >
                Report
              </button>
            )}
            {isAuthor && (
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                aria-busy={deleteMutation.isPending}
                className="px-3 py-2 border border-destructive/30 text-destructive rounded-lg text-sm hover:bg-destructive/5 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {deleteMutation.isError && (
        <p
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          {apiErrorMessage(deleteMutation.error)} Try Delete again to retry.
        </p>
      )}

      {showReport && request && (
        <ReportModal
          reportedUserId={request.authorId}
          reportedUserName={request.authorName}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
