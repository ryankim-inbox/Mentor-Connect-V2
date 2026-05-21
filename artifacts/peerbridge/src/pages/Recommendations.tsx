import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { TagBadge } from "@/components/TagBadge";

interface MentorMatch {
  rank: number;
  mentorId: number;
  mentorName: string;
  score: number;
  reason: string;
  matchedSubjects: string[];
  district: string;
  availability: string;
  language?: string;
  teachingStyle?: string;
}

interface RecommendationResult {
  questionId: number | null;
  studentId: number | null;
  studentName: string;
  requestedSubject: string;
  requestedTopic: string;
  matches: MentorMatch[];
}

const MOCK_RESULT: RecommendationResult = {
  questionId: 1,
  studentId: 10,
  studentName: "Alex Kim",
  requestedSubject: "Math",
  requestedTopic: "Algebra II",
  matches: [
    {
      rank: 1,
      mentorId: 3,
      mentorName: "Sophia Lee",
      score: 95,
      reason:
        "Same subject and exact topic match. Lives in your district and is free during your preferred weekday evenings. Speaks Korean, matching your language preference.",
      matchedSubjects: ["Math", "Algebra II"],
      district: "Cupertino Union",
      availability: "Weekday evenings",
      language: "Korean",
      teachingStyle: "Visual, step-by-step",
    },
    {
      rank: 2,
      mentorId: 7,
      mentorName: "Daniel Park",
      score: 87,
      reason:
        "Strong subject and topic overlap. Different district (Fremont), but availability and teaching style are a great fit.",
      matchedSubjects: ["Math", "Algebra II"],
      district: "Fremont Unified",
      availability: "Weekday evenings & weekends",
      language: "English, Korean",
      teachingStyle: "Conceptual, problem-based",
    },
    {
      rank: 3,
      mentorId: 12,
      mentorName: "Mia Chen",
      score: 78,
      reason:
        "Same subject area. Available on Friday afternoons and known for patient, beginner-friendly explanations.",
      matchedSubjects: ["Math"],
      district: "Palo Alto Unified",
      availability: "Friday afternoons",
      language: "English, Mandarin",
      teachingStyle: "Patient, beginner-friendly",
    },
  ],
};

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 90 ? "text-emerald-600" : score >= 80 ? "text-blue-600" : "text-amber-600";
  const ring =
    score >= 90 ? "stroke-emerald-500" : score >= 80 ? "stroke-blue-500" : "stroke-amber-500";
  const circumference = 2 * Math.PI * 20;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" strokeWidth="4" className="stroke-muted fill-none" />
        <circle
          cx="24"
          cy="24"
          r="20"
          strokeWidth="4"
          strokeLinecap="round"
          className={`fill-none ${ring} transition-all`}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${color}`}>
        {score}
      </div>
    </div>
  );
}

export default function Recommendations() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Sign in to see your recommendations</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">
            Sign in
          </button>
        </Link>
      </div>
    );
  }

  // TODO: connect to Python backend — GET /api/matches/{questionId} or POST /api/matches
  // Expected response shape: see Python/find_matches.py docstring (RecommendationResult above)
  const result = MOCK_RESULT;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700 mb-3">
          Preview — sample matches shown until the matching engine is connected
        </div>
        <h1 className="text-2xl font-bold text-foreground">Top 3 mentors for you</h1>
        <p className="text-muted-foreground mt-1">
          Based on your request for{" "}
          <span className="font-medium text-foreground">{result.requestedTopic}</span> in{" "}
          <span className="font-medium text-foreground">{result.requestedSubject}</span>. Ranked by
          subject overlap, location, schedule, language, and teaching style. Blocked users are
          excluded.
        </p>
      </div>

      <div className="space-y-4">
        {result.matches.map((m) => (
          <div
            key={m.mentorId}
            className="bg-card border border-card-border rounded-2xl p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-4">
              <ScoreRing score={m.score} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    #{m.rank}
                  </span>
                  <Link href={`/profile/${m.mentorId}`}>
                    <span className="text-lg font-semibold text-foreground hover:text-primary cursor-pointer">
                      {m.mentorName}
                    </span>
                  </Link>
                  <span className="text-xs text-muted-foreground">· {m.district}</span>
                </div>

                <div className="mt-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <p className="text-sm text-foreground leading-relaxed">
                    <span className="font-semibold text-primary">Why this match: </span>
                    {m.reason}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">Available:</span> {m.availability}
                  </span>
                  {m.language && (
                    <span>
                      <span className="font-medium text-foreground">Language:</span> {m.language}
                    </span>
                  )}
                  {m.teachingStyle && (
                    <span>
                      <span className="font-medium text-foreground">Style:</span> {m.teachingStyle}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.matchedSubjects.map((s) => (
                    <TagBadge key={s} name={s} color="#3b82f6" />
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                    Request match
                  </button>
                  <Link href={`/profile/${m.mentorId}`}>
                    <button className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors">
                      View profile
                    </button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 p-4 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">How matching works: </span>
        Each mentor gets a score out of 100. Subject overlap, location, schedule overlap, language,
        and teaching style each contribute. Anyone you've blocked — or who has blocked you — never
        appears in results.
      </div>
    </div>
  );
}
