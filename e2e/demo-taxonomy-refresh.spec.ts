import { test, expect, type Page } from "@playwright/test";
import {
  fixtures,
  signedInUser,
  request as post,
  pythonEnvelope,
} from "./fixtures";

const districts = [
  {
    id: 1,
    name: "Classroom North",
    county: "Practice County",
    type: "high_school",
    memberCount: 497,
    openRequestCount: 235,
  },
  {
    id: 2,
    name: "Fremont Unified School District",
    county: "Alameda",
    type: "unified",
    memberCount: 1234,
    openRequestCount: 82,
  },
  {
    id: 3,
    name: "Sunnyvale School District",
    county: "Santa Clara",
    type: "elementary",
    memberCount: 12,
    openRequestCount: 3,
  },
  {
    id: 4,
    name: "Coastal Unified School District",
    county: "San Mateo",
    type: "unified",
    memberCount: 9,
    openRequestCount: 0,
  },
];
const demoProfile = {
  id: 2,
  name: "Maya Chen",
  role: "mentor",
  districtId: 1,
  districtName: "Classroom North",
  subjects: ["Math"],
  bio: "I enjoy finding a second way to explain a tricky idea.",
  createdAt: signedInUser.createdAt,
  isDemo: true,
};

async function setup(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let body: unknown =
      {
        ...fixtures,
        "/api/auth/me": { ...signedInUser, isDemo: false },
        "/api/districts": districts,
        "/api/districts/1": districts[0],
        "/api/users/2": demoProfile,
        "/api/mentors": [demoProfile],
        ...overrides,
      }[url.pathname] ?? [];
    if (url.pathname === "/api/districts" && !(url.pathname in overrides)) {
      const search = url.searchParams.get("search")?.toLowerCase();
      const type = url.searchParams.get("type");
      body = districts.filter(
        (d) =>
          (!search || d.name.toLowerCase().includes(search)) &&
          (!type || d.type === type),
      );
    }
    return route.fulfill({ json: body });
  });
  await page.routeWebSocket(/.*/, (socket) => socket.close());
}

test("all district types and all county groups are visible without searching", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/districts");
  await expect(
    page.getByRole("heading", {
      name: "School District Channels",
      exact: true,
    }),
  ).toBeVisible();
  for (const county of [
    "Practice County",
    "Alameda County",
    "Santa Clara County",
    "San Mateo County",
  ])
    await expect(
      page.getByRole("heading", { name: county, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByText("Practice County County", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Classroom North/ }),
  ).toContainText("High school");
  await expect(
    page.getByRole("link", { name: /Fremont Unified/ }),
  ).toContainText("Unified");
  await expect(
    page.getByRole("link", { name: /Sunnyvale School/ }),
  ).toContainText("TK–8");
  await expect(page.getByLabel("District type")).toHaveValue("all");
});

test("district search and optional type filter preserve county grouping", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/districts");
  await page.getByLabel("District type").selectOption("unified");
  await expect(page.getByRole("link", { name: /Classroom North/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: /Fremont Unified/ }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search districts" })
    .fill("Coastal");
  await expect(
    page.getByRole("heading", { name: "San Mateo County" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Fremont Unified/ })).toHaveCount(
    0,
  );
  await page.getByRole("searchbox", { name: "Search districts" }).clear();
  await page.getByLabel("District type").selectOption("elementary");
  await expect(
    page.getByRole("link", { name: /Sunnyvale School/ }),
  ).toBeVisible();
  await page.getByLabel("District type").selectOption("all");
  await expect(
    page.getByRole("heading", { name: "Practice County" }),
  ).toBeVisible();
});

test("district loading has an accessible status", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/districts**", async (route) => {
    await pending;
    await route.fulfill({ json: districts });
  });
  try {
    await page.goto("/districts");
    await expect(page.getByRole("status")).toContainText("Loading districts");
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "Practice County" }),
  ).toBeVisible();
});

