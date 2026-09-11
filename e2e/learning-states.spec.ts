import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: 1,
  name: "Learning Mentor",
  email: "mentor@school.edu",
  role: "mentor",
  districtId: 1,
  districtName: "School",
  bio: "",
  subjects: ["Math"],
  isVerified: true,
  createdAt: "2026-09-09T00:00:00Z",
};

const request = {
  id: 11,
  authorId: 2,
  authorName: "Learning Partner",
  authorRole: "mentee",
  districtId: 1,
  districtName: "School",
  title: "Calculus study session",
  description: "Practice derivatives together.",
  tags: [],
  status: "open",
  matchedUserId: null,
  matchedUserName: null,
  createdAt: "2026-09-09T01:00:00Z",
  preferredTimes: [],
};

const lessonTodo = {
  status: "todo",
  mission: 7,
  message: "Complete Mission 7",
  guide: "DM messages",
};

const studentFailure = {
  ok: false,
  success: false,
  source: "python",
  feature: "scheduling",
  student_module: {
    module: "scheduling",
    status: "runtime error",
    importable: true,
  },
  error: "student_module_error",
  data: null,
};

const realEmpty = {
  ok: true,
  success: true,
  source: "python",
  feature: "analytics",
  data: [],
};

async function routeApi(page: Page, handler: (route: Route, path: string) => unknown) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      await route.fulfill({ json: user });
      return;
    }
    const handled = await handler(route, path);
    if (handled === undefined) await route.fulfill({ json: [] });
  });
}

test("real empty analytics data stays distinct from failures", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path.startsWith("/api/analytics/")) await route.fulfill({ json: realEmpty });
    else if (path === "/api/analysis/status")
      await route.fulfill({ json: { ...realEmpty, feature: "analysis", data: null } });
    else return undefined;
    return true;
  });

  await page.goto("/analytics");
  await expect(page.getByText("Python returned no weekly match data.")).toBeVisible();
  await expect(page.getByText("Python analysis failed.")).toHaveCount(0);
  await expect(page.getByText(/connection problem/i)).toHaveCount(0);
});

test("student scheduling failure stays failed and can be retried", async ({ page }) => {
  let overviewCalls = 0;
  await routeApi(page, async (route, path) => {
    if (path === "/api/scheduling/status") {
      await route.fulfill({ json: { ...studentFailure, data: null } });
      return true;
    }
    if (path === "/api/scheduling/overview") {
      overviewCalls++;
      await route.fulfill({ json: studentFailure });
      return true;
    }
    return undefined;
  });

  await page.goto("/scheduling");
  await expect(page.getByText("Python scheduling failed.").last()).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).last().click();
  await expect.poll(() => overviewCalls).toBe(2);
  await expect(page.getByText("student_module_error")).toHaveCount(0);
});

test("a 504 and malformed 2xx response are errors rather than empty success", async ({ page }) => {
  let matchingCalls = 0;
  await routeApi(page, async (route, path) => {
    if (path.startsWith("/api/practice/matching/")) {
      matchingCalls++;
      await route.fulfill({
        status: matchingCalls === 1 ? 504 : 200,
        json: matchingCalls === 1 ? { error: "upstream_timeout" } : { arbitrary: true },
      });
      return true;
    }
    if (path === "/api/practice/blocks/status") {
      await route.fulfill({
        json: {
          success: true,
          status: "connected",
          message: "Block module loaded.",
          service_available: true,
          blocked_users_excluded: true,
        },
      });
      return true;
    }
    return undefined;
  });

  await page.goto("/recommendations");
  await expect(page.getByRole("alert").filter({ hasText: /connection problem/i }).first()).toBeVisible();
  await expect(page.getByText("upstream_timeout")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh live Python result" }).click();
  await expect.poll(() => matchingCalls).toBe(2);
  await expect(page.getByRole("alert").filter({ hasText: /connection problem/i }).first()).toBeVisible();
  await expect(page.getByText(/service is connected/i)).toHaveCount(0);
});

test("DM TODO preserves the draft and is not rendered as a sent message", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path === "/api/chat/rooms") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (path === "/api/dms") {
      await route.fulfill({
        json: [{ id: 21, otherUserId: 2, otherUserName: "Peer", createdAt: "2026-09-09T00:00:00Z" }],
      });
      return true;
    }
    if (path === "/api/dms/21/messages") {
      await route.fulfill({ json: route.request().method() === "POST" ? lessonTodo : [] });
      return true;
    }
    return undefined;
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("tab", { name: "DMs" }).click();
  await page.getByRole("button", { name: /Peer/ }).click();
  const draft = page.getByPlaceholder("Type a message…");
  await draft.fill("Please keep this draft");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Mission 7/)).toBeVisible();
  await expect(draft).toHaveValue("Please keep this draft");
  await expect(page.getByText("Please keep this draft", { exact: true })).toHaveCount(0);
});

