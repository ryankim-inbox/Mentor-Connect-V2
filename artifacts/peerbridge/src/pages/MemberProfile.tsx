import { ActivityBadge } from "@/components/ActivityBadge";
import { useState } from "react";
import { Link } from "wouter";
import { getGetUserQueryKey, useGetUser } from "@workspace/api-client-react";

import { useAuth } from "@/lib/auth-context";
import { VerificationNotice } from "@/components/RequireAuth";
import { MemberSafety } from "@/components/MemberSafety";

export default function MemberProfile({ id }: { id: string }) {
  const { user, status } = useAuth();
  const [blockedId, setBlockedId] = useState<number | null>(null);
  const parsedId = Number(id);
  const userId = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : 0;
  const profile = useGetUser(userId, {
    query: {
      queryKey: getGetUserQueryKey(userId),
      enabled:
        blockedId !== userId &&
        userId > 0 &&
        status === "authenticated" &&
        (user?.hasMemberAccess === true || user?.id === userId),
    },
  });

  if (user && !user.hasMemberAccess && user.id !== userId)
    return <VerificationNotice />;

  if (blockedId === userId)
    return (
      <section className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-xl font-bold" role="status">
          Member blocked.
        </h1>
        <p className="my-4">Manage your blocked members in Settings.</p>
        <Link href="/settings" className="text-primary underline">
          Manage blocked members
        </Link>
      </section>
    );

  if (!userId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="text-xl font-bold">Member profile unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a valid member profile.
        </p>
      </div>
    );
  }

  if (profile.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8" role="status">
        <div className="h-52 animate-pulse rounded-2xl border border-card-border bg-card" />
      </div>
    );
  }

  if (profile.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="text-xl font-bold">Member profile unavailable</h1>
        <p className="mt-2 text-sm text-red-700">
          {profile.error instanceof Error
            ? profile.error.message
            : String(profile.error)}
        </p>
        <button
          type="button"
          onClick={() => void profile.refetch()}
          className="mt-3 text-sm font-semibold text-primary underline"
        >
          Retry profile
        </button>
      </div>
    );
  }

  if (!profile.data) {
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="rounded-2xl border border-card-border bg-card p-6">
        <MemberSafety
          userId={userId}
          name={profile.data.name}
          onBlocked={() => setBlockedId(userId)}
        />
        <h1 className="text-xl font-bold text-foreground">
          {profile.data.name}
        </h1>
        <ActivityBadge userId={userId} />
        {profile.data.subjects.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Subjects
            </p>
            <div className="flex flex-wrap gap-2">
              {profile.data.subjects.map((subject) => (
                <span
                  key={subject}
                  className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
                >
                  {subject}
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Joined{" "}
          {new Date(profile.data.createdAt).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}
