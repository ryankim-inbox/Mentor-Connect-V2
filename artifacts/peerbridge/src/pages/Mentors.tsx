import { useAuth } from "@/lib/auth-context";
import { useState } from "react";
import { Link } from "wouter";
import { useListMentors } from "@workspace/api-client-react";
import { apiErrorMessage } from "@/lib/api-error-message";
export default function Mentors() {
  const { user } = useAuth();
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const mentors = useListMentors({ limit: 50, beforeId: cursors.at(-1) });
  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">Find a mentor</h1>
      <p className="my-4 text-muted-foreground">
        Verified mentors in your district. Connect through a mentorship request.
      </p>
      {mentors.isPending && <p role="status">Loading mentors…</p>}
      {mentors.error && (
        <p role="alert">
          {apiErrorMessage(mentors.error)}{" "}
          <button onClick={() => void mentors.refetch()}>Retry mentors</button>
        </p>
      )}
      {mentors.data?.length === 0 && <p>No mentors found.</p>}
      <ul className="space-y-4">
        {mentors.data?.map((m) => (
          <li key={m.id} className="rounded-xl border p-5">
            <Link
              href={`/profile/${m.id}`}
              className="font-semibold underline text-primary"
            >
              {m.name}
            </Link>
            <p>
              {m.role === "both" ? "Mentor & mentee" : "Mentor"} ·{" "}
              {m.districtName}
            </p>
            <p>{m.subjects.join(", ")}</p>
            <p className="whitespace-pre-wrap">{m.bio}</p>
          </li>
        ))}
      </ul>
      <div className="my-4 flex gap-4">
        <button
          disabled={cursors.length === 1 || mentors.isFetching}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          Previous mentors
        </button>
        <button
          disabled={mentors.data?.length !== 50 || mentors.isFetching}
          onClick={() => setCursors((c) => [...c, mentors.data?.at(-1)?.id])}
        >
          More mentors
        </button>
      </div>
      {!user?.isAdmin && (
        <Link href="/requests/new" className="text-primary underline">
          Post a mentorship request
        </Link>
      )}
    </section>
  );
}
