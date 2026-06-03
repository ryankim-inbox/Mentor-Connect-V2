import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface PythonMatchStatus {
  endpointStatus: "connected" | "unavailable" | "TODO" | "import error" | "runtime error" | "no results yet";
  matchCount: number;
  message: string;
  isReal: boolean;
  isTodo: boolean;
  error?: string;
}

interface BlockStatus {
  endpointStatus: "connected" | "unavailable" | "TODO" | "import error" | "runtime error";
  serviceAvailable: boolean;
  blockedUsersExcluded: boolean | null;
  message: string;
  error?: string;
}

type PythonRecord = Record<string, unknown>;

const EMPTY_RESULT: RecommendationResult = {
  questionId: null,
  studentId: null,
  studentName: "Unknown student",
  requestedSubject: "Unknown subject",
  requestedTopic: "question",
  matches: [],
};

const INITIAL_MATCH_STATUS: PythonMatchStatus = {
  endpointStatus: "unavailable",
  matchCount: 0,
  message: "Python service has not been checked yet.",
  isReal: false,
  isTodo: false,
};

const INITIAL_BLOCK_STATUS: BlockStatus = {
  endpointStatus: "unavailable",
  serviceAvailable: false,
  blockedUsersExcluded: null,
  message: "Block service has not been checked yet.",
};

function asRecord(value: unknown): PythonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as PythonRecord)
    : {};
}

function stringField(record: PythonRecord, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return fallback;
}

function numberField(record: PythonRecord, keys: string[], fallback: number | null = null) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

function booleanField(record: PythonRecord, keys: string[], fallback = false) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return fallback;
}

function stringArrayField(record: PythonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return [value];
    }
  }
  return [];
}

function normalizeMatch(rawMatch: unknown, index: number): MentorMatch {
  const match = asRecord(rawMatch);
  const mentorId = numberField(match, ["mentor_id", "mentorId", "id", "user_id"], index + 1) ?? index + 1;
  const score = numberField(match, ["score", "match_score", "matchScore"], 0) ?? 0;

  return {
    rank: numberField(match, ["rank"], index + 1) ?? index + 1,
    mentorId,
    mentorName: stringField(match, ["mentor_name", "mentorName", "name"], `Mentor ${mentorId}`),
    score,
    reason: stringField(match, ["reason", "match_reason", "message"], "No match reason returned yet."),
    matchedSubjects: stringArrayField(match, ["matched_subjects", "matchedSubjects", "subjects"]),
    district: stringField(match, ["district", "location"], "Unknown district"),
    availability: stringField(match, ["availability", "available_times", "availableTimes"], "Unknown availability"),
    language: stringField(match, ["language", "languages", "preferred_language", "preferredLanguage"]),
    teachingStyle: stringField(match, ["teaching_style", "teachingStyle"]),
  };
}

function normalizeRecommendation(raw: unknown, questionId: number): RecommendationResult {
  const record = asRecord(raw);
  const rawMatches = Array.isArray(record.matches) ? record.matches : [];

  return {
    questionId: numberField(record, ["question_id", "questionId"], questionId),
    studentId: numberField(record, ["student_id", "studentId"]),
    studentName: stringField(record, ["student_name", "studentName"], "Unknown student"),
    requestedSubject: stringField(record, ["requested_subject", "requestedSubject", "subject"], "Unknown subject"),
    requestedTopic: stringField(record, ["requested_topic", "requestedTopic", "topic"], `question #${questionId}`),
    matches: rawMatches.map(normalizeMatch),
  };
}

function normalizeMatchStatus(raw: unknown, matchCount: number): PythonMatchStatus {
  const record = asRecord(raw);
  const status = stringField(record, ["status"], matchCount > 0 ? "connected" : "no results yet");
  const isTodo = booleanField(record, ["is_todo", "isTodo"], status === "TODO");
  const isReal = booleanField(record, ["is_real", "isReal"], matchCount > 0 && !isTodo);
  const success = booleanField(record, ["success"], matchCount > 0);

  return {
    endpointStatus: (success && matchCount === 0 && !isTodo ? "no results yet" : status) as PythonMatchStatus["endpointStatus"],
    matchCount,
    message: stringField(record, ["message"], "Python service returned no message."),
    isReal,
    isTodo,
    error: stringField(record, ["error"]),
  };
}

