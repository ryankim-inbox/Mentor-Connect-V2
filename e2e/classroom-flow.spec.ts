import { expect, test, type Page } from "@playwright/test";
import { fixtureAccounts, fixturePassword } from "./fixtures";

async function signIn(page: Page, role: keyof typeof fixtureAccounts = "mentor") {
  await page.goto("/login");
  await page.getByLabel("School email").fill(fixtureAccounts[role].email);
  await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
  const accepted = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await accepted).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await page.context().cookies()).some(cookie => cookie.name === "peerbridge_session" && cookie.httpOnly)).toBe(true);
}

function apiResponse(page: Page, path: string, method = "GET") {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
}

test.beforeEach(async ({ request }) => {
  expect((await request.post("http://127.0.0.1:18181/__fixture/reset")).ok()).toBe(true);
});

test("all learning routes load their required APIs through the built gateway after login", async ({ page }) => {
  await signIn(page);
  const routes = [
    ["/dashboard", "Welcome back, Classroom", ["/api/stats/overview", "/api/requests", "/api/districts"]],
    ["/districts", "High School District Channels", ["/api/districts"]],
    ["/requests", "Browse Mentorship Requests", ["/api/requests", "/api/tags"]],
    ["/requests/new", "Post a mentorship request", ["/api/tags", "/api/districts"]],
    ["/recommendations", "Top mentors for you", ["/api/practice/matching/1", "/api/practice/blocks/status"]],
    ["/practice-lab", "Python Practice Lab", ["/api/practice/status", "/api/practice/locations/status", "/api/practice/blocks/status"]],
    ["/analytics", "Mentor Analytics", ["/api/analysis/status", "/api/analytics/weekly-matches", "/api/analytics/popular-subjects", "/api/analytics/popular-time-slots", "/api/analytics/mentor-response-rates"]],
    ["/scheduling", "Scheduling", ["/api/scheduling/status", "/api/scheduling/overview"]],
    ["/admin/reports", "Learning Reports", ["/api/admin/flagged-users", "/api/python-reports/summary"]],
  ] as const;
  for (const [route, heading, paths] of routes) {
    await test.step(route, async () => {
      const responses = Promise.all(paths.map(path => apiResponse(page, path)));
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText("This feature is unavailable", { exact: false })).toHaveCount(0);
      for (const response of await responses) {
        expect(response.status(), response.url()).toBe(200);
        expect(response.headers()["x-request-id"], response.url()).toBeTruthy();
      }
      if (route === "/practice-lab") {
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
      }
    });
  }
});

test("clearing a profile bio persists through the gateway and a reload", async ({ page }) => {
  await signIn(page, "mentee");
  await page.goto("/settings");
  await expect(page.locator("textarea")).toHaveValue("Mentee fixture profile");
  await page.locator("textarea").fill("");
  const saved = apiResponse(page, "/api/users/2", "PATCH");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Profile saved successfully.")).toBeVisible();
  await page.reload();
  await expect(page.locator("textarea")).toHaveValue("");
});

test("a member creates, reads and deletes their request through the production controls", async ({ page }) => {
  await signIn(page);
  await page.goto("/requests/new");
  await page.getByPlaceholder("e.g. Need help with AP Calculus BC").fill("Classroom gateway study request");
  await page.getByPlaceholder("Describe what you're looking for, your background, and your goals...").fill("Work through a synthetic classroom problem.");
  await page.getByRole("button", { name: "Math", exact: true }).click();
  const createdResponse = apiResponse(page, "/api/requests", "POST");
  await page.getByRole("button", { name: "Post request", exact: true }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const created = await response.json();
  await expect(page).toHaveURL(new RegExp(`/requests/${created.id}$`));
  await expect(page.getByRole("heading", { name: "Classroom gateway study request", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Work through a synthetic classroom problem.", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  const deleted = apiResponse(page, `/api/requests/${created.id}`, "DELETE");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByText("Classroom gateway study request", { exact: true })).toHaveCount(0);
});

test("Connect persists the returned match and survives a reload", async ({ page }) => {
  await signIn(page);
  await page.goto("/requests/11");
  const connected = apiResponse(page, "/api/requests/11/match", "POST");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const response = await connected;
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe("matched");
  await expect(page.getByRole("heading", { name: "This request has been matched" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "This request has been matched" })).toBeVisible();
});

test("a saved room message is visible to the other signed-in account", async ({ page, browser }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByPlaceholder("Type a message…").fill("Classroom cross-account message");
  const sent = apiResponse(page, "/api/chat/rooms/1/messages", "POST");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByText("Classroom cross-account message", { exact: true })).toHaveCount(1);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:14200" });
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, "mentee");
    await otherPage.getByRole("button", { name: "Open chat" }).click();
    await expect(otherPage.getByText("Classroom cross-account message", { exact: true })).toHaveCount(1);
  } finally { await other.close(); }
});
