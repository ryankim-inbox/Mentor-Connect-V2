import { test, expect, type Page } from "@playwright/test";

const accountA = {
  id: 1,
  email: "a@school.edu",
  name: "Account A",
  role: "mentor",
  districtId: 1,
  districtName: "School",
  bio: "Original bio",
  subjects: ["Math"],
  isVerified: true,
  createdAt: "2026-01-01T00:00:00Z",
};
const accountB = {
  ...accountA,
  id: 2,
  email: "b@school.edu",
  name: "Account B",
  bio: "B bio",
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fallback(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
}
async function signIn(page: Page) {
  await page.getByPlaceholder("you@school.edu").fill(accountA.email);
  await page.getByPlaceholder("Enter your password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("login cancels a late anonymous response and waits for verified session", async ({
  page,
}) => {
  await fallback(page);
  const initial = deferred();
  const verified = deferred();
  let meCalls = 0;
  await page.route("**/api/auth/me", async (route) => {
    meCalls += 1;
    const first = meCalls === 1;
    await (first ? initial.promise : verified.promise);
    await route.fulfill(
      first
        ? { status: 401, json: { error: "unauthorized" } }
        : { json: accountA },
    );
  });
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({ json: { user: accountA, message: "ok" } }),
  );
  await page.goto("/login?returnTo=%2Fsettings");
  await expect.poll(() => meCalls).toBe(1);
  await signIn(page);
  await expect.poll(() => meCalls).toBe(2);
  initial.resolve();
  await expect(page).toHaveURL(/\/login\?/);
  verified.resolve();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('input[type="email"]')).toHaveValue(accountA.email);
});

test("initial auth service failure remains on protected page with retry", async ({
  page,
}) => {
  await fallback(page);
  let unavailable = true;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill(
      unavailable
        ? { status: 503, json: { error: "unavailable" } }
        : { json: accountA },
    ),
  );
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "Retry session" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  unavailable = false;
  await page.getByRole("button", { name: "Retry session" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});

test("login session-check failure preserves credentials and retries without another login", async ({
  page,
}) => {
  await fallback(page);
  let loginCalls = 0;
  let verified = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill(
      loginCalls === 0
        ? { status: 401, json: {} }
        : verified
          ? { json: accountA }
          : { status: 503, json: {} },
    ),
  );
  await page.route("**/api/auth/login", (route) => {
    loginCalls++;
    return route.fulfill({ json: { user: accountA, message: "ok" } });
  });
  await page.goto("/login?returnTo=%2Fprofile");
  await signIn(page);
  await expect(page.getByText(/account was accepted/)).toBeVisible();
  await expect(page.getByPlaceholder("Enter your password")).toHaveValue(
    "password123",
  );
  await expect(page).toHaveURL(/\/login\?/);
  verified = true;
  await page.getByRole("button", { name: "Recheck session" }).click();
  await expect(
    page.getByRole("heading", { name: accountA.name, exact: true }),
  ).toBeVisible();
  expect(loginCalls).toBe(1);
});

