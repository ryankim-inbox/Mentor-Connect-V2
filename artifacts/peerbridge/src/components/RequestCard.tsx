import { Link } from "wouter";
import { TagBadge } from "./TagBadge";
import { sortTimeSlots } from "@/lib/timeSlots";
import { DemoBadge, DemoNotice } from "./DemoBadge";

interface Tag {
  id: number;
  name: string;
  color: string;
  requestCount: number;
}

interface RequestCardProps {
  id: number;
  title: string;
  description: string;
  descriptionTruncated: boolean;
  authorName: string;
  authorId: number;
  authorRole: "mentor" | "mentee";
  districtName: string;
  tags: Tag[];
  status: "open" | "matched" | "closed";
  createdAt: string;
  preferredTimes?: string[];
  isDemo?: boolean;
}

export function RequestCard({
  id,
  title,
  description,
  descriptionTruncated,
  authorName,
  authorId,
  authorRole,
  districtName,
  tags,
  status,
  createdAt,
  preferredTimes,
  isDemo,
}: RequestCardProps) {
  const date = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const roleColor = authorRole === "mentor" ? "text-blue-600 bg-blue-50 border-blue-100" : "text-emerald-600 bg-emerald-50 border-emerald-100";
  const roleLabel = authorRole === "mentor" ? "Offering mentorship" : "Seeking a mentor";

  const sortedTimes = preferredTimes && preferredTimes.length > 0 ? sortTimeSlots(preferredTimes) : [];

  return (
    <Link href={`/requests/${id}`}>
      <div className="bg-card border border-card-border rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer group">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 break-words">
              {title}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{description}</p>
            {descriptionTruncated && <p className="text-xs text-muted-foreground mt-1">Preview — open request for full description</p>}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <DemoBadge isDemo={isDemo} kind="post" />
            <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${roleColor}`}>
              {roleLabel}
            </span>
          </div>
        </div>
        <DemoNotice isDemo={isDemo} kind="post" />

        <div className="flex flex-wrap gap-1.5 mb-3">
          {tags.slice(0, 4).map((tag) => (
            <TagBadge key={tag.id} name={tag.name} color={tag.color} />
          ))}
          {tags.length > 4 && (
            <span className="text-xs text-muted-foreground">+{tags.length - 4} more</span>
          )}
        </div>

        {sortedTimes.length > 0 && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-1">
            <span className="font-medium">Preferred times:</span>{" "}
            {sortedTimes.slice(0, 3).join(", ")}
            {sortedTimes.length > 3 && ` +${sortedTimes.length - 3} more`}
          </p>
        )}

        <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between text-xs text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0 break-words">
            <span className="font-medium text-foreground">{authorName}</span>
            <span>·</span>
            <span>{districtName}</span>
          </span>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {status !== "open" && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                status === "matched" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
              }`}>
                {status}
              </span>
            )}
            <time className="whitespace-nowrap" dateTime={createdAt}>{date}</time>
          </div>
        </div>
      </div>
    </Link>
  );
}
