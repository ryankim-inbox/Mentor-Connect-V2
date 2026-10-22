import { test, expect, type Page } from "@playwright/test";
import { signedInUser, fixtures } from "./fixtures";
const member = { ...signedInUser, isVerified: true, hasMemberAccess: true, isAdmin: false };
const operational = [
  "/recommendations",
  "/practice-lab",
  "/analytics",
  "/scheduling",
  "/admin/reports",
  "/dashboard/practice-lab",
  "/dashboard?tab=practice-lab",
];
async function setup(page: Page, identity: unknown) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill(
        identity
          ? { json: identity }
          : { status: 401, json: { detail: "Not authenticated" } },
      );
    return route.fulfill({ json: fixtures[path] ?? [] });
  });
}
for (const role of ["mentor", "mentee", "both"] as const)
  test(`${role} hides operations and denies every direct operational path before fetching`, async ({
    page,
  }) => {
    await setup(page, { ...member, role });
    const protectedCalls: string[] = [];
    page.on("request", (req) => {
      if (
        /\/api\/(practice|matches|analysis|analytics|scheduling|admin|python-reports)/.test(
          req.url(),
        )
      )
        protectedCalls.push(req.url());
    });
    await page.goto("/dashboard");
    for (const label of [
      "Matches",
      "Practice",
      "Analytics",
      "Scheduling",
      "Reports",
    ])
      await expect(
        page
          .getByRole("navigation")
          .getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Python Practice Lab" }),
    ).toHaveCount(0);
    for (const path of operational) {
      await page.goto(path);
      await expect(
        page.getByText("Administrator access required", { exact: true }),
      ).toBeVisible();
    }
    expect(protectedCalls).toEqual([]);
  });
