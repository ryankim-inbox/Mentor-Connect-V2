export type PublicRoute = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  template: string;
  family: string;
  authentication: "none" | "cookie" | "session";
  allowsBody: boolean;
  requiresJson: boolean;
  queryKeys: readonly string[];
};

export type PublicRouteMatch = PublicRoute & {
  upstreamPath: string;
  resourceId?: number;
};

const noQuery: readonly string[] = Object.freeze([]);

export const publicRoutes: readonly PublicRoute[] = Object.freeze([
  {
    method: "POST",
    template: "/api/auth/register",
    family: "auth",
    authentication: "none",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/auth/login",
    family: "auth",
    authentication: "none",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/auth/logout",
    family: "auth",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/auth/me",
    family: "auth",
    authentication: "cookie",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/users/{id}",
    family: "users",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "PATCH",
    template: "/api/users/{id}",
    family: "users",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/districts",
    family: "districts",
    authentication: "none",
    allowsBody: false,
    requiresJson: false,
    queryKeys: ["type", "search"],
  },
  {
    method: "GET",
    template: "/api/districts/{id}",
    family: "districts",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/tags",
    family: "tags",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/requests",
    family: "requests",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: ["districtId", "role", "status", "tagId"],
  },
  {
    method: "POST",
    template: "/api/requests",
    family: "requests",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/requests/{id}",
    family: "requests",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "PATCH",
    template: "/api/requests/{id}",
    family: "requests",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "DELETE",
    template: "/api/requests/{id}",
    family: "requests",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/requests/{id}/match",
    family: "requests",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/reports",
    family: "reports",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/blocks",
    family: "blocks",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/blocks",
    family: "blocks",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "DELETE",
    template: "/api/blocks/{id}",
    family: "blocks",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/stats/overview",
    family: "stats",
    authentication: "none",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/stats/district/{id}",
    family: "stats",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/matches/{questionId}",
    family: "matches",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: ["limit"],
  },
  {
    method: "POST",
    template: "/api/matches",
    family: "matches",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/chat/rooms",
    family: "chat",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/chat/rooms/{id}/messages",
    family: "chat",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/chat/rooms/{id}/messages",
    family: "chat",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/dms",
    family: "dms",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/dms/start",
    family: "dms",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/dms/{id}/messages",
    family: "dms",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/dms/{id}/messages",
    family: "dms",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/practice/status",
    family: "practice",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/practice/matching/{questionId}",
    family: "practice",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: ["limit"],
  },
  {
    method: "GET",
    template: "/api/practice/locations/status",
    family: "practice",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "POST",
    template: "/api/practice/locations/test",
    family: "practice",
    authentication: "session",
    allowsBody: true,
    requiresJson: true,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/practice/blocks/status",
    family: "practice",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/practice/raw/{moduleName}",
    family: "practice",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/analysis/status",
    family: "analysis",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/analytics/weekly-matches",
    family: "analytics",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/analytics/popular-subjects",
    family: "analytics",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/analytics/popular-time-slots",
    family: "analytics",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/analytics/mentor-response-rates",
    family: "analytics",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/python-reports/status",
    family: "python-reports",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/python-reports/summary",
    family: "python-reports",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/scheduling/status",
    family: "scheduling",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/scheduling/overview",
    family: "scheduling",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/scheduling/suggest",
    family: "scheduling",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: ["user_a", "user_b"],
  },
  {
    method: "GET",
    template: "/api/admin/flagged-users",
    family: "admin",
    authentication: "session",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
  {
    method: "GET",
    template: "/api/healthz",
    family: "health",
    authentication: "none",
    allowsBody: false,
    requiresJson: false,
    queryKeys: noQuery,
  },
]);

const moduleNames = new Set(["find_matches", "locations", "get_blocks"]);

function matchPath(
  template: string,
  pathname: string,
): number | false | undefined {
  const expected = template.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) {
    return undefined;
  }

  let resourceId: number | false = false;
  for (let index = 0; index < expected.length; index += 1) {
    const templateSegment = expected[index];
    const actualSegment = actual[index];
    if (templateSegment === "{moduleName}") {
      if (!actualSegment || !moduleNames.has(actualSegment)) {
        return undefined;
      }
    } else if (
      templateSegment?.startsWith("{") &&
      templateSegment.endsWith("}")
    ) {
      if (!actualSegment || !/^[1-9][0-9]*$/.test(actualSegment)) {
        return undefined;
      }
      const id = Number(actualSegment);
      if (!Number.isSafeInteger(id)) {
        return undefined;
      }
      resourceId = id;
    } else if (templateSegment !== actualSegment) {
      return undefined;
    }
  }
  return resourceId;
}

function invalidQuery(): never {
  throw new TypeError("invalid_query");
}

function isPositiveSafeInteger(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
}

function validateQuery(
  route: PublicRoute,
  searchParams: URLSearchParams,
): void {
  const keys = [...searchParams.keys()];
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !route.queryKeys.includes(key))
  ) {
    invalidQuery();
  }

  for (const [key, value] of searchParams) {
    if (["districtId", "tagId", "user_a", "user_b"].includes(key)) {
      if (!isPositiveSafeInteger(value)) invalidQuery();
    } else if (key === "limit") {
      if (!isPositiveSafeInteger(value) || Number(value) > 20) invalidQuery();
    } else if (key === "role") {
      if (value !== "mentor" && value !== "mentee") invalidQuery();
    } else if (key === "status") {
      if (value !== "open" && value !== "matched" && value !== "closed")
        invalidQuery();
    } else if (key === "search") {
      if (Buffer.byteLength(value, "utf8") > 200) invalidQuery();
    } else if (key === "type") {
      if (value !== "high_school" && value !== "unified") invalidQuery();
    }
  }

  if (
    route.template === "/api/scheduling/suggest" &&
    (!searchParams.has("user_a") || !searchParams.has("user_b"))
  ) {
    invalidQuery();
  }
}

export function resolvePublicRoute(
  method: string,
  target: string,
): PublicRouteMatch | undefined {
  const queryIndex = target.indexOf("?");
  const pathname = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? "" : target.slice(queryIndex + 1);

  if (
    target.includes("#") ||
    pathname.includes("%") ||
    pathname.includes("\\") ||
    pathname.includes("//")
  ) {
    return undefined;
  }
  try {
    decodeURIComponent(rawQuery);
  } catch {
    invalidQuery();
  }

  const normalizedMethod = method.toUpperCase();
  for (const route of publicRoutes) {
    if (route.method !== normalizedMethod) continue;
    const resourceId = matchPath(route.template, pathname);
    if (resourceId === undefined) continue;

    const searchParams = new URLSearchParams(rawQuery);
    validateQuery(route, searchParams);
    return {
      ...route,
      upstreamPath:
        pathname + (searchParams.size ? `?${searchParams.toString()}` : ""),
      ...(resourceId === false ? {} : { resourceId }),
    };
  }
  return undefined;
}