function normalizeBlockStatus(raw: unknown): BlockStatus {
  const record = asRecord(raw);
  const status = stringField(record, ["status"], "unavailable") as BlockStatus["endpointStatus"];
  const hasBlockedUsersExcluded = "blocked_users_excluded" in record || "blockedUsersExcluded" in record;

  return {
    endpointStatus: status,
    serviceAvailable: booleanField(record, ["service_available", "serviceAvailable", "success"], false),
    blockedUsersExcluded: hasBlockedUsersExcluded
      ? booleanField(record, ["blocked_users_excluded", "blockedUsersExcluded"], false)
      : null,
    message: stringField(record, ["message"], "Python block status returned no message."),
    error: stringField(record, ["error"]),
  };
}

function statusClass(status: string) {
  if (status === "connected") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (status === "TODO" || status === "no results yet") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-red-50 text-red-700 border-red-200";
}

function ScoreRing({ score }: { score: number }) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const color =
    clampedScore >= 90 ? "text-emerald-600" : clampedScore >= 80 ? "text-blue-600" : "text-amber-600";
  const ring =
    clampedScore >= 90 ? "stroke-emerald-500" : clampedScore >= 80 ? "stroke-blue-500" : "stroke-amber-500";
  const circumference = 2 * Math.PI * 20;
  const offset = circumference - (clampedScore / 100) * circumference;

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
  const [questionIdInput, setQuestionIdInput] = useState("1");
  const [result, setResult] = useState<RecommendationResult>(EMPTY_RESULT);
  const [matchStatus, setMatchStatus] = useState<PythonMatchStatus>(INITIAL_MATCH_STATUS);
  const [blockStatus, setBlockStatus] = useState<BlockStatus>(INITIAL_BLOCK_STATUS);
  const [isLoading, setIsLoading] = useState(false);
  const [lastCheckedQuestionId, setLastCheckedQuestionId] = useState<number | null>(null);
  const hasFetchedInitialStatus = useRef(false);

  const parsedQuestionId = useMemo(() => {
    const parsed = Number(questionIdInput);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [questionIdInput]);

  const fetchLivePythonResult = useCallback(async () => {
    if (!parsedQuestionId) {
      setMatchStatus({
        endpointStatus: "unavailable",
        matchCount: 0,
        message: "Enter a positive numeric question ID before refreshing.",
        isReal: false,
        isTodo: false,
      });
      return;
    }

    setIsLoading(true);
    setLastCheckedQuestionId(parsedQuestionId);

    try {
      const [matchesResponse, blocksResponse] = await Promise.all([
        fetch(`/python-api/practice/matching/${parsedQuestionId}?limit=5`),
        fetch("/python-api/practice/blocks/status"),
      ]);

      if (!matchesResponse.ok) {
        throw new Error(`Matching endpoint returned HTTP ${matchesResponse.status}`);
      }

      const rawMatchResult: unknown = await matchesResponse.json();
      const normalizedResult = normalizeRecommendation(rawMatchResult, parsedQuestionId);
      setResult(normalizedResult);
      setMatchStatus(normalizeMatchStatus(rawMatchResult, normalizedResult.matches.length));

      if (blocksResponse.ok) {
        const rawBlockStatus: unknown = await blocksResponse.json();
        setBlockStatus(normalizeBlockStatus(rawBlockStatus));
      } else {
        setBlockStatus({
          endpointStatus: "unavailable",
          serviceAvailable: false,
          blockedUsersExcluded: null,
          message: `Block status endpoint returned HTTP ${blocksResponse.status}.`,
        });
      }
    } catch (error) {
      setResult({ ...EMPTY_RESULT, questionId: parsedQuestionId });
      setMatchStatus({
        endpointStatus: "unavailable",
        matchCount: 0,
        message: "Could not connect to the Python matching service.",
        error: error instanceof Error ? error.message : String(error),
        isReal: false,
        isTodo: false,
      });
      setBlockStatus({
        endpointStatus: "unavailable",
        serviceAvailable: false,
        blockedUsersExcluded: null,
        message: "Could not connect to the Python block status endpoint.",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, [parsedQuestionId]);

  useEffect(() => {
    if (user && !hasFetchedInitialStatus.current) {
      hasFetchedInitialStatus.current = true;
      void fetchLivePythonResult();
    }
  }, [fetchLivePythonResult, user]);

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

  const emptyMessage = matchStatus.endpointStatus === "no results yet"
    ? "Python service is connected, but the student matching function has not returned matches yet."
    : matchStatus.message;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium mb-3 ${statusClass(matchStatus.endpointStatus)}`}>
          Python matching: {matchStatus.endpointStatus}
        </div>
        <h1 className="text-2xl font-bold text-foreground">Top mentors for you</h1>
        <p className="text-muted-foreground mt-1">
          Live results for{" "}
          <span className="font-medium text-foreground">{result.requestedTopic}</span> in{" "}
          <span className="font-medium text-foreground">{result.requestedSubject}</span>. The page
          shows the current output from the student's Python practice files without treating mock data
          as live data.
        </p>
      </div>

      <div className="mb-6 bg-card border border-card-border rounded-2xl p-5">
        <label htmlFor="question-id" className="block text-sm font-semibold text-foreground mb-2">
          Question ID
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="question-id"
            type="number"
            min="1"
            value={questionIdInput}
            onChange={(event) => setQuestionIdInput(event.target.value)}
            className="w-full sm:w-48 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            aria-describedby="question-id-help"
          />
          <button
            type="button"
            onClick={() => void fetchLivePythonResult()}
            disabled={isLoading || !parsedQuestionId}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh live Python result"}
          </button>
        </div>
        <p id="question-id-help" className="mt-2 text-xs text-muted-foreground">
          Calls <span className="font-mono">/python-api/practice/matching/{parsedQuestionId ?? "{questionId}"}?limit=5</span>.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <section className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold text-foreground">Python Practice Engine Status</h2>
            <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${statusClass(matchStatus.endpointStatus)}`}>
              {matchStatus.endpointStatus}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium text-foreground">Matching endpoint status:</span>{" "}
              <span className="text-muted-foreground">{matchStatus.endpointStatus}</span>
            </p>
            <p>
              <span className="font-medium text-foreground">Matches returned:</span>{" "}
              <span className="text-muted-foreground">{matchStatus.matchCount}</span>
            </p>
            <p>
              <span className="font-medium text-foreground">Python message:</span>{" "}
              <span className="text-muted-foreground">{matchStatus.message}</span>
            </p>
            <p>
              <span className="font-medium text-foreground">Response type:</span>{" "}
              <span className="text-muted-foreground">{matchStatus.isReal ? "real" : matchStatus.isTodo ? "TODO" : "not live yet"}</span>
            </p>
            {lastCheckedQuestionId && (
              <p>
                <span className="font-medium text-foreground">Last checked question:</span>{" "}
                <span className="text-muted-foreground">#{lastCheckedQuestionId}</span>
              </p>
            )}
            {matchStatus.error && (
              <p className="text-red-700">
                <span className="font-medium">Error:</span> {matchStatus.error}
              </p>
            )}
          </div>
        </section>

        <section className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold text-foreground">Block / Report Filter Status</h2>
            <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${statusClass(blockStatus.endpointStatus)}`}>
              {blockStatus.endpointStatus}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium text-foreground">Block service available:</span>{" "}
              <span className="text-muted-foreground">{blockStatus.serviceAvailable ? "yes" : "no"}</span>
            </p>
            <p>
              <span className="font-medium text-foreground">Blocked users excluded:</span>{" "}
              <span className="text-muted-foreground">
                {blockStatus.blockedUsersExcluded === null
                  ? "unknown"
                  : blockStatus.blockedUsersExcluded
                    ? "yes"
                    : "no"}
              </span>
            </p>
            <p>
              <span className="font-medium text-foreground">Python message:</span>{" "}
              <span className="text-muted-foreground">{blockStatus.message}</span>
            </p>
            {blockStatus.error && (
              <p className="text-red-700">
                <span className="font-medium">Error:</span> {blockStatus.error}
              </p>
            )}
          </div>
        </section>
      </div>

      {isLoading && (
        <div className="bg-card border border-card-border rounded-2xl p-5 text-sm text-muted-foreground">
          Loading live Python matches...
        </div>
      )}

      {!isLoading && result.matches.length === 0 && (
        <div className="bg-card border border-card-border rounded-2xl p-5 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}

      {!isLoading && result.matches.length > 0 && (
        <div className="space-y-4">
          {result.matches.map((m) => (
            <div
              key={`${m.rank}-${m.mentorId}`}
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
                    <span className="text-xs text-muted-foreground">- {m.district}</span>
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

                  {m.matchedSubjects.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.matchedSubjects.map((s) => (
                        <TagBadge key={s} name={s} color="#3b82f6" />
                      ))}
                    </div>
                  )}

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
      )}

      <div className="mt-8 p-4 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">How matching works: </span>
        The UI displays whatever the Python practice service currently returns. Subject overlap,
        location, schedule overlap, language, teaching style, and block filtering depend on the
        student's Python implementation and are not mocked here.
      </div>
    </div>
  );
}
