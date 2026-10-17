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

for (const role of ["mentor", "mentee"]) {
  test(`${role} test member opens member URLs and chat without claiming ownership`, async ({ page }) => {
    await setup(page, () => ({ ...testMember, role }));
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Verify your email" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    await expect(page.getByText("Test member access · Email ownership unverified")).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Mentors", exact: true })).toBeVisible();
    for (const path of ["/mentors", "/connections", "/requests/new", "/users/2"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Verify your email" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    }
    await page.goto("/admin/reports");
    await expect(page.getByText("Administrator access required", { exact: true })).toBeVisible();
  });
}

test("test-member login follows return path and revoked access blocks direct URLs", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);
});

test("member access alone cannot render operational pages even with an inconsistent admin claim", async ({ page }) => {
  await setup(page, () => ({ ...testMember, isAdmin: true }));
  const operations: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(admin|practice|analytics|scheduling|matches|python-reports)/.test(request.url())) operations.push(request.url());
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Python Practice Lab" })).toHaveCount(0);
  for (const path of ["/admin/reports", "/practice-lab", "/analytics", "/scheduling", "/recommendations"]) {
    await page.goto(path);
    await expect(page.getByText("Administrator access required", { exact: true })).toBeVisible();
  }
  expect(operations).toEqual([]);
});