test("district failure offers retry and keeps the current search", async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  await page.route("**/api/districts**", (route) =>
    route.fulfill(fail ? { status: 503, json: {} } : { json: [districts[0]] }),
  );
  await page.goto("/districts");
  await expect(page.getByRole("alert")).toContainText(
    "Couldn't load school districts",
  );
  await page
    .getByRole("searchbox", { name: "Search districts" })
    .fill("Classroom");
  await expect(
    page.getByRole("button", { name: "Retry districts" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry districts" }).click();
  await expect(
    page.getByRole("heading", { name: "Practice County" }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search districts" }),
  ).toHaveValue("Classroom");
});

test("district empty catalog is distinct from no filter matches", async ({
  page,
}) => {
  await setup(page, { "/api/districts": [] });
  await page.goto("/districts");
  await expect(
    page.getByText("No school districts are available.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search districts" })
    .fill("Missing");
  await expect(
    page.getByText("No districts match your filters.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(
    page.getByText("No school districts are available.", { exact: true }),
  ).toBeVisible();
});

test("district detail and selection forms use accurate county and type labels", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/districts/1");
  await expect(
    page.getByText("Practice County · High school", { exact: true }),
  ).toBeVisible();
  await page.goto("/requests/new");
  await expect(
    page.getByRole("option", {
      name: "Sunnyvale School District (Santa Clara County · TK–8)",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("option", {
      name: "Classroom North (Practice County · High school)",
      exact: true,
    }),
  ).toHaveCount(1);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/register");
  await expect(
    page.getByRole("option", {
      name: "Fremont Unified School District (Alameda County · Unified)",
      exact: true,
    }),
  ).toHaveCount(1);
});

for (const legacy of [false, true]) {
  test(`server-marked ${legacy ? "legacy" : "natural"} demo posts are disclosed in cards and detail`, async ({
    page,
  }) => {
    const demoPost = {
      ...post,
      isDemo: true,
      authorName: legacy ? "Synthetic Learner 0042" : "Maya Chen",
      title: legacy
        ? "[Synthetic] Math question 0042"
        : "Why does this derivative change sign?",
    };
    await setup(page, {
      "/api/requests": [demoPost],
      "/api/requests/11": demoPost,
    });
    await page.goto("/requests");
    const card = page.getByRole("link", {
      name: new RegExp(demoPost.title.replace(/[\[\]?]/g, "\\$&")),
    });
    await expect(card.getByText("Demo post", { exact: true })).toBeVisible();
    await expect(card).toContainText(
      "Fictional content for exploring Mentor Connect.",
    );
    await card.click();
    await expect(page.getByText("Demo post", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Fictional content for exploring Mentor Connect.", {
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("real posts and profiles are not classified from names or synthetic-looking prose", async ({
  page,
}) => {
  const real = {
    ...post,
    isDemo: false,
    title: "[Synthetic] biology study plan",
    authorName: "Synthetic Learner 0042",
  };
  await setup(page, {
    "/api/requests": [real],
    "/api/requests/11": real,
    "/api/users/2": {
      ...demoProfile,
      name: "Synthetic Learner 0042",
      isDemo: false,
    },
    "/api/mentors": [{ ...demoProfile, isDemo: false }],
  });
  for (const path of [
    "/requests",
    "/requests/11",
    "/profile/2",
    "/mentors",
    "/profile",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page.getByText(/^Demo (post|profile)$/)).toHaveCount(0);
  }
});

for (const name of ["Maya Chen", "Synthetic Mentor 0042"]) {
  test(`demo profile and mentor card disclose ${name}`, async ({ page }) => {
    await setup(page, {
      "/api/users/2": { ...demoProfile, name },
      "/api/mentors": [{ ...demoProfile, name }],
    });
    for (const path of ["/profile/2", "/mentors"]) {
      await page.goto(path);
      await expect(
        page.getByText("Demo profile", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Fictional profile for exploring Mentor Connect.", {
          exact: true,
        }),
      ).toBeVisible();
    }
  });
}

test("chat names the existing district room accurately", async ({ page }) => {
  await setup(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Open chat" }).click();
  await expect(
    page.getByRole("tab", { name: "My District", exact: true }),
  ).toBeVisible();
});

test("discussion and application names retain their own server demo markers", async ({
  page,
}) => {
  await setup(page, {
    "/api/requests/11": { ...post, authorId: signedInUser.id, isDemo: false },
    "/api/requests/11/applications": [
      {
        id: 7,
        applicantId: 2,
        applicantName: "Maya Chen",
        isDemo: true,
        status: "pending",
        createdAt: post.createdAt,
      },
    ],
    "/api/requests/11/comments": [
      {
        id: 3,
        requestId: 11,
        authorId: 2,
        authorName: "Maya Chen",
        isDemo: true,
        body: "Try sketching the slope first.",
        parentId: 1,
        parentAuthorName: "Jordan Lee",
        parentAuthorIsDemo: true,
        createdAt: post.createdAt,
        updatedAt: null,
        deletedAt: null,
      },
    ],
  });
  await page.goto("/requests/11");
  await expect(
    page
      .getByRole("region", { name: "Connection applications" })
      .getByText("Demo profile", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Discussion" })
      .getByText("Demo profile", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText("Demo post", { exact: true })).toHaveCount(0);
});

test("connections and request activity disclose their respective demo records", async ({
  page,
}) => {
  await setup(page, {
    "/api/connections": [
      {
        userId: 2,
        name: "Maya Chen",
        isDemo: true,
        requestId: 11,
        requestTitle: post.title,
      },
    ],
    "/api/request-activity": [{ ...post, isDemo: true }],
  });
  await page.goto("/connections");
  await expect(page.getByText("Demo profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo post", { exact: true })).toBeVisible();
});

test("matched partner disclosure uses the partner flag independently from the post", async ({
  page,
}) => {
  await setup(page, {
    "/api/requests/11": {
      ...post,
      authorId: signedInUser.id,
      isDemo: false,
      status: "matched",
      matchedUserId: 2,
      matchedUserName: "Maya Chen",
      matchedUserIsDemo: true,
    },
  });
  await page.goto("/requests/11");
  await expect(
    page.getByRole("button", { name: "Message Maya Chen" }),
  ).toBeVisible();
  await expect(page.getByText("Demo profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo post", { exact: true })).toHaveCount(0);
});

test("blocked member names keep their demo marker", async ({ page }) => {
  await setup(page, {
    "/api/blocks": [
      {
        id: 1,
        blockerId: signedInUser.id,
        blockedUserId: 2,
        blockedUserName: "Maya Chen",
        isDemo: true,
        createdAt: post.createdAt,
      },
    ],
  });
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "Unblock Maya Chen" }),
  ).toBeVisible();
  await expect(page.getByText("Demo profile", { exact: true })).toBeVisible();
});

test("all twenty subject filters are usable including the final interest", async ({
  page,
}) => {
  const tags = [
    "Math",
    "Science",
    "English",
    "History",
    "Computer Science",
    "College Prep",
    "SAT/ACT",
    "AP Courses",
    "Spanish",
    "Arts",
    "Music",
    "Sports",
    "Mental Health",
    "Career Guidance",
    "Engineering",
    "Biology",
    "Chemistry",
    "Physics",
    "Writing",
    "Research",
  ].map((name, i) => ({ id: i + 1, name, color: "#2563eb", requestCount: 1 }));
  await setup(page, { "/api/tags": tags });
  await page.route("**/api/requests?*", (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get("tagId") === "20"
          ? [
              {
                ...post,
                title: "How should I compare these research sources?",
                tags: [tags[19]],
              },
            ]
          : [],
    }),
  );
  await page.goto("/requests");
  await expect(
    page.getByRole("button", { name: "Research", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "How should I compare these research sources?",
      exact: true,
    }),
  ).toBeVisible();
});

test("scheduling cards label only server-marked demo profiles", async ({
  page,
}) => {
  await setup(page, {
    "/api/auth/me": { ...signedInUser, isAdmin: true, isDemo: false },
    "/api/scheduling/suggest": pythonEnvelope("scheduling", {
      userA: {
        id: 2,
        name: "Maya Chen",
        isDemo: true,
        role: "mentor",
        available_times: ["Mon 17:00"],
      },
      userB: {
        id: 3,
        name: "Synthetic Learner 0042",
        isDemo: false,
        role: "mentee",
        available_times: ["Mon 17:00"],
      },
      overlap: ["Mon 17:00"],
    }),
  });
  await page.goto("/scheduling");
  await page.getByLabel("User A id").fill("2");
  await page.getByLabel("User B id").fill("3");
  await page
    .getByRole("button", { name: "Suggest times", exact: true })
    .click();
  await expect(page.getByText("Maya Chen", { exact: false })).toBeVisible();
  await expect(page.getByText("Demo profile", { exact: true })).toHaveCount(1);
  await expect(
    page.getByText("Fictional profile for exploring Mentor Connect.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("analytics mentor activity carries the canonical demo marker", async ({
  page,
}) => {
  await setup(page, {
    "/api/auth/me": { ...signedInUser, isAdmin: true, isDemo: false },
    "/api/analytics/mentor-response-rates": pythonEnvelope("analysis", {
      trackingStartedAt: post.createdAt,
      mentors: [
        {
          mentorId: 2,
          mentorName: "Maya Chen",
          isDemo: true,
          totalMatches: 2,
          avgTimeToMatchHours: 1.5,
        },
        {
          mentorId: 3,
          mentorName: "Synthetic Mentor 0042",
          isDemo: false,
          totalMatches: 1,
          avgTimeToMatchHours: 2,
        },
      ],
    }),
  });
  await page.goto("/analytics");
  await expect(
    page
      .getByText("Maya Chen", { exact: true })
      .locator("..")
      .getByText("Demo profile", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Synthetic Mentor 0042", { exact: true })
      .locator("..")
      .getByText("Demo profile", { exact: true }),
  ).toHaveCount(0);
});

test("moderation keeps demo profile and post disclosures with their own report context", async ({
  page,
}) => {
  await setup(page, {
    "/api/auth/me": { ...signedInUser, isAdmin: true, isDemo: false },
    "/api/admin/flagged-users": pythonEnvelope("reports", [
      {
        userId: 2,
        name: "Maya Chen",
        isDemo: true,
        reportCount: 1,
        blockCount: 0,
        status: "review",
        lastReportedAt: post.createdAt,
        topReasons: ["spam"],
      },
    ]),
    "/api/admin/reports": [
      {
        id: 1,
        reporterId: 1,
        reporterName: "Reporter",
        reporterIsDemo: false,
        reportedUserId: 2,
        reportedUserName: "Maya Chen",
        reportedUserIsDemo: true,
        requestId: 11,
        requestTitle: post.title,
        requestIsDemo: true,
        targetType: "request",
        reason: "spam",
        description: "Please review this example.",
        status: "open",
        note: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: post.createdAt,
      },
    ],
  });
  await page.goto("/admin/reports");
  const report = page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        name: "Report #1: Maya Chen",
        exact: true,
      }),
    });
  await expect(report.getByText("Demo profile", { exact: true })).toBeVisible();
  await expect(report.getByText("Demo post", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({
        has: page.getByRole("link", { name: "Maya Chen", exact: true }),
      })
      .getByText("Demo profile", { exact: true }),
  ).toBeVisible();
});

for (const path of ["/practice-lab", "/recommendations"]) {
  test(`practice matching discloses canonical demo markers on ${path}`, async ({
    page,
  }) => {
    const match = {
      rank: 1,
      mentor_id: 2,
      mentor_name: "Maya Chen",
      isDemo: true,
      score: 95,
      reason: "Shared subject and availability.",
      matched_subjects: ["Math"],
      district: "Classroom North",
      availability: "Mon 17:00",
    };
    await setup(page, {
      "/api/auth/me": { ...signedInUser, isAdmin: true, isDemo: false },
      "/api/practice/matching/1": {
        success: true,
        status: "connected",
        message: "Matching complete.",
        is_real: true,
        question_id: 1,
        requested_topic: "Understanding derivatives",
        requested_subject: "Math",
        isDemo: true,
        studentIsDemo: true,
        matches: [
          match,
          {
            ...match,
            rank: 2,
            mentor_id: 3,
            mentor_name: "Synthetic Mentor 0042",
            isDemo: false,
          },
          {
            ...match,
            rank: 3,
            mentor_id: 4,
            mentor_name: "Jordan Lee",
            isDemo: "true",
          },
        ],
      },
    });
    await page.goto(path);
    await expect(page.getByText("Maya Chen", { exact: true })).toBeVisible();
    await expect(
      page
        .getByText("Maya Chen", { exact: true })
        .locator("..")
        .getByText("Demo profile", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText("Synthetic Mentor 0042", { exact: true })
        .locator("..")
        .getByText("Demo profile", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByText("Jordan Lee", { exact: true })
        .locator("..")
        .getByText("Demo profile", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Demo post", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Fictional content for exploring Mentor Connect.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Fictional profile for exploring Mentor Connect.", {
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("district cards and demo request metadata remain readable at 320 pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const demoPost = {
    ...post,
    isDemo: true,
    status: "matched",
    districtName: "Fremont Union High School District",
    authorName: "Alexandra Rivera",
  };
  await setup(page, {
    "/api/requests": [demoPost],
    "/api/requests/11": demoPost,
  });
  for (const path of [
    "/districts",
    "/requests",
    "/requests/11",
    "/profile/2",
    "/mentors",
  ]) {
    await page.goto(path);
    if (path === "/districts")
      await expect(
        page.getByRole("heading", { name: "Practice County" }),
      ).toBeVisible();
    else if (path.startsWith("/requests")) {
      await expect(page.getByText("Demo post", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Alexandra Rivera", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("matched", { exact: true })).toBeVisible();
    } else
      await expect(
        page.getByText("Demo profile", { exact: true }),
      ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: test.info().outputPath(`${path.replace(/\//g, "-")}-mobile.png`),
      fullPage: true,
    });
  }
});
