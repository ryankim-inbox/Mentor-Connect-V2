import { test, expect, type Page } from "@playwright/test";
import { fixtures, signedInUser, district, request as post } from "./fixtures";

async function setup(page: Page, identity = () => signedInUser) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        path === "/api/auth/me"
          ? identity()
          : path === "/api/districts/1"
            ? district
            : (fixtures[path] ?? []),
    });
  });
}

test("administrator direct student routes and navigation are unavailable without student API reads", async ({
  page,
}) => {
  await setup(page, () => ({ ...signedInUser, isAdmin: true }));
  const studentCalls: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/(notifications|chat|dms|blocks|connections)/.test(r.url()))
      studentCalls.push(r.url());
  });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Classroom" }),
  ).toBeVisible();
  for (const name of ["Notifications", "New Request", "My connections"])
    await expect(
      page.getByRole("navigation").getByRole("link", { name, exact: true }),
    ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Post a request", exact: true }),
  ).toHaveCount(0);
  for (const path of ["/requests/new", "/notifications", "/connections"]) {
    await page.goto(path);
    await expect(
      page.getByText("Student access required", { exact: true }),
    ).toBeVisible();
  }
  expect(studentCalls).toEqual([]);
});

for (const role of ["mentor", "mentee", "both"])
  test(`${role} never requests administrator aggregates`, async ({ page }) => {
    await setup(page, () => ({ ...signedInUser, role }));
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/stats/")) calls.push(r.url());
    });
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Welcome back, Classroom" }),
    ).toBeVisible();
    await expect(
      page.getByText("Successful matches", { exact: true }),
    ).toHaveCount(0);
    await page.goto("/districts/1");
    await expect(
      page.getByRole("heading", { name: district.name, exact: true }),
    ).toBeVisible();
    expect(calls).toEqual([]);
  });

test("administrator inspects and removes content without replacing replies or participating", async ({
  page,
}) => {
  await setup(page, () => ({ ...signedInUser, isAdmin: true }));
  let removed = false;
  await page.route("**/api/requests/11/comments?*", (r) =>
    r.fulfill({
      json: [
        {
          id: 3,
          requestId: 11,
          authorId: 2,
          authorName: "Peer",
          body: removed ? "" : "Student comment",
          parentId: null,
          parentAuthorName: null,
          createdAt: signedInUser.createdAt,
          updatedAt: null,
          deletedAt: removed ? signedInUser.createdAt : null,
        },
      ],
    }),
  );
  await page.route("**/api/requests/11/comments/3", (r) => {
    expect(r.request().method()).toBe("DELETE");
    removed = true;
    return r.fulfill({ json: {} });
  });
  await page.goto("/requests/11");
  await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  await expect(
    page.getByText("Student comment", { exact: true }),
  ).toBeVisible();
  for (const name of [
    "Apply to connect",
    "Report",
    "Reply",
    "Edit comment",
    "Post comment",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await expect(
    page.getByText("Comment deleted", { exact: true }),
  ).toBeVisible();
});

test("administrator settings save name only and show no student safety actions", async ({
  page,
}) => {
  await setup(page, () => ({ ...signedInUser, isAdmin: true }));
  let sent: unknown;
  await page.route("**/api/users/1", (r) => {
    sent = r.request().postDataJSON();
    return r.fulfill({
      json: { ...signedInUser, isAdmin: true, name: "Moderator" },
    });
  });
  await page.goto("/settings");
  await expect(page.getByLabel("Bio", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/Subjects/)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Blocked members" }),
  ).toHaveCount(0);
  await page.getByLabel("Full name").fill("Moderator");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved successfully.")).toBeVisible();
  expect(sent).toEqual({ name: "Moderator" });
});

test("a student promoted during an open session loses chat, inbox and writing controls", async ({
  page,
}) => {
  let identity = { ...signedInUser };
  await setup(page, () => identity);
  await page.goto("/requests/new");
  await expect(
    page.getByRole("heading", { name: "Post a mentorship request" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
  identity = { ...identity, isAdmin: true };
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByText("Student access required", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Open notifications/ }),
  ).toHaveCount(0);
});

test("post report carries request context and member profile report does not", async ({
  page,
}) => {
  await setup(page);
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/reports", (r) => {
    sent.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, json: { message: "Report submitted" } });
  });
  await page.route("**/api/users/2", (r) =>
    r.fulfill({
      json: {
        id: 2,
        name: "Peer",
        subjects: [],
        createdAt: signedInUser.createdAt,
      },
    }),
  );
  await page.goto("/requests/11");
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(post.title);
  await page.getByLabel("Spam", { exact: true }).check();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(
    page.getByText("Report submitted", { exact: true }),
  ).toBeVisible();
  expect(sent[0]).toMatchObject({ requestId: 11, reportedUserId: 2 });
  await page.goto("/profile/2");
  await page.getByRole("button", { name: "Report member" }).click();
  await page.getByLabel("Spam", { exact: true }).check();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(
    page.getByText("Report submitted", { exact: true }),
  ).toBeVisible();
  expect(sent[1]).not.toHaveProperty("requestId");
});

test("activity badge uses server tier, stays absent at zero and handles unavailable results", async ({
  page,
}) => {
  await setup(page);
  let rank = {
    userId: 1,
    distinctPartners: 20,
    rank: 3,
    tier: "Emerald" as string | null,
  };
  let unavailable = false;
  await page.route("**/api/users/1/activity-rank", (r) =>
    r.fulfill(unavailable ? { status: 503, json: {} } : { json: rank }),
  );
  await page.goto("/profile");
  await expect(
    page.getByRole("img", {
      name: /Emerald activity badge.*20 distinct study partners/,
    }),
  ).toBeVisible();
  await page.getByText("About this activity badge", { exact: true }).click();
  await expect(
    page.getByText("Activity, not teaching quality.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("activity-badge.png"),
    fullPage: true,
  });
  rank = { ...rank, distinctPartners: 0, tier: null };
  await page.reload();
  await expect(
    page.getByRole("heading", { name: signedInUser.name }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /activity badge/ })).toHaveCount(
    0,
  );
  unavailable = true;
  await page.reload();
  await expect(
    page.getByText("Activity badge unavailable", { exact: true }),
  ).toBeVisible();
});

