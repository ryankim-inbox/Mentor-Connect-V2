import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { TagBadge } from "@/components/TagBadge";

type JsonRecord = Record<string, unknown>;

interface EngineStatus {
  success: boolean;
  status: string;
  message: string;
  error?: string;
  isTodo: boolean;
  isReal: boolean;
  availableFunctions: string[];
}

interface MentorMatch {
  rank: number;
  mentorId: number;
  mentorName: string;
  score: number;
  reason: string;
  matchedSubjects: string[];
  district: string;
  availability: string;
}

const DEFAULT_LOCATION_INPUT = JSON.stringify(
  {
    student: { id: 1, locations: ["San Jose"] },
    mentor: { id: 2, locations: ["San Jose", "Cupertino"] },
    question: { id: 1, subject: "math" },
  },
  null,
  2,
);

const EMPTY_ENGINE: EngineStatus = {
  success: false,
  status: "unavailable",
  message: "Not checked yet.",
  isTodo: false,
  isReal: false,
  availableFunctions: [],
};

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function getString(record: JsonRecord, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return fallback;
}

function getNumber(record: JsonRecord, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

function getBoolean(record: JsonRecord, keys: string[], fallback = false) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return fallback;
}

function getStringArray(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter(Boolean);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return [value];
    }
  }
  return [];
}

function normalizeEngine(value: unknown): EngineStatus {
  const record = asRecord(value);
  return {
    success: getBoolean(record, ["success"], false),
    status: getString(record, ["status"], "unavailable"),
    message: getString(record, ["message"], "No message returned."),
    error: getString(record, ["error"]),
    isTodo: getBoolean(record, ["is_todo", "isTodo"], false),
    isReal: getBoolean(record, ["is_real", "isReal"], false),
    availableFunctions: getStringArray(record, ["available_functions", "availableFunctions"]),
  };
}

function normalizeMatches(value: unknown): MentorMatch[] {
  const record = asRecord(value);
  const matches = Array.isArray(record.matches) ? record.matches : [];

  return matches.map((item, index) => {
    const match = asRecord(item);
    const mentorId = getNumber(match, ["mentor_id", "mentorId", "id", "user_id"], index + 1);
    return {
      rank: getNumber(match, ["rank"], index + 1),
      mentorId,
      mentorName: getString(match, ["mentor_name", "mentorName", "name"], `Mentor ${mentorId}`),
      score: getNumber(match, ["score", "match_score", "matchScore"], 0),
      reason: getString(match, ["reason", "match_reason", "message"], "No reason returned."),
      matchedSubjects: getStringArray(match, ["matched_subjects", "matchedSubjects", "subjects"]),
      district: getString(match, ["district", "location"], "Unknown district"),
      availability: getString(match, ["availability", "available_times", "availableTimes"], "Unknown availability"),
    };
  });
}

function badgeClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "connected" || normalized === "real result") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (normalized.includes("todo") || normalized === "missing function" || normalized === "no results yet") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-red-50 text-red-700 border-red-200";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-semibold ${badgeClass(status)}`}>
      {status}
    </span>
  );
}

function RawJson({ value }: { value: unknown }) {
  if (value === null) {
    return null;
  }

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Raw JSON output</summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function EngineCard({ title, engine }: { title: string; engine: EngineStatus }) {
  return (
    <section className="rounded-2xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <StatusBadge status={engine.status} />
      </div>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Success:</span> {engine.success ? "true" : "false"}
        </p>
        <p>
          <span className="font-medium text-foreground">Response:</span>{" "}
          {engine.isReal ? "real result" : engine.isTodo ? "TODO / not implemented" : "not live yet"}
        </p>
        <p>{engine.message}</p>
        {engine.error && <p className="text-red-700">Error: {engine.error}</p>}
      </div>
    </section>
  );
}

function MatchCard({ match }: { match: MentorMatch }) {
  return (
    <article className="rounded-2xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">#{match.rank}</div>
          <Link href={`/profile/${match.mentorId}`}>
            <span className="mt-1 block cursor-pointer text-lg font-semibold text-foreground hover:text-primary">
              {match.mentorName}
            </span>
          </Link>
        </div>
        <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
          {match.score}
        </div>
      </div>
      <p className="mt-3 rounded-xl border border-primary/10 bg-primary/5 p-3 text-sm text-foreground">
        {match.reason}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">District:</span> {match.district}
        </span>
        <span>
          <span className="font-medium text-foreground">Available:</span> {match.availability}
        </span>
      </div>
      {match.matchedSubjects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {match.matchedSubjects.map((subject) => (
            <TagBadge key={subject} name={subject} color="#3b82f6" />
          ))}
        </div>
      )}
    </article>
  );
}

