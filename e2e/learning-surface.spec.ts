import { expect, test, type Page, type Route } from "@playwright/test";

const signedInUser = {
  id: 1,
  name: "Classroom Mentor",
  email: "mentor@classroom.example.edu",
  role: "mentor",
  districtId: 1,
  districtName: "Classroom North",
  bio: "",
  subjects: ["Math"],
  isVerified: false,
  createdAt: "2026-09-09T00:00:00Z",
};

const district = {
  id: 1,
  name: "Classroom North",
  county: "Santa Clara",
  type: "high_school",
  memberCount: 12,
  openRequestCount: 1,
};

const tag = { id: 1, name: "Math", color: "#2563eb", requestCount: 1 };

const request = {
  id: 11,
  authorId: 2,
  authorName: "Learning Partner",
  authorRole: "mentee",
  districtId: 1,
  districtName: "Classroom North",
  title: "Calculus study session",
  description: "Practice derivatives together.",
  tags: [tag],
  status: "open",
  matchedUserId: null,
  matchedUserName: null,
  createdAt: "2026-09-09T01:00:00Z",
  preferredTimes: ["Mon 17:00"],
};

const matchedRequest = {
  ...request,
  status: "matched",
  matchedUserId: signedInUser.id,
  matchedUserName: signedInUser.name,
};

const memberLinkNames = [
  "Dashboard",
  "Districts",
  "Requests",
  "New Request",
  "Matches",
  "Practice",
  "Analytics",
  "Scheduling",
  "Reports",
  "Profile",
  "Settings",
] as const;

const pythonEnvelope = (feature: string, data: unknown) => ({
  ok: true,
  success: true,
  feature,
  source: "student-module",
  student_module: {
    module: feature,
    importable: true,
    called: true,
    status: "connected",
    error: null,
    available_functions: ["run"],
  },
  student_result: null,
  error: null,
  data,
});

const fixtures: Record<string, unknown> = {
  "/api/auth/me": signedInUser,
  "/api/districts": [district],
  "/api/tags": [tag],
  "/api/requests": [request],
  "/api/requests/11": request,
  "/api/stats/overview": {
    totalUsers: 12,
    totalMentors: 6,
    totalMentees: 6,
    totalDistricts: 1,
    openRequests: 1,
    successfulMatches: 3,
    topTags: [tag],
  },
  "/api/practice/status": {
    success: true,
    status: "connected",
    engines: {},
  },
  "/api/practice/locations/status": {
    success: true,
    status: "connected",
    message: "Location module loaded.",
    available_functions: ["find_nearby"],
  },
  "/api/practice/blocks/status": {
    success: true,
    status: "connected",
    message: "Block module loaded.",
    service_available: true,
    blocked_users_excluded: true,
  },
  "/api/practice/matching/1": {
    success: true,
    status: "connected",
    message: "Matching module loaded.",
    question_id: 1,
    student_id: 1,
    student_name: "Classroom Mentor",
    requested_subject: "Math",
    requested_topic: "Derivatives",
    limit: 5,
    matches: [],
  },
  "/api/analysis/status": pythonEnvelope("analysis", null),
  "/api/analytics/weekly-matches": pythonEnvelope("analysis", [
    { week: "Sep 7", matches: 3 },
  ]),
  "/api/analytics/popular-subjects": pythonEnvelope("analysis", [
    { subject: "Math", requests: 4, color: "#2563eb" },
  ]),
  "/api/analytics/popular-time-slots": pythonEnvelope("scheduling", [
    { slot: "Mon 17:00", count: 2 },
  ]),
  "/api/analytics/mentor-response-rates": pythonEnvelope("analysis", [
    {
      mentorId: 1,
      mentorName: "Classroom Mentor",
      responseRate: 1,
      totalRequests: 2,
      avgResponseHours: 1.5,
    },
  ]),
  "/api/scheduling/status": pythonEnvelope("scheduling", null),
  "/api/scheduling/overview": pythonEnvelope("scheduling", {
    topSlots: [{ slot: "Mon 17:00", count: 2 }],
  }),
  "/api/admin/flagged-users": pythonEnvelope("reports", [
    {
      userId: 7,
      name: "Reported Learner",
      reportCount: 2,
      blockCount: 1,
      status: "review",
      lastReportedAt: "2026-09-09T02:00:00Z",
      topReasons: ["spam"],
    },
  ]),
  "/api/python-reports/summary": pythonEnvelope("reports", {
    today: 1,
    thisMonth: 4,
    thisYear: 20,
    total: 40,
  }),
  "/api/users/7": {
    id: 7,
    name: "Reported Learner",
    subjects: ["Biology"],
    createdAt: "2026-01-15T00:00:00Z",
  },
};

