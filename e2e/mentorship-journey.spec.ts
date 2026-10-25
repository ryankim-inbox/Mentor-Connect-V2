import { expect, test, type Page } from "@playwright/test";
import { fixtureAccounts, fixtureLoginEmail, fixturePassword } from "./fixtures";

async function signIn(page: Page, role: "mentor" | "mentee") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixtureLoginEmail(role, test.info().testId));
  await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:18181/__fixture/reset"); });

test("two accounts discuss, apply, accept and message a named connection", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:14200" });
  try {
    const owner = await other.newPage();
    await signIn(page, "mentor");
    await signIn(owner, "mentee");
    await page.goto("/requests/11");
    await page.getByLabel("Comment").fill("E2E TEST <script>plain text</script>");
    await page.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(page.getByText("E2E TEST <script>plain text</script>", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Apply to connect", exact: true }).click();
    await expect(page.getByText("Application pending", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "This request has been matched" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Application pending", { exact: true })).toBeVisible();
    await owner.goto("/requests/11");
    await owner.getByRole("button", { name: "Reply", exact: true }).click();
    await owner.getByLabel("Comment").fill("E2E TEST owner reply");
    await owner.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(owner.getByText("E2E TEST owner reply", { exact: true })).toBeVisible();
    await owner.getByRole("button", { name: "Accept Classroom Mentor", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "This request has been matched" })).toBeVisible();
    await owner.evaluate(() => window.scrollTo(0, 0));
    await owner.screenshot({ path: "/tmp/mentor-e2e-fixes-discussion.png", fullPage: true });
    await page.reload();
    await expect(page.getByRole("button", { name: "Message Classroom Mentee", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Message Classroom Mentee", exact: true }).click();
    await page.getByPlaceholder("Type a message…").fill("E2E TEST named DM");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("E2E TEST named DM", { exact: true })).toHaveCount(1);
    await owner.getByRole("button", { name: "Message Classroom Mentor", exact: true }).click();
    await expect(owner.getByText("E2E TEST named DM", { exact: true })).toHaveCount(1);
    await page.goto("/connections");
    await expect(page.getByRole("heading", { name: "My connections", exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/mentor-e2e-fixes-connections.png", fullPage: true });
    await expect(page.getByRole("button", { name: "Message Classroom Mentee", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await signIn(page, "mentee");
    await page.goto("/connections");
    await expect(page.getByRole("button", { name: "Message Classroom Mentor", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Message Classroom Mentee", exact: true })).toHaveCount(0);
  } finally { await other.close().catch(() => {}); }
});

test("applicant can cancel and reapply; author can decline", async ({ page, browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:14200" });
  try {
    const owner = await context.newPage();
    await signIn(page, "mentor");
    await page.goto("/requests/11");
    await page.getByRole("button", { name: "Apply to connect", exact: true }).click();
    await page.getByRole("button", { name: "Cancel application", exact: true }).click();
    await expect(page.getByText("Application cancelled", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Apply again", exact: true }).click();
    await signIn(owner, "mentee");
    await owner.goto("/requests/11");
    await owner.getByRole("button", { name: "Decline Classroom Mentor", exact: true }).click();
    await page.reload();
    await expect(page.getByText("Application declined", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply again", exact: true })).toHaveCount(0);
  } finally { await context.close().catch(() => {}); }
});

test("legacy matches provide a named contact without an application", async ({ page, request }) => {
  await signIn(page, "mentor");
  const original = (await request.get("http://127.0.0.1:18181/api/requests/11", { headers: { cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join("; ") } })).ok();
  expect(original).toBe(true);
  await page.route("**/api/requests/11", async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, status: "matched", matchedUserId: 1, matchedUserName: "Classroom Mentor" } });
  });
  await page.goto("/requests/11");
  await expect(page.getByRole("button", { name: "Message Classroom Mentee", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Message Classroom Mentee", exact: true }).click();
  await expect(page.getByPlaceholder("Type a message…")).toBeVisible();
  await expect(page.getByPlaceholder("Start a DM by user id…")).toHaveCount(0);
});

test("comment composer locks simultaneous submission and reuses an uncertain operation", async ({ page }) => {
  await signIn(page, "mentor");
  await page.goto("/requests/11");
  const sent: unknown[] = [];
  await page.route("**/api/requests/11/comments", async route => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "backend_error" } });
  });
  const input = page.getByLabel("Comment", { exact: true });
  await input.fill("E2E TEST uncertain comment");
  await page.locator("form").filter({ has: input }).evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByRole("alert")).toBeVisible();
  expect(sent).toHaveLength(1);
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual(sent[0]);
});

test("switching named DM recipients never carries the previous private draft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await signIn(page, "mentor");
  await page.route("**/api/connections**", route => route.fulfill({ json: [
    { userId: 2, name: "Classroom Mentee", requestId: 11, requestTitle: "First connection" },
    { userId: 3, name: "Another Learner", requestId: 12, requestTitle: "Other connection" },
  ] }));
  await page.route("**/api/dms/start", route => {
    const other = route.request().postDataJSON().toUserId === 3;
    return route.fulfill({ json: { id: other ? 2 : 1, otherUserId: other ? 3 : 2, otherUserName: other ? "Another Learner" : "Classroom Mentee", createdAt: "2026-10-16T00:00:00Z" } });
  });
  await page.goto("/connections");
  await page.getByRole("button", { name: "Message Classroom Mentee", exact: true }).click();
  await page.getByPlaceholder("Type a message…").fill("Private draft for first connection");
  await page.getByRole("button", { name: "Message Another Learner", exact: true }).click();
  await expect(page.getByText("Another Learner", { exact: true }).last()).toBeVisible();
  await expect(page.getByPlaceholder("Type a message…")).toHaveValue("");
});