test("server-denied membership keeps own settings available and member queries and chat disabled", async ({
  page,
}) => {
  await setup(page, { ...member, isVerified: false, hasMemberAccess: false });
  const memberCalls: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/(blocks|chat|dms|connections|requests|mentors)/.test(r.url()))
      memberCalls.push(r.url());
  });
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Member access unavailable" }),
  ).toBeVisible();
  expect(memberCalls).toEqual([]);
});
test("verification captures and scrubs each fragment and requires explicit confirmation", async ({
  page,
}) => {
  let verified = false;
  let submitted: unknown[] = [];
  await setup(page, member);
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { ...member, isVerified: verified, hasMemberAccess: verified } }),
  );
  await page.route("**/api/auth/verification/confirm", (r) => {
    submitted.push(r.request().postDataJSON());
    verified = true;
    return r.fulfill({ json: { ...member, isVerified: true, hasMemberAccess: true } });
  });
  await page.goto("/verify-email#token=" + "a".repeat(43));
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(submitted).toEqual([]);
  await page.evaluate(() => {
    location.hash = "token=" + "b".repeat(43);
  });
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.getByRole("button", { name: "Confirm email ownership" }).click();
  await expect(
    page.getByText("Your email is verified.", { exact: true }),
  ).toBeVisible();
  expect(submitted).toEqual([{ token: "b".repeat(43) }]);
  expect(
    await page.evaluate(() => JSON.stringify([localStorage, sessionStorage])),
  ).not.toContain("b".repeat(43));
});
test("logged-out verification link is scrubbed and offers safe sign-in and resend", async ({
  page,
}) => {
  await setup(page, null);
  await page.goto("/verify-email#token=" + "c".repeat(43));
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(
    page.getByText(/Sign in, then request a new verification email/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in to verify" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fverify-email$/);
});
test("admin can access moderation queue and student mentor discovery stays separate", async ({
  page,
}) => {
  await setup(page, { ...member, isAdmin: true });
  await page.goto("/admin/reports");
  await expect(
    page.getByRole("heading", { name: "Report queue" }),
  ).toBeVisible();
  await page.goto("/mentors");
  await expect(
    page.getByRole("heading", { name: "Find a mentor" }),
  ).toBeVisible();
});
test("profile safety actions and settings unblock use existing member endpoints", async ({
  page,
}) => {
  await setup(page, member);
  let blocked = false;
  let reports = 0;
  await page.route("**/api/users/2", (r) =>
    blocked
      ? r.fulfill({
          status: 403,
          json: { detail: "Messaging is blocked between these users" },
        })
      : r.fulfill({
          json: {
            id: 2,
            name: "Peer Learner",
            subjects: [],
            createdAt: member.createdAt,
          },
        }),
  );
  await page.route("**/api/blocks", (r) => {
    if (r.request().method() === "POST") {
      blocked = true;
      return r.fulfill({
        status: 201,
        json: {
          id: 1,
          blockedUserId: 2,
          blockedUserName: "Peer Learner",
          createdAt: member.createdAt,
        },
      });
    }
    return r.fulfill({
      json: blocked
        ? [
            {
              id: 1,
              blockedUserId: 2,
              blockedUserName: "Peer Learner",
              createdAt: member.createdAt,
            },
          ]
        : [],
    });
  });
  await page.route("**/api/blocks/2", (r) => {
    blocked = false;
    return r.fulfill({ status: 204 });
  });
  await page.route("**/api/reports", (r) => {
    reports++;
    return r.fulfill({ status: 201, json: { message: "Report submitted" } });
  });
  await page.goto("/profile/2");
  await page.getByRole("button", { name: "Report member" }).click();
  await page.getByLabel("Spam", { exact: true }).check();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(
    page.getByText("Report submitted", { exact: true }),
  ).toBeVisible();
  expect(reports).toBe(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Block member" }).click();
  await expect(
    page.getByText("Member blocked.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Peer Learner", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Member profile unavailable",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Unblock Peer Learner" }).click();
  await expect(
    page.getByText("No blocked members.", { exact: true }),
  ).toBeVisible();
});
test("own comments edit and delete with retained replies and no controls on other authors", async ({
  page,
}) => {
  await setup(page, member);
  let rows = [
    {
      id: 1,
      requestId: 11,
      authorId: 1,
      authorName: member.name,
      body: "Original own comment",
      parentId: null,
      parentAuthorName: null,
      createdAt: member.createdAt,
      updatedAt: null,
      deletedAt: null,
    },
    {
      id: 2,
      requestId: 11,
      authorId: 2,
      authorName: "Peer",
      body: "Retained reply",
      parentId: 1,
      parentAuthorName: member.name,
      createdAt: member.createdAt,
      updatedAt: null,
      deletedAt: null,
    },
  ];
  await page.route("**/api/requests/11/comments?*", (r) =>
    r.fulfill({ json: rows }),
  );
  await page.route("**/api/requests/11/comments/1", (r) => {
    rows[0] = {
      ...rows[0],
      body:
        r.request().method() === "DELETE"
          ? ""
          : r.request().postDataJSON().body,
      updatedAt: member.createdAt,
      deletedAt: r.request().method() === "DELETE" ? member.createdAt : null,
    };
    return r.fulfill({ json: rows[0] });
  });
  await page.goto("/requests/11");
  await page.getByRole("button", { name: "Edit comment" }).click();
  await page.getByLabel("Edit comment text").fill("Edited own comment");
  await page.getByRole("button", { name: "Save comment" }).click();
  const editedComment = page
    .getByRole("region", { name: "Discussion", exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Edit comment", exact: true }) })
    .getByRole("paragraph")
    .filter({ has: page.getByText("(edited)", { exact: true }) });
  await expect(editedComment).toHaveText("Edited own comment(edited)");
  await expect(
    editedComment.getByText("(edited)", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete comment" }).click();
  await expect(
    page.getByText("Comment deleted", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Retained reply", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Edited own comment(edited)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit comment" })).toHaveCount(
    0,
  );
});
test("failed delivery and wrong-account confirmation never claim success or retry automatically", async ({
  page,
}) => {
  await setup(page, { ...member, isVerified: false, hasMemberAccess: false });
  let confirmations = 0,
    sends = 0;
  await page.route("**/api/auth/verification/request", (r) => {
    sends++;
    return r.fulfill({
      status: 503,
      json: { detail: "Email delivery disabled" },
    });
  });
  await page.route("**/api/auth/verification/confirm", (r) => {
    confirmations++;
    return r.fulfill({
      status: 400,
      json: { detail: "Invalid or expired verification token" },
    });
  });
  await page.goto("/verify-email#token=" + "d".repeat(43));
  await page.getByRole("button", { name: "Confirm email ownership" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText("Your email is verified.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm email ownership" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(confirmations).toBe(1);
  expect(sends).toBe(1);
  await expect(page.getByText(/Verification email accepted for delivery\./)).toHaveCount(0);
});
test("current session error hides cached administrator content before any protected refresh", async ({
  page,
}) => {
  await setup(page, { ...member, isAdmin: true });
  let fail = false;
  await page.route("**/api/auth/me", (r) =>
    r.fulfill(
      fail ? { status: 503, json: {} } : { json: { ...member, isAdmin: true } },
    ),
  );
  await page.goto("/admin/reports");
  await expect(
    page.getByRole("heading", { name: "Report queue" }),
  ).toBeVisible();
  fail = true;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("button", { name: "Retry session" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report queue" })).toHaveCount(
    0,
  );
});
test("admin direct account switch cancels delayed private data and removes cached reports", async ({
  page,
}) => {
  let current = { ...member, isAdmin: true };
  let oldStarted = false;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await setup(page, current);
  await page.route("**/api/auth/me", (r) => r.fulfill({ json: current }));
  await page.route("**/api/auth/login", (r) => {
    current = { ...member, id: 2, isAdmin: false };
    return r.fulfill({ json: { user: current, message: "ok" } });
  });
  await page.route("**/api/admin/reports?*", async (r) => {
    oldStarted = true;
    await delayed;
    await r.fulfill({
      json: [
        {
          id: 1,
          reporterId: 1,
          reporterName: "A",
          reportedUserId: 2,
          reportedUserName: "B",
          reason: "spam",
          description: "Private administrator canary",
          status: "open",
          note: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: member.createdAt,
        },
      ],
    });
  });
  await page.goto("/admin/reports");
  await expect.poll(() => oldStarted).toBe(true);
  await page.evaluate(() => window.history.pushState({}, "", "/login"));
  await page.getByLabel("School email").fill("student@test.edu");
  await page.getByLabel("Password", { exact: true }).fill("Password123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  release();
  await page.evaluate(() => window.history.pushState({}, "", "/admin/reports"));
  await expect(
    page.getByText("Administrator access required", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Private administrator canary", { exact: true }),
  ).toHaveCount(0);
});
test("admin renders legacy report text and saves Unicode notes with code-point limits", async ({
  page,
}) => {
  await setup(page, { ...member, isAdmin: true });
  const description = "Legacy ".repeat(400);
  let note = "";
  let saves = 0;
  const report = {
    id: 1,
    reporterId: 1,
    reporterName: "Reporter",
    reportedUserId: 2,
    reportedUserName: "Peer",
    reason: "spam",
    description,
    status: "open",
    note: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: member.createdAt,
  };
  await page.route("**/api/admin/reports?*", (r) =>
    r.fulfill({ json: [report] }),
  );
  await page.route("**/api/admin/reports/1", (r) => {
    saves++;
    note = r.request().postDataJSON().note;
    return r.fulfill({
      json: {
        ...report,
        status: "reviewing",
        note,
        reviewedBy: 1,
        reviewedAt: member.createdAt,
      },
    });
  });
  await page.goto("/admin/reports");
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await page.getByLabel("Review status for report 1").selectOption("reviewing");
  await page.getByLabel("Internal note for report 1").fill("😀".repeat(2000));
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  expect(saves).toBe(1);
  expect(Array.from(note)).toHaveLength(2000);
  await page.getByLabel("Internal note for report 1").fill("😀".repeat(2001));
  await expect(
    page.getByRole("button", { name: "Save review" }),
  ).toBeDisabled();
});
for (const role of ["mentor", "mentee", "both"] as const)
  test(`${role} can discover mentors and chat through built gateway while operational APIs deny`, async ({
    page,
    request,
  }) => {
    const { fixtureLoginEmail, fixturePassword } = await import("./fixtures");
    await request.post("http://127.0.0.1:18181/__fixture/reset");
    await page.goto("/login");
    await page
      .getByLabel("School email")
      .fill(fixtureLoginEmail(role, test.info().testId));
    await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    for (const path of [
      "/api/practice/status",
      "/api/analysis/status",
      "/api/matches/1",
      "/api/analytics/weekly-matches",
      "/api/scheduling/status",
      "/api/admin/reports",
      "/api/python-reports/summary",
    ])
      expect((await page.request.get(path)).status(), path).toBe(403);
    await page.goto("/mentors");
    await expect(
      page.getByRole("heading", { name: "Find a mentor", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open chat" }).click();
    await page
      .getByPlaceholder("Type a message…")
      .fill(`Verified ${role} chat`);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText(`Verified ${role} chat`, { exact: true }),
    ).toBeVisible();
  });
test("anonymous operational routes redirect to sign-in without protected fetches", async ({
  page,
}) => {
  await setup(page, null);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (
      /\/api\/(practice|admin|analytics|analysis|scheduling|python-reports)/.test(
        r.url(),
      )
    )
      calls.push(r.url());
  });
  for (const path of operational) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  }
  expect(calls).toEqual([]);
});
test("same-document dashboard query navigation also enforces administrator guard", async ({
  page,
}) => {
  await setup(page, member);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Classroom" }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.history.pushState({}, "", "/dashboard?tab=practice-lab"),
  );
  await expect(
    page.getByText("Administrator access required", { exact: true }),
  ).toBeVisible();
});
test("legacy oversized notes remain readable while status-only moderation preserves them", async ({
  page,
}) => {
  await setup(page, { ...member, isAdmin: true });
  const note = "Legacy note ".repeat(200);
  let sent: unknown;
  const report = {
    id: 1,
    reporterId: 1,
    reporterName: "Reporter",
    reportedUserId: 2,
    reportedUserName: "Peer",
    reason: "spam",
    description: "Description",
    status: "open",
    note,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: member.createdAt,
  };
  await page.route("**/api/admin/reports?*", (r) =>
    r.fulfill({ json: [report] }),
  );
  await page.route("**/api/admin/reports/1", (r) => {
    sent = r.request().postDataJSON();
    return r.fulfill({ json: { ...report, status: "resolved" } });
  });
  await page.goto("/admin/reports");
  await expect(
    page.getByText("Internal note: " + note, { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Review status for report 1").selectOption("resolved");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  expect(sent).toEqual({ status: "resolved" });
});
