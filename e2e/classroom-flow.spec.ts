import { expect, test, type Page } from "@playwright/test";
import { fixtureAccounts, fixturePassword, pythonEnvelope } from "./fixtures";

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

for (const count of [0, 49, 50]) {
  test(`DM history with ${count} messages labels a full window and preserves the empty state`, async ({ page, request }) => {
    const messages = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      conversationId: 1,
      senderId: 2,
      body: `DM window message ${index + 1}`,
      createdAt: "2026-09-09T00:00:00Z",
      readAt: "2026-09-09T01:00:00Z",
    }));
    expect((await request.post("http://127.0.0.1:18181/__fixture/failure", {
      data: { method: "GET", path: "/api/dms/1/messages", status: 200, body: messages },
    })).ok()).toBe(true);
    await signIn(page);
    await page.getByRole("button", { name: "Open chat" }).click();
    await page.getByRole("tab", { name: "DMs", exact: true }).click();
    const loaded = apiResponse(page, "/api/dms/1/messages");
    await page.getByRole("button", { name: "Classroom Mentee", exact: false }).click();
    const response = await loaded;
    expect(response.status()).toBe(200);
    expect(response.headers()["x-request-id"]).toBeTruthy();
    await expect(page.getByText(/^DM window message \d+$/)).toHaveCount(count);
    await expect(page.getByText("Latest 50 messages", { exact: true })).toHaveCount(count === 50 ? 1 : 0);
    await expect(page.getByText("No messages yet — send the first one.", { exact: true })).toHaveCount(count === 0 ? 1 : 0);
    await expect(page.getByPlaceholder("Type a message…")).toBeEnabled();
  });
}

for (const update of ["send", "poll"] as const) {
  test(`a new DM stays in view when ${update} replaces a full 50-message window`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    if (update === "poll") await page.clock.install();
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1, conversationId: 1, senderId: 2,
      body: `Full window message ${index + 1}`,
      createdAt: "2026-09-09T00:00:00Z", readAt: null,
    }));
    const configure = async (method: string, body: unknown, status = 200) => {
      expect((await request.post("http://127.0.0.1:18181/__fixture/failure", {
        data: { method, path: "/api/dms/1/messages", status, body },
      })).ok()).toBe(true);
    };
    await configure("GET", messages);
    await signIn(page);
    await page.getByRole("button", { name: "Open chat" }).click();
    await page.getByRole("tab", { name: "DMs", exact: true }).click();
    await page.getByRole("button", { name: "Classroom Mentee", exact: false }).click();
    await expect(page.getByText(/^Full window message \d+$/)).toHaveCount(50);
    await expect(page.getByText("Full window message 50", { exact: true })).toBeInViewport({ ratio: 1 });
    const newest = { ...messages[49], id: 51, senderId: update === "send" ? 1 : 2, body: "Newest full window message" };
    await configure("GET", [...messages.slice(1), newest]);
    if (update === "send") {
      await configure("POST", newest, 201);
      await page.getByPlaceholder("Type a message…").fill(newest.body);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
    } else {
      await page.clock.fastForward(10_100);
      await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    }
    await expect(page.getByText("Full window message 1", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/^Full window message \d+$/)).toHaveCount(49);
    await expect(page.getByText("Latest 50 messages", { exact: true })).toBeVisible();
    await expect(page.getByText(newest.body, { exact: true })).toBeInViewport({ ratio: 1 });
  });
}

for (const width of [1440, 375, 320]) {
  test(`weekly bars share a plot scale and readable labels at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1100 });
    const weekly = [
      { week: "2026-08-17", matches: null, coverage: "untracked" },
      { week: "2026-08-24", matches: 0, coverage: "complete" },
      { week: "2026-08-31", matches: 0, coverage: "complete" },
      { week: "2026-09-07", matches: 0, coverage: "complete" },
      { week: "2026-09-14", matches: 0, coverage: "complete" },
      { week: "2026-09-21", matches: 5, coverage: "partial" },
      { week: "2026-09-28", matches: 9, coverage: "complete" },
      { week: "2026-10-05", matches: 10, coverage: "partial" },
    ];
    expect((await request.post("http://127.0.0.1:18181/__fixture/failure", {
      data: { method: "GET", path: "/api/analytics/weekly-matches", status: 200,
        body: pythonEnvelope("analysis", weekly) },
    })).ok()).toBe(true);
    // Keep this file below the gateway's real per-account login limit.
    await signIn(page, "mentee");
    await page.goto("/analytics");
    await expect(page.getByText("Week-to-date", { exact: true })).toBeVisible();
    await expect(page.getByText("Untracked", { exact: true })).toBeVisible();
    await expect(page.getByText("Partial", { exact: true })).toHaveCount(2);
    const bars = page.locator('[title="Untracked"], [title*="observed matches ("]');
    await expect(bars).toHaveCount(8);
    const geometry = await bars.evaluateAll(elements => elements.map(element => {
      const bar = element.getBoundingClientRect();
      const plot = element.parentElement!.getBoundingClientRect();
      const column = element.parentElement!.parentElement!;
      const labels = column.children[1];
      return { height: bar.height, bottom: bar.bottom, plotHeight: plot.height, plotBottom: plot.bottom,
        columnBottom: column.getBoundingClientRect().bottom,
        labelsBottom: Math.max(...Array.from(labels.children, label => label.getBoundingClientRect().bottom)) };
    }));
    for (const bar of geometry) {
      expect(Math.abs(bar.plotHeight - geometry[0].plotHeight)).toBeLessThan(1);
      expect(Math.abs(bar.plotBottom - geometry[0].plotBottom)).toBeLessThan(1);
      expect(Math.abs(bar.bottom - geometry[0].bottom)).toBeLessThan(1);
      expect(bar.labelsBottom).toBeLessThanOrEqual(bar.columnBottom + 1);
    }
    expect(geometry[0].height).toBe(0);
    expect(geometry[1].height).toBe(0);
    expect(geometry[7].height).toBeGreaterThan(geometry[6].height);
    expect(geometry[5].height / geometry[7].height).toBeCloseTo(0.5, 1);
    expect(geometry[6].height / geometry[7].height).toBeCloseTo(0.9, 1);
    const latestLabel = page.getByText("2026-10-05", { exact: true });
    await page.getByText("Week-to-date", { exact: true }).scrollIntoViewIfNeeded();
    await expect(latestLabel).toBeInViewport({ ratio: 1 });
    await expect(page.getByText("Week-to-date", { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByText("Partial", { exact: true }).last()).toBeInViewport({ ratio: 1 });
    const weeklyCard = page.locator("div.bg-card").filter({ has: page.getByRole("heading", { name: "Weekly matches", exact: true }) });
    const nextCard = page.locator("div.bg-card").filter({ has: page.getByRole("heading", { name: "Most requested subjects", exact: true }) });
    const weeklyBox = await weeklyCard.boundingBox();
    const nextBox = await nextCard.boundingBox();
    expect(weeklyBox!.x + weeklyBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width < 768) expect(nextBox!.y).toBeGreaterThanOrEqual(weeklyBox!.y + weeklyBox!.height);
  });
}