async function getJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload: unknown = await response.json().catch(() => ({
    success: false,
    status: "runtime error",
    message: "Response was not valid JSON.",
  }));

  if (!response.ok) {
    const record = asRecord(payload);
    throw new Error(getString(record, ["message"], `HTTP ${response.status}`));
  }

  return payload;
}

export default function PracticeLab() {
  const [overallRaw, setOverallRaw] = useState<unknown>(null);
  const [matchingRaw, setMatchingRaw] = useState<unknown>(null);
  const [locationsStatusRaw, setLocationsStatusRaw] = useState<unknown>(null);
  const [locationTestRaw, setLocationTestRaw] = useState<unknown>(null);
  const [blocksRaw, setBlocksRaw] = useState<unknown>(null);
  const [questionId, setQuestionId] = useState("1");
  const [limit, setLimit] = useState("5");
  const [locationInput, setLocationInput] = useState(DEFAULT_LOCATION_INPUT);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isRunningMatching, setIsRunningMatching] = useState(false);
  const [isRunningLocation, setIsRunningLocation] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [frontendError, setFrontendError] = useState("");
  const intervalRef = useRef<number | null>(null);
  const hasLoadedInitial = useRef(false);

  const engines = useMemo(() => {
    const root = asRecord(overallRaw);
    const engineMap = asRecord(root.engines);
    return {
      matching: normalizeEngine(engineMap.matching),
      locations: normalizeEngine(engineMap.locations),
      blocks: normalizeEngine(engineMap.blocks),
    };
  }, [overallRaw]);

  const matchingEngine = useMemo(() => normalizeEngine(matchingRaw), [matchingRaw]);
  const locationEngine = useMemo(() => normalizeEngine(locationsStatusRaw), [locationsStatusRaw]);
  const blockEngine = useMemo(() => normalizeEngine(blocksRaw), [blocksRaw]);
  const matches = useMemo(() => normalizeMatches(matchingRaw), [matchingRaw]);

  const refreshStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    setFrontendError("");
    try {
      const [overall, locations, blocks] = await Promise.all([
        getJson("/api/practice/status"),
        getJson("/api/practice/locations/status"),
        getJson("/api/practice/blocks/status"),
      ]);
      setOverallRaw(overall);
      setLocationsStatusRaw(locations);
      setBlocksRaw(blocks);
    } catch (error) {
      setFrontendError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  const runMatching = useCallback(async () => {
    const parsedQuestionId = Number(questionId);
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedQuestionId) || parsedQuestionId <= 0) {
      setFrontendError("Question ID must be a positive integer.");
      return;
    }
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      setFrontendError("Limit must be a positive integer.");
      return;
    }

    setIsRunningMatching(true);
    setFrontendError("");
    try {
      const result = await getJson(`/api/practice/matching/${parsedQuestionId}?limit=${parsedLimit}`);
      setMatchingRaw(result);
    } catch (error) {
      setMatchingRaw({
        success: false,
        status: "unavailable",
        message: "Could not connect to the Python matching endpoint.",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunningMatching(false);
    }
  }, [limit, questionId]);

  const runLocationTest = useCallback(async () => {
    let parsedInput: JsonRecord;
    try {
      parsedInput = asRecord(JSON.parse(locationInput));
    } catch (error) {
      setFrontendError(`Location test input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setIsRunningLocation(true);
    setFrontendError("");
    try {
      const result = await getJson("/api/practice/locations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedInput),
      });
      setLocationTestRaw(result);
    } catch (error) {
      setLocationTestRaw({
        success: false,
        status: "unavailable",
        message: "Could not connect to the Python location test endpoint.",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunningLocation(false);
    }
  }, [locationInput]);

  useEffect(() => {
    if (!hasLoadedInitial.current) {
      hasLoadedInitial.current = true;
      void refreshStatus();
      void runMatching();
    }
  }, [refreshStatus, runMatching]);

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      intervalRef.current = null;
      return;
    }

    intervalRef.current = window.setInterval(() => {
      void refreshStatus();
      void runMatching();
    }, 5000);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      intervalRef.current = null;
    };
  }, [autoRefresh, refreshStatus, runMatching]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <div className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
          Live integration monitor
        </div>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Python Practice Lab</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Test whether the website can import, run, and display the current output from the student's
          Python practice files. Errors are shown directly instead of hidden.
        </p>
      </div>

      {frontendError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {frontendError}
        </div>
      )}

      <section className="mb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Overall Python Practice Status</h2>
            <p className="text-sm text-muted-foreground">
              Backend status endpoint: <span className="font-mono">/api/practice/status</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={isLoadingStatus}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingStatus ? "Refreshing..." : "Refresh status"}
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <EngineCard title="Matching Engine" engine={engines.matching} />
          <EngineCard title="Location Engine" engine={engines.locations} />
          <EngineCard title="Block / Report Engine" engine={engines.blocks} />
        </div>
        <RawJson value={overallRaw} />
      </section>

      <section className="mb-8 rounded-2xl border border-card-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Matching Engine Test</h2>
            <p className="text-sm text-muted-foreground">
              Calls <span className="font-mono">/api/practice/matching/{questionId || "{id}"}?limit={limit || "5"}</span>
            </p>
          </div>
          <StatusBadge status={matchingEngine.status} />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <label className="text-sm font-semibold text-foreground">
            Question ID
            <input
              type="number"
              min="1"
              value={questionId}
              onChange={(event) => setQuestionId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <label className="text-sm font-semibold text-foreground">
            Limit
            <input
              type="number"
              min="1"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <button
            type="button"
            onClick={() => void runMatching()}
            disabled={isRunningMatching}
            className="self-end rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRunningMatching ? "Running..." : "Run Matching"}
          </button>
          <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto refresh
          </label>
        </div>

        <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
          <p>
            <span className="font-medium text-foreground">Matches returned:</span> {matches.length}
          </p>
          <p>
            <span className="font-medium text-foreground">Success:</span> {matchingEngine.success ? "true" : "false"}
          </p>
          <p>
            <span className="font-medium text-foreground">Response:</span>{" "}
            {matchingEngine.isReal ? "real" : matchingEngine.isTodo ? "TODO" : "not live yet"}
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{matchingEngine.message}</p>
        {matchingEngine.error && <p className="mt-2 text-sm text-red-700">Error: {matchingEngine.error}</p>}

        {matches.length === 0 ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Python service is connected or reachable, but the student matching function has not
            returned matches yet.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {matches.map((match) => (
              <MatchCard key={`${match.rank}-${match.mentorId}`} match={match} />
            ))}
          </div>
        )}
        <RawJson value={matchingRaw} />
      </section>

      <section className="mb-8 rounded-2xl border border-card-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Location Engine Test</h2>
            <p className="text-sm text-muted-foreground">
              Calls <span className="font-mono">/api/practice/locations/status</span> and{" "}
              <span className="font-mono">/api/practice/locations/test</span>
            </p>
          </div>
          <StatusBadge status={locationEngine.status} />
        </div>

        <div className="mb-4 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Available functions:</span>{" "}
            {locationEngine.availableFunctions.length > 0
              ? locationEngine.availableFunctions.join(", ")
              : "none detected"}
          </p>
          <p className="mt-1">{locationEngine.message}</p>
          {locationEngine.error && <p className="mt-1 text-red-700">Error: {locationEngine.error}</p>}
        </div>

        <label className="block text-sm font-semibold text-foreground">
          JSON test input
          <textarea
            value={locationInput}
            onChange={(event) => setLocationInput(event.target.value)}
            rows={9}
            className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
        <button
          type="button"
          onClick={() => void runLocationTest()}
          disabled={isRunningLocation}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRunningLocation ? "Running..." : "Run Location Test"}
        </button>

        <RawJson value={locationTestRaw} />
        <RawJson value={locationsStatusRaw} />
      </section>

      <section className="rounded-2xl border border-card-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Block / Report Engine Test</h2>
            <p className="text-sm text-muted-foreground">
              Calls <span className="font-mono">/api/practice/blocks/status</span>
            </p>
          </div>
          <StatusBadge status={blockEngine.status} />
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Import status:</span> {blockEngine.status}
          </p>
          <p>
            <span className="font-medium text-foreground">Available functions:</span>{" "}
            {blockEngine.availableFunctions.length > 0 ? blockEngine.availableFunctions.join(", ") : "none detected"}
          </p>
          <p>{blockEngine.message}</p>
          {blockEngine.error && <p className="text-red-700">Error: {blockEngine.error}</p>}
        </div>
        <RawJson value={blocksRaw} />
      </section>
    </div>
  );
}
