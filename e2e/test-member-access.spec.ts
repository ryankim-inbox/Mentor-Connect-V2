import { test, expect, type Page } from "@playwright/test";
import { fixtures, signedInUser } from "./fixtures";

const testMember = { ...signedInUser, isVerified: false, hasMemberAccess: true, isAdmin: false };
async function setup(page: Page, identity: () => unknown) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      const user = identity();
      return route.fulfill(user ? { json: user } : { status: 401, json: {} });
    }
    return route.fulfill({ json: fixtures[path] ?? [] });
  });
}

for (const role of ["mentor", "mentee", "both"]) {
  test(`${role} unverified member opens member URLs and chat without claiming ownership`, async ({ page }) => {
    await setup(page, () => ({ ...testMember, role }));
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Member access unavailable" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    await expect(page.getByText("Email ownership unverified · Verification is optional for member access.")).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Mentors", exact: true })).toBeVisible();
    for (const path of ["/mentors", "/connections", "/requests/new", "/users/2"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Member access unavailable" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    }
    await page.goto("/admin/reports");
    await expect(page.getByText("Administrator access required", { exact: true })).toBeVisible();
  });
}

test("unverified-member login follows return path and revoked access blocks direct URLs", async ({ page }) => {
  let identity: unknown = null;
  await setup(page, () => identity);
  await page.route("**/api/auth/login", (route) => {
    identity = testMember;
    return route.fulfill({ json: { user: testMember, message: "Logged in successfully" } });
  });
  await page.goto("/login?returnTo=%2Frequests");
  await page.getByPlaceholder("you@school.edu").fill(testMember.email);
  await page.getByPlaceholder("Enter your password").fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/requests$/);
  identity = { ...testMember, hasMemberAccess: false };
  await page.reload();
  await expect(page.getByRole("heading", { name: "Member access unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);
});

test("server-authorized demo admin opens operations but never claims ownership or student access", async ({ page }) => {
  let identity = { ...testMember, id: 991, email: "admin@test.edu", isAdmin: true };
  await setup(page, () => identity);
  const operations: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(admin|practice|analytics|scheduling|matches|python-reports|stats|chat|dms|notifications|connections)/.test(request.url())) operations.push(request.url());
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Member access unavailable" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Python Practice Lab" })).toBeVisible();
  await expect(page.getByText("Email ownership unverified · Verification is optional for member access.")).toBeVisible();
  for (const [path, heading] of [
    ["/admin/reports", "Learning Reports"], ["/practice-lab", "Python Practice Lab"],
    ["/analytics", "Mentor Analytics"], ["/scheduling", "Scheduling"],
    ["/recommendations", "Top mentors for you"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText("Administrator access required", { exact: true })).toHaveCount(0);
    if (path === "/admin/reports") await expect(page.getByText("No reports in this queue.")).toBeVisible();
  }
  for (const path of ["/requests/new", "/notifications", "/connections"]) {
    await page.goto(path);
    await expect(page.getByText("Student access required", { exact: true })).toBeVisible();
  }
  expect(operations.some((url) => url.includes("/api/admin/reports"))).toBe(true);
  expect(operations.some((url) => url.includes("/api/stats/overview"))).toBe(true);
  expect(operations.filter((url) => /\/api\/(chat|dms|notifications|connections)/.test(url))).toEqual([]);
  identity = { ...identity, isAdmin: false };
  await page.goto("/admin/reports");
  await expect(page.getByText("Administrator access required", { exact: true })).toBeVisible();
});

test("demo admin can recheck a denied report queue without fabricating ownership", async ({ page }) => {
  await setup(page, () => ({ ...testMember, id: 991, email: "admin@test.edu", isAdmin: true }));
  let denied = true;
  await page.route("**/api/admin/reports?*", (route) => route.fulfill(
    denied ? { status: 403, json: { detail: "Access denied" } } : { json: [] },
  ));
  await page.goto("/admin/reports");
  await expect(page.getByRole("button", { name: "Recheck report access" })).toBeVisible();
  denied = false;
  await page.getByRole("button", { name: "Recheck report access" }).click();
  await expect(page.getByText("No reports in this queue.")).toBeVisible();
  await expect(page.getByText("Email ownership unverified · Verification is optional for member access.")).toBeVisible();
});