async function interceptApi(
  page: Page,
  options: { anonymous?: boolean; failures?: Set<string> } = {},
) {
  const unknownRequests: string[] = [];
  await page.route("**/api/**", async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();

    if (pathname === "/api/auth/me" && options.anonymous) {
      await route.fulfill({
        status: 401,
        json: { error: "unauthorized" },
      });
      return;
    }

    if (options.failures?.has(pathname)) {
      await route.fulfill({
        status: 503,
        json: { error: "backend_error" },
      });
      return;
    }

    const fixture =
      method === "POST" && pathname === "/api/requests/11/match"
        ? matchedRequest
        : method === "GET"
          ? fixtures[pathname]
          : undefined;
    if (fixture === undefined) {
      unknownRequests.push(`${method} ${pathname}`);
      await route.abort("blockedbyclient");
      return;
    }

    await route.fulfill({ json: fixture });
  });
  return unknownRequests;
}

test("register loads public district choices from the production bundle", async ({ page }) => {
  const unknownRequests = await interceptApi(page, { anonymous: true });

  await page.goto("/register");

  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Classroom North/ })).toBeVisible();
  await expect(page.getByText(/This feature is unavailable/)).toHaveCount(0);
  expect(unknownRequests).toEqual([]);
});

test("all named learning routes render their real page", async ({ page }) => {
  const unknownRequests = await interceptApi(page);
  const routes = [
    ["dashboard", "/dashboard", "Welcome back, Classroom"],
    ["districts", "/districts", "High School District Channels"],
    ["requests", "/requests", "Browse Mentorship Requests"],
    ["new request", "/requests/new", "Post a mentorship request"],
    ["matches", "/recommendations", "Question ID"],
    ["practice", "/practice-lab", "Python Practice Lab"],
    ["analytics", "/analytics", "Mentor Analytics"],
    ["scheduling", "/scheduling", "Scheduling"],
    ["reports", "/admin/reports", "Learning Reports"],
  ] as const;

  for (const [name, path, visibleText] of routes) {
    await test.step(name, async () => {
      await page.goto(path);
      await expect(page.getByText(visibleText, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/This feature is unavailable/)).toHaveCount(0);
    });
  }

  expect(unknownRequests).toEqual([]);
});

test("mobile menu exposes every signed-in destination and chat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unknownRequests = await interceptApi(page);

  await page.goto("/dashboard");
  await page.getByText("Menu", { exact: true }).click();

  for (const name of memberLinkNames) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
  expect(unknownRequests).toEqual([]);
});

test("desktop navigation exposes every signed-in destination", async ({ page }) => {
  const unknownRequests = await interceptApi(page);

  await page.goto("/dashboard");

  const navigation = page.getByRole("navigation");
  for (const name of memberLinkNames) {
    await expect(navigation.getByRole("link", { name, exact: true })).toBeVisible();
  }
  expect(unknownRequests).toEqual([]);
});

test("request detail Connect completes through the production control", async ({ page }) => {
  const unknownRequests = await interceptApi(page);

  await page.goto("/requests/11");
  await expect(page.getByRole("heading", { name: "Calculus study session" })).toBeVisible();
  const connectRequest = page.waitForRequest((request) => {
    const { pathname } = new URL(request.url());
    return request.method() === "POST" && pathname === "/api/requests/11/match";
  });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await connectRequest;

  await expect(page.getByRole("heading", { name: "You're connected!" })).toBeVisible();
  await expect(
    page.getByText("Minimum member profiles include names, subjects, and join dates.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(unknownRequests).toEqual([]);
});

test("reports and member profile show only their minimum public fields", async ({ page }) => {
  const unknownRequests = await interceptApi(page);

  await page.goto("/admin/reports");
  for (const column of ["Name", "Reports", "Blocks", "Status"]) {
    await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Reported Learner" })).toBeVisible();
  await expect(page.getByText("mentor@classroom.example.edu")).toHaveCount(0);

  await page.goto("/profile/7");
  await expect(page.getByRole("heading", { name: "Reported Learner" })).toBeVisible();
  await expect(page.getByText("Biology", { exact: true })).toBeVisible();
  await expect(page.getByText("Joined January 2026", { exact: true })).toBeVisible();
  await expect(page.getByText(/@/)).toHaveCount(0);
  expect(unknownRequests).toEqual([]);
});

test("failed report fixtures keep the page and retryable learning states visible", async ({ page }) => {
  const failures = new Set([
    "/api/admin/flagged-users",
    "/api/python-reports/summary",
  ]);
  const unknownRequests = await interceptApi(page, { failures });

  await page.goto("/admin/reports");

  await expect(page.getByRole("heading", { name: "Learning Reports" })).toBeVisible();
  const signupSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Signup summary" }),
  });
  await expect(signupSection.getByText("HTTP 503", { exact: true })).toBeVisible();
  await expect(signupSection.getByRole("button", { name: "Retry signup summary" })).toBeVisible();
  const flaggedSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Flagged users" }),
  });
  await expect(flaggedSection.getByText("HTTP 503", { exact: true })).toBeVisible();
  await expect(flaggedSection.getByRole("button", { name: "Retry flagged users" })).toBeVisible();
  expect(unknownRequests).toEqual([]);
});
