import { ApiError, useGetUserActivityRank } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";

// Original geometric badges. Color and Roman numerals distinguish every tier;
// no game artwork or external assets are used.
const tiers = {
  Bronze: { numeral: "I", color: "#92400e", background: "#fff7ed" },
  Silver: { numeral: "II", color: "#475569", background: "#f1f5f9" },
  Gold: { numeral: "III", color: "#854d0e", background: "#fefce8" },
  Platinum: { numeral: "IV", color: "#0e7490", background: "#ecfeff" },
  Emerald: { numeral: "V", color: "#047857", background: "#ecfdf5" },
  Diamond: { numeral: "VI", color: "#1d4ed8", background: "#eff6ff" },
  Master: { numeral: "VII", color: "#7e22ce", background: "#faf5ff" },
  "Grand Master": { numeral: "VIII", color: "#be123c", background: "#fff1f2" },
  Challenger: { numeral: "IX", color: "#3730a3", background: "#eef2ff" },
} as const;

export function ActivityBadge({ userId }: { userId: number }) {
  const { user, status } = useAuth();
  const rank = useGetUserActivityRank(userId, {
    query: {
      queryKey: ["activity-rank", user?.id, userId],
      enabled:
        status === "authenticated" &&
        user?.hasMemberAccess === true &&
        userId > 0,
      staleTime: 60_000,
      retry: false,
    },
  });
  if (rank.error instanceof ApiError && rank.error.status === 404) return null;
  if (rank.isError)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Activity badge unavailable
      </p>
    );
  const result = rank.data;
  if (
    !result?.tier ||
    !result.rank ||
    result.distinctPartners < 1 ||
    !(result.tier in tiers)
  )
    return null;
  const tier = tiers[result.tier as keyof typeof tiers];
  const label = `${result.tier} activity badge, ${result.distinctPartners} distinct study partners, activity rank ${result.rank}`;
  return (
    <div className="mt-2">
      <span
        role="img"
        aria-label={label}
        title={label}
        style={{
          color: tier.color,
          backgroundColor: tier.background,
          borderColor: tier.color,
        }}
        className="inline-flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-xs font-semibold"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 40 44"
          className="h-8 w-7"
          fill="none"
        >
          <path
            d="M20 2 36 10v17L20 42 4 27V10Z"
            fill="currentColor"
            fillOpacity=".12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="m10 12 10-6 10 6M10 28l10 9 10-9"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <text
            x="20"
            y="25"
            textAnchor="middle"
            fill="currentColor"
            fontSize="11"
            fontFamily="sans-serif"
            fontWeight="700"
          >
            {tier.numeral}
          </text>
        </svg>
        <span aria-hidden="true">
          {result.tier} · {result.distinctPartners}{" "}
          {result.distinctPartners === 1 ? "partner" : "partners"}
        </span>
      </span>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">About this activity badge</summary>
        <p className="mt-1 max-w-md">
          Counts distinct eligible study partners in accepted matches. Repeated
          partners and messages do not add credit.
        </p>
        <p>Activity, not teaching quality.</p>
      </details>
    </div>
  );
}
