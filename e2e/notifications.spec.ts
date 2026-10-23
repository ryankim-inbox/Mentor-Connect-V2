import { test, expect, type Page } from "@playwright/test";
import { fixtures, signedInUser } from "./fixtures";

const item = {
  id: 1,
  kind: "request_match",
  requestId: 11,
  message: "Synthetic private matching notice",
  createdAt: "2026-10-17T00:00:00Z",
  read: false,
};
async function setup(page: Page, identity = () => signedInUser) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path === "/api/auth/me" ? identity() : (fixtures[path] ?? []),
    });
  });
}

test("unverified test member receives the notification badge and reads its own list", async ({
  page,
}) => {
  await setup(page, () => ({
    ...signedInUser,
    isVerified: false,
    hasMemberAccess: true,
  }));
  let reads = 0;
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: {
        unreadCount: reads ? 0 : 1,
        items: [{ ...item, read: Boolean(reads) }],
      },
    }),
  );
  await page.route("**/api/notifications/read", (route) => {
    expect(route.request().postDataJSON()).toEqual({ ids: [item.id] });
    reads++;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/requests");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Notifications1", exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Notifications1", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: item.message })).toHaveAttribute(
    "href",
    "/requests/11",
  );
  await expect.poll(() => reads).toBe(1);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Notifications", exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Email ownership unverified · Verification is optional for member access."),
  ).toBeVisible();
});

test("read failure is visible and retries only on the member's explicit request", async ({
  page,
}) => {
  await setup(page);
  let reads = 0;
  await page.route("**/api/notifications", (route) =>
    route.fulfill({ json: { unreadCount: reads > 1 ? 0 : 1, items: [item] } }),
  );
  await page.route("**/api/notifications/read", (route) => {
    reads++;
    return route.fulfill(
      reads === 1
        ? { status: 503, json: { error: "backend_error" } }
        : { status: 204 },
    );
  });
  await page.goto("/notifications");
  await expect(
    page.getByText("Could not mark notifications as read."),
  ).toBeVisible();
  expect(reads).toBe(1);
  await page.getByRole("button", { name: "Retry marking read" }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(
    page.getByText("Could not mark notifications as read."),
  ).toHaveCount(0);
});

test("ordinary unverified identity cannot fetch notifications via direct URL or navigation", async ({
  page,
}) => {
  await setup(page, () => ({
    ...signedInUser,
    isVerified: false,
    hasMemberAccess: false,
  }));
  let requests = 0;
  await page.route("**/api/notifications**", (route) => {
    requests++;
    return route.fulfill({ status: 403, json: { error: "forbidden" } });
  });
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "Member access unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /Notifications/ }),
  ).toHaveCount(0);
  expect(requests).toBe(0);
});

test("account switch cancels an old notification request and shows only the new member", async ({
  page,
}) => {
  let identity = { ...signedInUser };
  let oldStarted = false;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await setup(page, () => identity);
  await page.route("**/api/notifications", async (route) => {
    if (identity.id === 1) {
      oldStarted = true;
      await delayed;
      await route
        .fulfill({ json: { unreadCount: 1, items: [item] } })
        .catch(() => {});
    } else
      await route.fulfill({
        json: {
          unreadCount: 0,
          items: [
            { ...item, id: 2, message: "Second member notice", read: true },
          ],
        },
      });
  });
  await page.route("**/api/auth/login", (route) => {
    identity = { ...signedInUser, id: 2, name: "Second Member" };
    return route.fulfill({ json: { user: identity, message: "ok" } });
  });
  await page.goto("/notifications");
  await expect.poll(() => oldStarted).toBe(true);
  await page.evaluate(() => window.history.pushState({}, "", "/login"));
  await page.getByLabel("School email").fill("second@test.edu");
  await page.getByLabel("Password", { exact: true }).fill("SyntheticPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  release();
  await page.evaluate(() => window.history.pushState({}, "", "/notifications"));
  await expect(
    page.getByText("Second member notice", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(item.message, { exact: true })).toHaveCount(0);
});

test("revoked member access removes the open notification page and stops read attempts", async ({
  page,
}) => {
  let identity = { ...signedInUser };
  await setup(page, () => identity);
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: { unreadCount: 0, items: [{ ...item, read: true }] },
    }),
  );
  let reads = 0;
  await page.route("**/api/notifications/read", (route) => {
    reads++;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/notifications");
  await expect(page.getByText(item.message, { exact: true })).toBeVisible();
  identity = { ...signedInUser, isVerified: false, hasMemberAccess: false };
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", { name: "Member access unavailable" }),
  ).toBeVisible();
  await expect(page.getByText(item.message, { exact: true })).toHaveCount(0);
  expect(reads).toBe(0);
});

test("a later notification is acknowledged by its own observed ID snapshot", async ({ page }) => {
  await setup(page);
  const acknowledged: number[][] = [];
  await page.route("**/api/notifications", (route) => {
    const id = acknowledged.length ? 99 : 100;
    return route.fulfill({ json: { unreadCount: acknowledged.length > 1 ? 0 : 1,
      items: [{ ...item, id, read: acknowledged.length > 1 }] } });
  });
  await page.route("**/api/notifications/read", (route) => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ ids: [acknowledged.length ? 99 : 100] });
    acknowledged.push(body.ids);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/notifications");
  await expect.poll(() => acknowledged).toEqual([[100], [99]]);
});

test("older unread notifications beyond the newest page have an explicit mark-all action", async ({ page }) => {
  await setup(page);
  let readAll = false;
  await page.route("**/api/notifications", (route) => route.fulfill({ json: {
    unreadCount: readAll ? 0 : 1, items: Array.from({ length: 50 }, (_, i) => ({ ...item, id: i + 2, read: true })),
  } }));
  await page.route("**/api/notifications/read", (route) => {
    expect(route.request().postData()).toBe(null);
    readAll = true;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/notifications");
  await expect(page.getByRole("button", { name: "Mark all notifications read", exact: true })).toBeVisible();
  expect(readAll).toBe(false);
  await page.getByRole("button", { name: "Mark all notifications read", exact: true }).click();
  await expect.poll(() => readAll).toBe(true);
  await expect(page.getByRole("button", { name: "Mark all notifications read", exact: true })).toHaveCount(0);
});
