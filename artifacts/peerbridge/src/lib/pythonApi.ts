import { customFetch } from "@workspace/api-client-react";

// Small fetch helper for the non-quarantined Python adapter endpoints.
//
// Those endpoints wrap the student practice files in Python/ and answer with
// a common envelope plus the live import/call status of the student module.
// Analytics and scheduling endpoints use source "python": their data comes
// only from the student module, and success=false carries the Python error
// with data=null instead of substitute numbers.

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
  success?: boolean;
  feature: string;
  source: "python" | "student-module" | "adapter-fallback";
  student_module?: StudentModuleStatus | null;
  student_result?: unknown;
  error?: string | null;
  data: T | null;
}

function isEnvelope(payload: unknown): payload is PyEnvelope<unknown> {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "data" in payload &&
    typeof (payload as { ok?: unknown }).ok === "boolean" &&
    typeof (payload as { feature?: unknown }).feature === "string" &&
    ["python", "student-module", "adapter-fallback"].includes(
      String((payload as { source?: unknown }).source),
    ) &&
    (!("success" in payload) ||
      typeof (payload as { success?: unknown }).success === "boolean")
  );
}

export async function getPythonApi<T>(path: string, init?: RequestInit): Promise<PyEnvelope<T>> {
  const payload = await customFetch<unknown>(path, {
    ...init,
    responseType: "json",
    credentials: "include",
  });

  if (isEnvelope(payload)) {
    return payload as PyEnvelope<T>;
  }
  throw new TypeError("Unexpected Python API response");
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