test("login and registration block double submits until session confirmation finishes", async ({
  page,
}) => {
  for (const mode of ["login", "register"]) {
    await fallback(page);
    const accepted = deferred();
    const verified = deferred();
    let submissions = 0;
    let meCalls = 0;
    await page.route("**/api/auth/me", async (route) => {
      meCalls++;
      if (submissions) {
        await verified.promise;
        await route.fulfill({ json: accountA });
      } else await route.fulfill({ status: 401, json: {} });
    });
    await page.route(`**/api/auth/${mode}`, async (route) => {
      submissions++;
      await accepted.promise;
      await route.fulfill({ json: { user: accountA, message: "ok" } });
    });
    await page.route("**/api/districts?**", (route) =>
      route.fulfill({ json: [{ id: 1, name: "School", county: "Test" }] }),
    );
    await page.goto(`/${mode}?returnTo=%2Fsettings`);
    await expect.poll(() => meCalls).toBe(1);
    await page.getByPlaceholder("you@school.edu").fill(accountA.email);
    await page
      .getByPlaceholder(
        mode === "login" ? "Enter your password" : "Create a password",
      )
      .fill("password123");
    if (mode === "register") {
      await page.getByPlaceholder("Your name").fill(accountA.name);
      await page.locator("select").selectOption("1");
    }
    await page.locator("form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => submissions).toBe(1);
    accepted.resolve();
    await expect.poll(() => meCalls).toBe(2);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await page
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(submissions).toBe(1);
    verified.resolve();
    await expect(page).toHaveURL(/\/settings$/);
    await page.unrouteAll({ behavior: "wait" });
  }
});

for (const destination of [
  "//outside.example",
  "https://outside.example",
  "/login",
  "/register",
  "/LOGIN/",
  "/x/../login",
  "/\\outside.example",
]) {
  test(`rejects unsafe return destination ${destination}`, async ({ page }) => {
    await fallback(page);
    let signedIn = false;
    await page.route("**/api/auth/me", (route) =>
      route.fulfill(signedIn ? { json: accountA } : { status: 401, json: {} }),
    );
    await page.route("**/api/auth/login", (route) => {
      signedIn = true;
      return route.fulfill({ json: { user: accountA, message: "ok" } });
    });
    await page.goto(`/login?returnTo=${encodeURIComponent(destination)}`);
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
}

test("expired background session clears the cached member and returns to login", async ({
  page,
}) => {
  await fallback(page);
  let expired = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill(expired ? { status: 401, json: {} } : { json: accountA }),
  );
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expired = true;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsettings$/);
  await expect(
    page.getByRole("button", { name: "Log out", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);
});

test("background auth errors and retries preserve the profile draft, then empty bio persists", async ({
  page,
}) => {
  await fallback(page);
  let user = { ...accountA };
  let meStatus = 200;
  let meCalls = 0;
  let patch: unknown;
  await page.route("**/api/auth/me", (route) => {
    meCalls++;
    return route.fulfill(
      meStatus === 200 ? { json: user } : { status: meStatus, json: {} },
    );
  });
  await page.route("**/api/users/1", (route) => {
    patch = route.request().postDataJSON();
    user = { ...user, ...(patch as object) };
    return route.fulfill({
      json: {
        id: user.id,
        name: user.name,
        subjects: user.subjects,
        createdAt: user.createdAt,
      },
    });
  });
  await page.goto("/settings");
  const name = page.locator('input[type="text"]').first();
  await name.fill("Edited name");
  await page.locator("textarea").fill("");
  meStatus = 503;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("button", { name: "Retry session" }),
  ).toBeVisible();
  await expect(name).toHaveValue("Edited name");
  meStatus = 200;
  user = { ...user, name: "Background update" };
  await page.getByRole("button", { name: "Retry session" }).click();
  await expect.poll(() => meCalls).toBe(3);
  await expect(name).toHaveValue("Edited name");
  await expect(page.locator("textarea")).toHaveValue("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved successfully.")).toBeVisible();
  expect(patch).toEqual({ name: "Edited name", bio: "", subjects: ["Math"] });
  await page.reload();
  await expect(name).toHaveValue("Edited name");
  await expect(page.locator("textarea")).toHaveValue("");
});

test("profile validates gateway byte limits and blocks duplicate pending saves", async ({
  page,
}) => {
  await fallback(page);
  let user = { ...accountA };
  let saves = 0;
  const saved = deferred();
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/api/users/1", async (route) => {
    saves++;
    user = { ...user, ...route.request().postDataJSON() };
    await saved.promise;
    await route.fulfill({ json: user });
  });
  await page.goto("/settings");
  const name = page.locator('input[type="text"]').first();
  await name.fill("가".repeat(41));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Use a name up to 120/)).toBeVisible();
  expect(saves).toBe(0);
  await name.fill("Updated name");
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => saves).toBe(1);
  await expect(page.getByRole("button", { name: "Saving..." })).toBeDisabled();
  await name.fill("Next draft");
  saved.resolve();
  await expect(page.getByText("Profile saved successfully.")).toBeVisible();
  await expect(name).toHaveValue("Next draft");
});

for (const finalStatus of [200, 401]) {
  test(`logout failure preserves member drafts, then ${finalStatus} clears session`, async ({
    page,
  }) => {
    await fallback(page);
    let logoutStatus = 503;
    let meCalls = 0;
    await page.route("**/api/auth/me", (route) => {
      meCalls++;
      return route.fulfill({ json: accountA });
    });
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ status: logoutStatus, json: { message: "logout" } }),
    );
    await page.route("**/api/chat/rooms", (route) =>
      route.fulfill({
        json: [{ id: 1, name: "Global", type: "global", districtId: null }],
      }),
    );
    await page.goto("/settings");
    const name = page.locator('input[type="text"]').first();
    await name.fill("Unsaved name");
    await page.getByRole("button", { name: "Open chat" }).click();
    await page.getByPlaceholder("Type a message…").fill("Unsent draft");
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Couldn't log out");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(name).toHaveValue("Unsaved name");
    await expect(page.getByPlaceholder("Type a message…")).toHaveValue(
      "Unsent draft",
    );
    const callsBeforeLogout = meCalls;
    logoutStatus = finalStatus;
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Close chat" })).toHaveCount(
      0,
    );
    expect(meCalls).toBe(callsBeforeLogout);
  });
}