test("chat polls only while real authenticated panel state is mounted", async ({ page }) => {
  let messageReads = 0;
  await routeApi(page, async (route, path) => {
    if (path === "/api/chat/rooms") {
      await route.fulfill({
        json: [{ id: 8, type: "global", districtId: null, name: "Global" }],
      });
      return true;
    }
    if (path === "/api/chat/rooms/8/messages") {
      messageReads++;
      await route.fulfill({ json: [] });
      return true;
    }
    return undefined;
  });

  await page.clock.install();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open chat" }).click();
  await expect.poll(() => messageReads).toBe(1);
  await page.clock.fastForward(5_100);
  await expect.poll(() => messageReads).toBe(2);
  await page.getByRole("button", { name: "Close chat" }).click();
  await page.clock.fastForward(15_000);
  expect(messageReads).toBe(2);
});

test("chat keeps its draft and backs off after rate limits and network failures", async ({ page }) => {
  let messageReads = 0;
  await routeApi(page, async (route, path) => {
    if (path === "/api/chat/rooms") {
      await route.fulfill({
        json: [{ id: 8, type: "global", districtId: null, name: "Global" }],
      });
      return true;
    }
    if (path === "/api/chat/rooms/8/messages") {
      messageReads++;
      if (messageReads === 2) {
        await route.fulfill({
          status: 429,
          headers: { "Retry-After": "20" },
          json: { error: "rate_limited" },
        });
      } else if (messageReads === 3) {
        await route.abort("failed");
      } else await route.fulfill({ json: [] });
      return true;
    }
    return undefined;
  });

  await page.clock.install();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open chat" }).click();
  const draft = page.getByPlaceholder("Type a message…");
  await draft.fill("Keep me through polling failures");
  await page.clock.fastForward(5_100);
  await expect(page.getByRole("alert")).toContainText("20 seconds");
  await page.clock.fastForward(19_000);
  expect(messageReads).toBe(2);
  await page.clock.fastForward(1_100);
  await expect.poll(() => messageReads).toBe(3);
  await expect(page.getByRole("alert")).toContainText(/connection problem/i);
  await expect(draft).toHaveValue("Keep me through polling failures");
});

test("failed Connect rechecks server state and never shows matched success", async ({ page }) => {
  let detailReads = 0;
  let matchCalls = 0;
  await routeApi(page, async (route, path) => {
    if (path === "/api/requests/11" && route.request().method() === "GET") {
      detailReads++;
      await route.fulfill({ json: request });
      return true;
    }
    if (path === "/api/requests/11/match") {
      matchCalls++;
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "17" },
        json: { error: "rate_limited" },
      });
      return true;
    }
    return undefined;
  });

  await page.goto("/requests/11");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("17 seconds");
  await expect.poll(() => detailReads).toBeGreaterThan(1);
  await page.waitForTimeout(1_000);
  expect(matchCalls).toBe(1);
  await expect(page.getByText("You're connected!")).toHaveCount(0);
  await expect(page.getByText("upstream_timeout")).toHaveCount(0);
});

test("failed delete stays on the request and exposes a safe retryable error", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path === "/api/requests/11" && route.request().method() === "GET") {
      await route.fulfill({ json: { ...request, authorId: user.id } });
      return true;
    }
    if (path === "/api/requests/11" && route.request().method() === "DELETE") {
      await route.fulfill({ status: 504, json: { detail: "private upstream trace" } });
      return true;
    }
    return undefined;
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/requests/11");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/requests\/11$/);
  await expect(page.getByRole("alert")).toContainText(/connection problem/i);
  await expect(page.getByText("private upstream trace")).toHaveCount(0);
});

test("account forms expose labels, autocomplete, alerts, and busy state", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: {} }));
  await page.route("**/api/auth/login", async (route) => {
    await new Promise(() => {});
    await route.abort();
  });
  await page.goto("/login");
  await expect(page.getByLabel("School email")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await page.getByLabel("School email").fill(user.email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
});
