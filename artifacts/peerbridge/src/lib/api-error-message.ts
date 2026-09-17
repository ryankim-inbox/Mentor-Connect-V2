import { ApiError } from "@workspace/api-client-react";

const publicCodes = new Set([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation_error",
  "rate_limited",
  "upstream_timeout",
  "upstream_unavailable",
]);

function publicCode(error: ApiError): string | null {
  const data = error.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" && publicCodes.has(code) ? code : null;
}

export function apiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "We had a connection problem. Please try again.";
  }

  const code = publicCode(error);
  if (error.status === 401 || code === "unauthorized") {
    return "Please sign in to continue.";
  }
  if (error.status === 403 || code === "forbidden") {
    return "This action is unavailable for your account.";
  }
  if (error.status === 404 || code === "not_found") {
    return "The requested item was not found.";
  }
  if (error.status === 409 || code === "conflict") {
    return "This changed elsewhere. Reload the latest state and try again.";
  }
  if (error.status === 422 || code === "validation_error") {
    return "Check the input and try again.";
  }
  if (error.status === 429 || code === "rate_limited") {
    const retryAfter = error.headers.get("retry-after");
    return retryAfter && /^\d+$/.test(retryAfter)
      ? `Too many requests. Try again in ${Number(retryAfter)} seconds.`
      : "Too many requests. Try again later.";
  }
  if (
    error.status >= 500 ||
    code === "upstream_timeout" ||
    code === "upstream_unavailable"
  ) {
    return "We had a connection problem. Please try again.";
  }
  return "Something went wrong. Please try again.";
}