test("A logout B cancels delayed private chat and profile requests without restoring A", async ({
  page,
}) => {
  await fallback(page);
  let user: typeof accountA | null = accountA;
  const oldChat = deferred();
  const oldProfile = deferred();
  let chatCalls = 0;
  let profileCalls = 0;
  const aborted: string[] = [];
  page.on("requestfailed", (request) =>
    aborted.push(new URL(request.url()).pathname),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill(user ? { json: user } : { status: 401, json: {} }),
  );
  await page.route("**/api/auth/logout", (route) => {
    user = null;
    return route.fulfill({ json: { message: "ok" } });
  });
  await page.route("**/api/auth/login", (route) => {
    user = accountB;
    return route.fulfill({ json: { user, message: "ok" } });
  });
  await page.route("**/api/chat/rooms", (route) =>
    route.fulfill({
      json: [{ id: 1, name: "Global", type: "global", districtId: null }],
    }),
  );
  await page.route("**/api/chat/rooms/1/messages", async (route) => {
    chatCalls++;
    const old = chatCalls === 1;
    if (old) await oldChat.promise;
    await route.fulfill({
      json: [
        {
          id: 1,
          roomId: 1,
          senderId: old ? 1 : 2,
          senderName: old ? "Account A" : "Account B",
          body: old ? "Private old A message" : "B message",
          createdAt: accountA.createdAt,
        },
      ],
    });
  });
  await page.route("**/api/users/7", async (route) => {
    profileCalls++;
    const old = profileCalls === 1;
    if (old) await oldProfile.promise;
    await route.fulfill({
      json: {
        id: 7,
        name: old ? "Old private profile" : "Fresh profile",
        subjects: [],
        createdAt: accountA.createdAt,
      },
    });
  });
  await page.goto("/profile/7");
  await expect.poll(() => profileCalls).toBe(1);
  await page.getByRole("button", { name: "Open chat" }).click();
  await expect.poll(() => chatCalls).toBe(1);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => aborted).toContain("/api/chat/rooms/1/messages");
  await expect.poll(() => aborted).toContain("/api/users/7");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Log in", exact: true })
    .click();
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  oldChat.resolve();
  oldProfile.resolve();
  await expect(page.getByText("B message", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Private old A message", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page.locator('input[type="email"]')).toHaveValue(accountB.email);
  await page.evaluate(() => window.history.pushState({}, "", "/profile/7"));
  await expect(
    page.getByRole("heading", { name: "Fresh profile", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Old private profile", { exact: true }),
  ).toHaveCount(0);
});

test("network failures keep session retry and failed-logout drafts visible", async ({
  page,
}) => {
  await fallback(page);
  let offline = true;
  await page.route("**/api/auth/me", (route) =>
    offline ? route.abort("failed") : route.fulfill({ json: accountA }),
  );
  await page.route("**/api/auth/logout", (route) => route.abort("failed"));
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "Retry session" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  offline = false;
  await page.getByRole("button", { name: "Retry session" }).click();
  const name = page.locator('input[type="text"]').first();
  await name.fill("Keep this draft");
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn't log out");
  await expect(name).toHaveValue("Keep this draft");
});

test("a profile save completing after logout cannot restore the previous member", async ({
  page,
}) => {
  await fallback(page);
  let user: typeof accountA | null = accountA;
  const saved = deferred();
  const delivered = deferred();
  let saves = 0;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill(user ? { json: user } : { status: 401, json: {} }),
  );
  await page.route("**/api/auth/logout", (route) => {
    user = null;
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/auth/login", (route) => {
    user = accountB;
    return route.fulfill({ json: { user, message: "ok" } });
  });
  await page.route("**/api/users/1", async (route) => {
    saves++;
    await saved.promise;
    await route.fulfill({ json: accountA });
    delivered.resolve();
  });
  await page.goto("/settings");
  await page.locator('input[type="text"]').first().fill("A delayed edit");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => saves).toBe(1);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  saved.resolve();
  await delivered.promise;
  await expect(
    page.getByRole("button", { name: "Log out", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Log in", exact: true })
    .click();
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page.locator('input[type="email"]')).toHaveValue(accountB.email);
  await expect(page.locator('input[type="text"]').first()).toHaveValue(
    accountB.name,
  );
});
