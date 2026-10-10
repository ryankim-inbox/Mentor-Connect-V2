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
  descriptionTruncated: false,
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
    message: "Python practice API is running. Individual engine statuses are listed below.",
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
    matches: [{
      rank: 1,
      mentor_id: 3,
      mentor_name: "Calculus Mentor",
      score: 95,
      reason: "Shared Math subject and Monday availability.",
      matched_subjects: ["Math"],
      district: "Classroom North",
      availability: "Mon 17:00",
      language: "English",
      teaching_style: "Guided practice",
    }],
  },
  "/api/analysis/status": pythonEnvelope("analysis", null),
  "/api/analytics/weekly-matches": pythonEnvelope("analysis", [
    { week: "2026-08-31", matches: null, coverage: "untracked" },
    { week: "2026-09-07", matches: 3, coverage: "partial" },
  ]),
  "/api/analytics/popular-subjects": pythonEnvelope("analysis", [
    { subject: "Math", requests: 4, color: "#2563eb" },
  ]),
  "/api/analytics/popular-time-slots": pythonEnvelope("scheduling", [
    { slot: "Mon 17:00", count: 2 },
  ]),
  "/api/analytics/mentor-response-rates": pythonEnvelope("analysis", {
    trackingStartedAt: "2026-09-09T00:00:00Z",
    mentors: [
      { mentorId: 1, mentorName: "Classroom Mentor", totalMatches: 2, avgTimeToMatchHours: 1.5 },
      { mentorId: 2, mentorName: "New Mentor", totalMatches: 0, avgTimeToMatchHours: null },
      { mentorId: 3, mentorName: "Unknown Duration Mentor", totalMatches: 1, avgTimeToMatchHours: null },
    ],
  }),
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
  let currentRequest = request;
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

    if (method === "POST" && pathname === "/api/requests/11/match") currentRequest = matchedRequest;

    const fixture =
      method === "POST" && pathname === "/api/requests/11/match"
        ? matchedRequest
        : method === "GET"
          ? pathname === "/api/requests/11" ? currentRequest : fixtures[pathname]
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

