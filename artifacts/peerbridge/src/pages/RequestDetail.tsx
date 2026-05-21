import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetRequest,
  useMatchRequest,
  useDeleteRequest,
  useGetUser,
  getGetRequestQueryKey,
  getListRequestsQueryKey,
  getGetUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagBadge } from "@/components/TagBadge";
import { useAuth } from "@/lib/auth-context";
import ReportModal from "@/components/ReportModal";

interface Props {
  id: string;
}

export default function RequestDetail({ id }: Props) {
  const requestId = Number(id);
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showReport, setShowReport] = useState(false);
  const [justMatched, setJustMatched] = useState(false);

  const { data: request, isLoading } = useGetRequest(requestId, {
    query: { queryKey: getGetRequestQueryKey(requestId), enabled: !!requestId }
  });

  const isAuthor = user?.id === request?.authorId;
  const isMatched = user?.id === request?.matchedUserId;
  const showMatchedPanel = request?.status === "matched" && (isAuthor || isMatched || justMatched);

  const matchedWithId = isAuthor ? request?.matchedUserId : request?.authorId;
  const { data: matchedUserProfile } = useGetUser(matchedWithId ?? 0, {
    query: {
      queryKey: getGetUserQueryKey(matchedWithId ?? 0),
      enabled: !!matchedWithId && showMatchedPanel,
    }
  });

  const matchMutation = useMatchRequest();
  const deleteMutation = useDeleteRequest();

  const handleMatch = () => {
    matchMutation.mutate({ id: requestId }, {
      onSuccess: () => {
        setJustMatched(true);
        queryClient.invalidateQueries({ queryKey: getGetRequestQueryKey(requestId) });
      },
    });
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

  if (!request) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Request not found.</p>
        <Link href="/requests"><button className="mt-4 text-primary hover:underline text-sm">Back to requests</button></Link>
      </div>
    );
  }

  const canMatch = user && !isAuthor && request.status === "open";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/requests"><span className="hover:text-foreground transition-colors">Requests</span></Link>
        <span>/</span>
        <span className="text-foreground truncate">{request.title}</span>
      </div>

      {(showMatchedPanel || justMatched) && (
        <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-green-800 text-base">
                {justMatched ? "You're connected!" : "This request has been matched"}
              </h3>
              <p className="text-green-700 text-sm mt-1">
                {isAuthor
                  ? <>
                      <span className="font-semibold">{request.matchedUserName}</span> has accepted your request and wants to connect.
                    </>
                  : <>
                      You are connected with <span className="font-semibold">{request.authorName}</span>.
                    </>
                }
              </p>
              {matchedUserProfile && (
                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 bg-white border border-green-100 rounded-xl p-4">
                    <p className="text-xs text-green-600 font-medium uppercase tracking-wide mb-2">Next step — reach out</p>
                    <p className="text-sm font-semibold text-foreground">{matchedUserProfile.name}</p>
                    <p className="text-sm text-muted-foreground">{matchedUserProfile.email}</p>
                    {matchedUserProfile.districtName && (
                      <p className="text-xs text-muted-foreground mt-1">{matchedUserProfile.districtName}</p>
                    )}
                    {matchedUserProfile.bio && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{matchedUserProfile.bio}</p>
                    )}
                    <Link href={`/profile/${matchedUserProfile.id}`}>
                      <button className="mt-3 text-xs text-primary font-medium hover:underline">View full profile</button>
                    </Link>
                  </div>
                  <div className="sm:w-48 bg-white border border-green-100 rounded-xl p-4">
                    <p className="text-xs text-green-600 font-medium uppercase tracking-wide mb-2">Tips</p>
                    <ul className="text-xs text-muted-foreground space-y-1.5">
                      <li>Send an intro email with your goals</li>
                      <li>Suggest a time to meet or video call</li>
                      <li>Set clear expectations upfront</li>
                    </ul>
                  </div>
                </div>
              )}
              {!matchedUserProfile && (request.matchedUserId || isAuthor) && (
                <p className="text-sm text-green-700 mt-2">
                  Contact them at their school email to get started.
                </p>
              )}
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

        <div className="border-t border-border pt-4 flex items-center justify-between">
          <div>
            <Link href={`/profile/${request.authorId}`}>
              <span className="font-semibold text-foreground hover:text-primary cursor-pointer transition-colors">{request.authorName}</span>
            </Link>
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
              <button
                onClick={handleMatch}
                disabled={matchMutation.isPending}
                className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {matchMutation.isPending ? "Connecting..." : "Connect"}
              </button>
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
                className="px-3 py-2 border border-destructive/30 text-destructive rounded-lg text-sm hover:bg-destructive/5 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

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