test("all nine original badge tiers are accessible on member profiles", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/users/2", (r) =>
    r.fulfill({
      json: {
        id: 2,
        name: "Peer",
        subjects: [],
        createdAt: signedInUser.createdAt,
      },
    }),
  );
  let tier = "Bronze",
    distinctPartners = 1;
  await page.route("**/api/users/2/activity-rank", (r) =>
    r.fulfill({ json: { userId: 2, distinctPartners, rank: 1, tier } }),
  );
  for (const [name, partners] of [
    ["Bronze", 1],
    ["Silver", 3],
    ["Gold", 5],
    ["Platinum", 10],
    ["Emerald", 20],
    ["Diamond", 35],
    ["Master", 50],
    ["Grand Master", 75],
    ["Challenger", 100],
  ] as const) {
    tier = name;
    distinctPartners = partners;
    await page.goto("/profile/2");
    await expect(
      page.getByRole("img", {
        name: `${name} activity badge, ${partners} distinct study partners, activity rank 1`,
        exact: true,
      }),
    ).toBeVisible();
  }
});

for (const width of [320, 390])
  test(`profile badge preserves avatar and controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    await page.route("**/api/users/1/activity-rank", (r) =>
      r.fulfill({
        json: {
          userId: 1,
          distinctPartners: 75,
          rank: 1,
          tier: "Grand Master",
        },
      }),
    );
    await page.goto("/profile");
    const badge = page.getByRole("img", {
      name: /Grand Master activity badge/,
    });
    await expect(badge).toBeVisible();
    const avatar = await page.locator(".w-16.h-16").boundingBox();
    expect(avatar!.width).toBe(64);
    expect(avatar!.height).toBe(64);
    await expect(
      page.getByRole("button", { name: "Edit profile", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByText("About this activity badge", { exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: test.info().outputPath("mobile-profile.png"),
      fullPage: true,
    });
  });

test("moderation queue preserves post context without a deleted destination link", async ({
  page,
}) => {
  await setup(page, () => ({ ...signedInUser, isAdmin: true }));
  const base = {
    reporterId: 1,
    reporterName: "Reporter",
    reportedUserId: 2,
    reportedUserName: "Peer",
    reason: "spam",
    description: "Synthetic report",
    status: "open",
    note: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: signedInUser.createdAt,
    targetType: "request",
  };
  await page.route("**/api/admin/reports?*", (r) =>
    r.fulfill({
      json: [
        { ...base, id: 1, requestId: 11, requestTitle: "Active reported post" },
        {
          ...base,
          id: 2,
          requestId: null,
          requestTitle: "Removed reported post",
        },
      ],
    }),
  );
  await page.goto("/admin/reports");
  await expect(
    page.getByRole("link", { name: "Active reported post", exact: true }),
  ).toHaveAttribute("href", "/requests/11");
  await expect(
    page.getByText("Removed reported post (deleted)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Removed reported post/ }),
  ).toHaveCount(0);
});

test("lower-left bell links to the existing inbox and clears unread count", async ({
  page,
}) => {
  await setup(page);
  let read = false;
  await page.route("**/api/notifications", (r) =>
    r.fulfill({
      json: {
        unreadCount: read ? 0 : 2,
        items: [
          {
            id: 1,
            kind: "request_match",
            requestId: 11,
            message: "Study notice",
            createdAt: signedInUser.createdAt,
            read,
          },
        ],
      },
    }),
  );
  await page.route("**/api/notifications/read", (r) => {
    read = true;
    return r.fulfill({ status: 204 });
  });
  await page.goto("/profile");
  const bell = page.getByRole("link", {
    name: "Open notifications, 2 unread",
    exact: true,
  });
  await expect(bell).toBeVisible();
  const box = await bell.boundingBox();
  expect(box?.x).toBeLessThan(60);
  expect(box!.y).toBeGreaterThan(page.viewportSize()!.height - 100);
  await bell.click();
  await expect(
    page.getByRole("link", { name: "Study notice" }),
  ).toHaveAttribute("href", "/requests/11");
  await expect(
    page.getByRole("link", {
      name: "Open notifications, no unread notifications",
      exact: true,
    }),
  ).toBeVisible();
});

test("uncertain request publish never automatically retries and explicit same-content retry reuses UUID", async ({
  page,
}) => {
  await setup(page);
  const attempts: Record<string, unknown>[] = [];
  await page.route("**/api/requests", (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: [post] });
    attempts.push(r.request().postDataJSON());
    return attempts.length === 1
      ? r.abort("failed")
      : r.fulfill({ status: 201, json: post });
  });
  await page.goto("/requests/new");
  await page
    .getByPlaceholder("e.g. Need help with AP Calculus BC")
    .fill("A new study question");
  await page
    .getByPlaceholder(
      "Describe what you're looking for, your background, and your goals...",
    )
    .fill("Synthetic question for a classmate");
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await page.getByRole("button", { name: "Post request", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("We could not confirm");
  expect(attempts).toHaveLength(1);
  expect(attempts[0].clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Post request", exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/11$/);
  expect(attempts).toHaveLength(2);
  expect(attempts[1].clientRequestId).toBe(attempts[0].clientRequestId);
});
