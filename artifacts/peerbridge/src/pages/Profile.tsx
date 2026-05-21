import { useState } from "react";
import { Link } from "wouter";
import {
  useGetUser,
  useListRequests,
  getGetUserQueryKey,
  getListRequestsQueryKey,
} from "@workspace/api-client-react";
import { RequestCard } from "@/components/RequestCard";
import { TagBadge } from "@/components/TagBadge";
import { useAuth } from "@/lib/auth-context";
import ReportModal from "@/components/ReportModal";
import BlockButton from "@/components/BlockButton";

interface Props {
  id: string;
}

export default function Profile({ id }: Props) {
  const userId = Number(id);
  const { user: currentUser } = useAuth();
  const [showReport, setShowReport] = useState(false);

  const { data: profile, isLoading } = useGetUser(userId, {
    query: { queryKey: getGetUserQueryKey(userId), enabled: !!userId }
  });

  const { data: userRequests } = useListRequests(undefined, {
    query: { queryKey: getListRequestsQueryKey() }
  });

  const theirRequests = userRequests?.filter(r => r.authorId === userId) ?? [];
  const isOwnProfile = currentUser?.id === userId;

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="h-40 bg-card border border-card-border rounded-2xl animate-pulse mb-6" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-muted-foreground">
        User not found.
      </div>
    );
  }

  const roleLabel = profile.role === "mentor" ? "Mentor" : profile.role === "mentee" ? "Mentee" : "Mentor & Mentee";
  const roleColor = profile.role === "mentor"
    ? "text-blue-600 bg-blue-50 border-blue-100"
    : profile.role === "mentee"
    ? "text-emerald-600 bg-emerald-50 border-emerald-100"
    : "text-violet-600 bg-violet-50 border-violet-100";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="bg-card border border-card-border rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{profile.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${roleColor}`}>
                  {roleLabel}
                </span>
                {profile.isVerified && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border text-green-600 bg-green-50 border-green-100">
                    Verified student
                  </span>
                )}
              </div>
              {profile.districtName && (
                <p className="text-sm text-muted-foreground mt-1">{profile.districtName}</p>
              )}
            </div>
          </div>

          {!isOwnProfile && currentUser && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowReport(true)}
                className="px-3 py-1.5 text-sm border border-destructive/30 text-destructive rounded-lg hover:bg-destructive/5 transition-colors"
              >
                Report
              </button>
              <BlockButton userId={userId} userName={profile.name} />
            </div>
          )}

          {isOwnProfile && (
            <Link href="/settings">
              <button className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors">
                Edit profile
              </button>
            </Link>
          )}
        </div>

        {profile.bio && (
          <p className="mt-4 text-foreground leading-relaxed">{profile.bio}</p>
        )}

        {profile.subjects && profile.subjects.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-muted-foreground mb-2">Subjects</p>
            <div className="flex flex-wrap gap-2">
              {profile.subjects.map((s) => (
                <span key={s} className="px-2.5 py-1 bg-secondary text-secondary-foreground rounded-full text-xs font-medium">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4">
          Joined {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
      </div>

      <div>
        <h2 className="font-semibold text-lg mb-4">
          {isOwnProfile ? "Your requests" : `${profile.name.split(" ")[0]}'s requests`} ({theirRequests.length})
        </h2>
        <div className="space-y-3">
          {theirRequests.map((req) => (
            <RequestCard key={req.id} {...req} />
          ))}
          {theirRequests.length === 0 && (
            <p className="text-muted-foreground text-sm py-6 text-center">No requests posted yet.</p>
          )}
        </div>
      </div>

      {showReport && (
        <ReportModal
          reportedUserId={profile.id}
          reportedUserName={profile.name}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
