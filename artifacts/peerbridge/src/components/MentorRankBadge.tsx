import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { getPythonApi } from "@/lib/pythonApi";

interface MentorRank {
  mentorId: number;
  mentorName: string;
  matchedCount: number;
  rank: number | null;
  badge: string | null;
}

interface MentorRankTodo {
  status: "todo";
  mission: number;
  message: string;
  guide: string;
}

export function MentorRankBadge({ mentorId }: { mentorId: number }) {
  const { user } = useAuth();
  const ranks = useQuery({
    queryKey: ["mentor-ranks", user?.id],
    queryFn: () => getPythonApi<MentorRank[] | MentorRankTodo>("/api/mentor-ranks"),
    enabled: user !== null,
  });

  if (
    !user ||
    ranks.isPending ||
    ranks.isError ||
    ranks.data?.student_module?.status === "TODO"
  ) {
    return null;
  }

  const payload = ranks.data?.data;
  if (!Array.isArray(payload)) {
    return null;
  }

  const mentor = payload.find((row) => row.mentorId === mentorId);
  if (!mentor?.badge || mentor.rank === null) {
    return null;
  }

  const title = `${mentor.badge} mentor badge — rank #${mentor.rank} with ${mentor.matchedCount} matched ${mentor.matchedCount === 1 ? "request" : "requests"}`;

  return (
    <span
      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700"
      title={title}
    >
      {mentor.badge}
    </span>
  );
}
