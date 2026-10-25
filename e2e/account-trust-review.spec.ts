import { test, expect, type Page } from "@playwright/test";
import { signedInUser, fixtures } from "./fixtures";
const admin = { ...signedInUser, isVerified: true, hasMemberAccess: true, isAdmin: true };
const member = { ...admin, isAdmin: false };
const report = {
  id: 1,
  reporterId: 1,
  reporterName: "Reporter",
  reportedUserId: 2,
  reportedUserName: "Peer",
  reason: "spam",
  description: "Private review description",
  status: "open",
  note: "Original saved note",
  reviewedBy: null,
  reviewedAt: null,
  createdAt: admin.createdAt,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(page: Page, user: unknown) {
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      json: path === "/api/auth/me" ? user : (fixtures[path] ?? []),
    });
  });
}
for (const operation of ["read", "write"] as const)
  for (const status of [401, 403])
    test(`report ${operation} ${status} discards private data and drafts until identity and report read authorize again`, async ({
      page,
    }) => {
      const identity = deferred(),
        freshRead = deferred();
      let meCalls = 0,
        reads = 0,
        deny = false,
        recover = false;
      await setup(page, admin);
      await page.clock.install();
      await page.route("**/api/auth/me", async (r) => {
        meCalls++;
        if (meCalls > 1) await identity.promise;
        await r.fulfill({ json: admin });
      });
      await page.route("**/api/admin/reports?*", async (r) => {
        reads++;
        if (deny && !recover && operation === "read") {
          await r.fulfill({ status, json: { detail: "Access denied" } });
          return;
        }
        if (reads > 1 && deny) await freshRead.promise;
        await r.fulfill({ json: [report] });
      });
      await page.route("**/api/admin/reports/1", (r) =>
        r.fulfill({ status, json: { detail: "Access denied" } }),
      );
      try {
        await page.goto("/admin/reports");
        await expect(
          page.getByText(report.description, { exact: true }),
        ).toBeVisible();
        await page
          .getByLabel("Internal note for report 1")
          .fill("Unsaved private draft");
        deny = true;
        if (operation === "write")
          await page
            .getByRole("button", { name: "Save review", exact: true })
            .click();
        else {
          await page.clock.fastForward(31000);
          await page.evaluate(() =>
            window.dispatchEvent(new Event("visibilitychange")),
          );
        }
        await expect(
          page.getByText(report.description, { exact: true }),
        ).toHaveCount(0);
        await expect(page.getByLabel("Internal note for report 1")).toHaveCount(
          0,
        );
        await expect(
          page.getByRole("button", { name: "Save review", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "Recheck report access",
            exact: true,
          }),
        ).toBeVisible();
        await expect.poll(() => meCalls).toBeGreaterThan(1);
        const deniedReads = reads;
        await page.evaluate(() =>
          window.history.pushState({}, "", "/dashboard"),
        );
        await expect(
          page.getByRole("heading", {
            name: "Welcome back, Classroom",
            exact: true,
          }),
        ).toBeVisible();
        await page.evaluate(() =>
          window.history.pushState({}, "", "/admin/reports"),
        );
        await expect(
          page.getByRole("button", {
            name: "Recheck report access",
            exact: true,
          }),
        ).toBeVisible();
        expect(reads).toBe(deniedReads);
        await page
          .getByRole("button", { name: "Recheck report access", exact: true })
          .click();
        await expect(
          page.getByText(report.description, { exact: true }),
        ).toHaveCount(0);
        const before = reads;
        recover = true;
        identity.resolve();
        // A new successful identity check cannot restore the old cached payload.
        await expect.poll(() => reads).toBeGreaterThan(before);
        await expect(
          page.getByText(report.description, { exact: true }),
        ).toHaveCount(0);
        freshRead.resolve();
        await expect(
          page.getByText(report.description, { exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel("Internal note for report 1")).toHaveValue(
          report.note,
        );
      } finally {
        identity.resolve();
        freshRead.resolve();
      }
    });
test("transient moderation failure retains draft and allows an explicit retry", async ({
  page,
}) => {
  await setup(page, admin);
  await page.route("**/api/admin/reports?*", (r) =>
    r.fulfill({ json: [report] }),
  );
  let fail = true,
    saves = 0;
  await page.route("**/api/admin/reports/1", (r) => {
    saves++;
    return r.fulfill(fail ? { status: 503, json: {} } : { json: report });
  });
  await page.goto("/admin/reports");
  await page
    .getByLabel("Internal note for report 1")
    .fill("Retained transient draft");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText(report.description, { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Internal note for report 1")).toHaveValue(
    "Retained transient draft",
  );
  expect(saves).toBe(1);
  fail = false;
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();
  expect(saves).toBe(2);
});
test("session error hides peers while own profile and settings draft remain accessible", async ({
  page,
  context,
}) => {
  const settings = await context.newPage(),
    own = await context.newPage();
  let fail = false;
  for (const document of [page, settings, own]) {
    await setup(document, member);
    await document.route("**/api/auth/me", (r) =>
      r.fulfill(fail ? { status: 503, json: {} } : { json: member }),
    );
    await document.route("**/api/users/2", (r) =>
      r.fulfill({
        json: {
          id: 2,
          name: "Private peer canary",
          subjects: ["Biology"],
          createdAt: member.createdAt,
        },
      }),
    );
    await document.route("**/api/users/1", (r) =>
      r.fulfill({
        json: {
          id: 1,
          name: "Own profile canary",
          subjects: ["Math"],
          createdAt: member.createdAt,
        },
      }),
    );
  }
  try {
    await page.goto("/profile/2");
    await expect(
      page.getByRole("heading", { name: "Private peer canary", exact: true }),
    ).toBeVisible();
    await settings.goto("/settings");
    await settings.getByLabel("Full name").fill("Own unsaved draft");
    await own.goto("/profile/1");
    await expect(
      own.getByRole("heading", { name: "Own profile canary", exact: true }),
    ).toBeVisible();
    fail = true;
    for (const document of [page, settings, own])
      await document.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
    for (const document of [page, settings, own])
      await expect(
        document.getByRole("button", { name: "Retry session", exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Private peer canary", exact: true }),
    ).toHaveCount(0);
    await expect(settings.getByLabel("Full name")).toHaveValue(
      "Own unsaved draft",
    );
    await expect(
      own.getByRole("heading", { name: "Own profile canary", exact: true }),
    ).toBeVisible();
    fail = false;
    for (const document of [page, settings, own])
      await document
        .getByRole("button", { name: "Retry session", exact: true })
        .click();
    await expect(
      page.getByRole("heading", { name: "Private peer canary", exact: true }),
    ).toBeVisible();
    await expect(settings.getByLabel("Full name")).toHaveValue(
      "Own unsaved draft",
    );
  } finally {
    await settings.close();
    await own.close();
  }
});
for (const olderStatus of [200, 400])
  test(`new fragment survives older deferred ${olderStatus} response without stale feedback`, async ({
    page,
  }) => {
    await setup(page, { ...member, isVerified: false, hasMemberAccess: false });
    const older = deferred();
    let verified = false;
    const submitted: string[] = [];
    let meCalls = 0;
    await page.route("**/api/auth/me", (r) => {
      meCalls++;
      return r.fulfill({ json: { ...member, isVerified: verified, hasMemberAccess: verified } });
    });
    await page.route("**/api/auth/verification/confirm", async (r) => {
      const token = r.request().postDataJSON().token;
      submitted.push(token);
      if (submitted.length === 1) {
        await older.promise;
        await r.fulfill(
          olderStatus === 200
            ? { json: { ...member, isVerified: true, hasMemberAccess: true } }
            : {
                status: 400,
                json: { detail: "Invalid or expired verification token" },
              },
        );
      } else {
        verified = true;
        await r.fulfill({ json: { ...member, isVerified: true, hasMemberAccess: true } });
      }
    });
    try {
      await page.goto("/verify-email#token=" + "a".repeat(43));
      await page
        .getByRole("button", { name: "Confirm email ownership", exact: true })
        .click();
      await expect.poll(() => submitted.length).toBe(1);
      await page.evaluate(() => {
        location.hash = "token=" + "b".repeat(43);
      });
      await expect(page).toHaveURL(/\/verify-email$/);
      older.resolve();
      await expect(
        page.getByRole("button", {
          name: "Confirm email ownership",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(
        page.getByText("Your email is verified.", { exact: true }),
      ).toHaveCount(0);
      expect(meCalls).toBe(1);
      expect(submitted).toEqual(["a".repeat(43)]);
      await page
        .getByRole("button", { name: "Confirm email ownership", exact: true })
        .click();
      await expect(
        page.getByText("Your email is verified.", { exact: true }),
      ).toBeVisible();
      expect(submitted).toEqual(["a".repeat(43), "b".repeat(43)]);
      expect(
        await page.evaluate(() =>
          JSON.stringify([localStorage, sessionStorage]).includes(
            "b".repeat(43),
          ),
        ),
      ).toBe(false);
    } finally {
      older.resolve();
    }
  });

test("transient report read retains cached rows and note draft for explicit retry", async ({
  page,
}) => {
  await setup(page, admin);
  await page.clock.install();
  let fail = false,
    reads = 0;
  await page.route("**/api/admin/reports?*", (r) => {
    reads++;
    return r.fulfill(fail ? { status: 503, json: {} } : { json: [report] });
  });
  await page.goto("/admin/reports");
  await page
    .getByLabel("Internal note for report 1")
    .fill("Unsaved read retry draft");
  fail = true;
  await page.clock.fastForward(31000);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("button", { name: "Retry reports", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(report.description, { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Internal note for report 1")).toHaveValue(
    "Unsaved read retry draft",
  );
  expect(reads).toBe(2);
  fail = false;
  await page
    .getByRole("button", { name: "Retry reports", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry reports", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Internal note for report 1")).toHaveValue(
    "Unsaved read retry draft",
  );
  expect(reads).toBe(3);
});
test("switching accounts during report reauthorization cannot restore administrator data", async ({
  page,
}) => {
  await setup(page, admin);
  let switching = false,
    oldCheck = false,
    reads = 0;
  const oldIdentity = deferred();
  const student = { ...member, id: 2, name: "Student B", email: "b@test.edu" };
  await page.route("**/api/auth/me", async (r) => {
    if (oldCheck && !switching) await oldIdentity.promise;
    await r.fulfill({ json: switching ? student : admin });
  });
  await page.route("**/api/admin/reports?*", (r) => {
    reads++;
    return r.fulfill({ json: [report] });
  });
  await page.route("**/api/admin/reports/1", (r) => {
    oldCheck = true;
    return r.fulfill({ status: 403, json: { detail: "Denied" } });
  });
  await page.route("**/api/auth/login", (r) => {
    switching = true;
    return r.fulfill({ json: { user: student, message: "ok" } });
  });
  try {
    await page.goto("/admin/reports");
    await page
      .getByLabel("Internal note for report 1")
      .fill("Former administrator draft");
    await page
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Recheck report access", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.history.pushState({}, "", "/login"));
    await page.getByLabel("Email").fill(student.email);
    await page.getByLabel("Password", { exact: true }).fill("Password123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    oldIdentity.resolve();
    await page.evaluate(() =>
      window.history.pushState({}, "", "/admin/reports"),
    );
    await expect(
      page.getByText("Administrator access required", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(report.description, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Internal note for report 1")).toHaveCount(0);
    expect(reads).toBe(1);
  } finally {
    oldIdentity.resolve();
  }
});
