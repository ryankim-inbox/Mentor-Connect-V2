// Small fetch helper for the Python adapter endpoints (/api/analytics/*,
// /api/admin/*, /api/scheduling/*, /api/python-reports/*).
//
// Those endpoints wrap the student practice files in Python/ and answer with
// a common envelope: real data (either from the student module or computed by
// the adapter) plus the live import/call status of the student module.

export interface StudentModuleStatus {
  module: string;
  attempted_function?: string | null;
  importable: boolean;
  called?: boolean;
  status?: string;
  error?: string | null;
  available_functions?: string[];
}

export interface PyEnvelope<T> {
  ok: boolean;
  feature: string;
  source: "student-module" | "adapter-fallback";
  student_module?: StudentModuleStatus | null;
  student_result?: unknown;
  data: T;
}

function isEnvelope(payload: unknown): payload is PyEnvelope<unknown> {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "data" in payload &&
    "source" in payload
  );
}

export async function getPythonApi<T>(path: string, init?: RequestInit): Promise<PyEnvelope<T>> {
  const response = await fetch(path, { credentials: "include", ...init });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      payload !== null && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
    throw new Error(detail);
  }

  if (isEnvelope(payload)) {
    return payload as PyEnvelope<T>;
  }

  // Defensive: accept bare arrays/objects from endpoints that skip the envelope.
  return {
    ok: true,
    feature: path,
    source: "adapter-fallback",
    student_module: null,
    student_result: null,
    data: payload as T,
  };
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return "—";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