test("Practice renders successful statuses after all status responses complete", async ({ page }) => {
  const unknownRequests = await interceptApi(page);
  const responses = Promise.all([
    "/api/practice/status", "/api/practice/locations/status", "/api/practice/blocks/status",
  ].map(path => page.waitForResponse(response => new URL(response.url()).pathname === path)));
  await page.goto("/practice-lab");
  await responses;
  for (const [heading, message] of [
    ["Location Engine Test", "Location module loaded."],
    ["Block / Report Engine Test", "Block module loaded."],
  ]) {
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
    await expect(section.getByText("connected", { exact: true })).toBeVisible();
    await expect(section.getByText(message, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
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

  await expect(page.getByRole("heading", { name: "This request has been matched" })).toBeVisible();
  await expect(
    page.getByText("Minimum member profiles include names, subjects, and join dates.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(unknownRequests).toEqual([]);
});

test("recommendation action navigates to browse requests", async ({ page }) => {
  const unknownRequests = await interceptApi(page);

  await page.goto("/recommendations");
  await expect(page.getByText("Calculus Mentor", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse requests", exact: true })).toHaveAttribute("href", "/requests");
  await expect(page.getByRole("button", { name: "Request match", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Browse requests", exact: true }).click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole("heading", { name: "Browse Mentorship Requests" })).toBeVisible();
  expect(unknownRequests).toEqual([]);
});

test("dashboard shows matching stats and opens its available practice tab", async ({ page }) => {
  const unknownRequests = await interceptApi(page);

  await page.goto("/dashboard");
  await expect(page.getByText("Successful matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Python Practice Lab", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/practice-lab$/);
  await expect(page.getByRole("heading", { name: "Python Practice Lab", exact: true })).toBeVisible();
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
  await expect(signupSection.getByText("We had a connection problem. Please try again.", { exact: true })).toBeVisible();
  await expect(signupSection.getByRole("button", { name: "Retry signup summary" })).toBeVisible();
  const flaggedSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Flagged users" }),
  });
  await expect(flaggedSection.getByText("We had a connection problem. Please try again.", { exact: true })).toBeVisible();
  await expect(flaggedSection.getByRole("button", { name: "Retry flagged users" })).toBeVisible();
  expect(unknownRequests).toEqual([]);
});

test("request browsing pages older and newer, resets filters, and discloses previews", async ({ page }) => {
  await interceptApi(page);
  const calls: URL[] = [];
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    ...request, id: 100 - index, title: `Page request ${100 - index}`, descriptionTruncated: index === 0,
  }));
  await page.route("**/api/requests?*", async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    await route.fulfill({ json: url.searchParams.has("before")
      ? [{ ...request, id: 50, title: "Older request", descriptionTruncated: false }]
      : firstPage });
  });
  await page.goto("/requests");
  await expect(page.getByText("50 requests shown", { exact: true })).toBeVisible();
  await expect(page.getByText("Preview — open request for full description", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Newer requests", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Older requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Older request", exact: true })).toBeVisible();
  expect(calls.at(-1)?.searchParams.get("before")).toBe(`${request.createdAt}|51`);
  await expect(page.getByRole("button", { name: "Older requests", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Newer requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Page request 100", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Older requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Older request", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Offering mentorship", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Page request 100", exact: true })).toBeVisible();
  expect(calls.at(-1)?.searchParams.has("before")).toBe(false);
  expect(calls.at(-1)?.searchParams.get("role")).toBe("mentor");
  await expect(page.getByRole("button", { name: "Newer requests", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Older requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Older request", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Page request 100", exact: true })).toBeVisible();
  expect(calls.at(-1)?.searchParams.has("before")).toBe(false);
  expect(calls.at(-1)?.searchParams.get("tagId")).toBe("1");

  await page.route("**/api/districts/1", (route) => route.fulfill({ json: district }));
  await page.route("**/api/stats/district/1", (route) => route.fulfill({ json: {
    districtId: 1, districtName: district.name, memberCount: 12, mentorCount: 6,
    menteeCount: 6, openRequests: 51, successfulMatches: 3, topTags: [tag],
  } }));
  await page.goto("/districts/1");
  await expect(page.getByRole("heading", { name: "Open requests (50 shown)", exact: true })).toBeVisible();
  expect(calls.at(-1)?.searchParams.get("districtId")).toBe("1");
  await page.getByRole("button", { name: "Older requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Older request", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Newer requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Page request 100", exact: true })).toBeVisible();
});

test("request creation validates UTF-8 byte lengths before sending", async ({ page }) => {
  await interceptApi(page);
  await page.goto("/requests/new");
  const title = page.getByPlaceholder("e.g. Need help with AP Calculus BC");
  const description = page.getByPlaceholder("Describe what you're looking for, your background, and your goals...");
  await title.fill("é".repeat(100) + "a");
  await description.fill("Description");
  await page.getByRole("button", { name: "Post request", exact: true }).click();
  await expect(page.getByText("Title must contain text and be at most 200 UTF-8 bytes.", { exact: true })).toBeVisible();
  await title.fill("Valid title");
  await description.fill("🦉".repeat(1000) + "a");
  await page.getByRole("button", { name: "Post request", exact: true }).click();
  await expect(page.getByText("Description must contain text and be at most 4,000 UTF-8 bytes.", { exact: true })).toBeVisible();
});


test("analytics discloses observed coverage and creation-to-match duration", async ({ page }) => {
  const unknownRequests = await interceptApi(page);
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Mentor matching activity", exact: true })).toBeVisible();
  await expect(page.getByText("Average time from request creation to match", { exact: true })).toBeVisible();
  await expect(page.getByText(/Only activity observed after tracking started/)).toBeVisible();
  await expect(page.getByText("Untracked", { exact: true })).toBeVisible();
  await expect(page.getByText("Partial", { exact: true })).toBeVisible();
  await expect(page.getByText(/Week-to-date/)).toBeVisible();
  await expect(page.getByText("No observed matches", { exact: true })).toBeVisible();
  await expect(page.getByText("No valid time-to-match data", { exact: true })).toBeVisible();
  await expect(page.getByText("1.5 hours", { exact: true })).toBeVisible();
  await expect(page.getByText(/avg reply|Mentor response rates|100%/)).toHaveCount(0);
  expect(unknownRequests).toEqual([]);
});


test("scheduling shows weekly availability and successful overlapping or disjoint suggestions", async ({ page }) => {
  const unknownRequests = await interceptApi(page);
  const calls: URL[] = [];
  await page.route("**/api/scheduling/suggest?*", async route => {
    const url = new URL(route.request().url());
    calls.push(url);
    const disjoint = url.searchParams.get("user_b") === "3";
    await route.fulfill({ json: pythonEnvelope("scheduling", {
      userA: { id: 1, name: "Classroom Mentor", role: "mentor", available_times: ["Mon 17:00", "Wed 19:00"] },
      userB: { id: disjoint ? 3 : 2, name: "Learning Partner", role: "mentee", available_times: disjoint ? ["Fri 12:00"] : ["Wed 19:00", "Mon 17:00"] },
      overlap: disjoint ? [] : ["Mon 17:00", "Wed 19:00"],
    }) });
  });
  await page.goto("/scheduling");
  const overview = page.locator("section").filter({ has: page.getByRole("heading", { name: "Availability overview", exact: true }) });
  await expect(overview.getByText("Mon 17:00", { exact: true })).toBeVisible();
  await expect(overview.getByText("2", { exact: true })).toBeVisible();
  await page.getByLabel("User A id").fill("1");
  await page.getByLabel("User B id").fill("2");
  await page.getByRole("button", { name: "Suggest times", exact: true }).click();
  await expect(page.getByText("Overlapping times (2)", { exact: true })).toBeVisible();
  const overlap = page.locator("div.rounded-xl").filter({ has: page.getByText("Overlapping times (2)", { exact: true }) });
  await expect(overlap.getByText("Mon 17:00", { exact: true })).toBeVisible();
  await expect(overlap.getByText("Wed 19:00", { exact: true })).toBeVisible();
  await page.getByLabel("User B id").fill("3");
  await page.getByRole("button", { name: "Suggest times", exact: true }).click();
  await expect(page.getByText("Overlapping times (0)", { exact: true })).toBeVisible();
  await expect(page.getByText("No overlapping availability found.", { exact: true })).toBeVisible();
  expect(calls.map(url => [url.searchParams.get("user_a"), url.searchParams.get("user_b")])).toEqual([["1", "2"], ["1", "3"]]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(unknownRequests).toEqual([]);
});
