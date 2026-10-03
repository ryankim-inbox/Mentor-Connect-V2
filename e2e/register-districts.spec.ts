import { test, expect, type Page } from "@playwright/test";

const district = {
  id: 1,
  name: "School A",
  county: "Test",
  type: "high_school",
  memberCount: 0,
  openRequestCount: 0,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fillAccount(page: Page) {
  await page.getByLabel("Full name").fill("Tester");
  await page.getByLabel("School email").fill("tester@school.edu");
  await page.getByLabel("Password", { exact: true }).fill("Password123!");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
});

test("districts show loading before options arrive", async ({ page }) => {
  const response = deferred();
  let registerCalls = 0;
  await page.route("**/api/auth/register", (route) => {
    registerCalls++;
    return route.fulfill({ status: 500, json: { error: "unexpected registration" } });
  });
  await page.route("**/api/districts?**", async (route) => {
    await response.promise;
    await route.fulfill({ json: [district] });
  });
  try {
    await page.goto("/register");
    await fillAccount(page);
    await expect(page.getByText("Loading districts...")).toBeVisible();
    await expect(page.getByLabel("District choices")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(registerCalls).toBe(0);
  } finally {
    response.resolve();
  }
  await expect(page.getByLabel("District choices")).toBeEnabled();
  await expect(page.getByText("Loading districts...")).toHaveCount(0);
  await expect(page.getByRole("option", { name: "School A (Test County)" })).toHaveCount(1);
});

test("district failure can be retried without losing form data", async ({ page }) => {
  let unavailable = true;
  let registerCalls = 0;
  await page.route("**/api/auth/register", (route) => {
    registerCalls++;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.route("**/api/districts?**", (route) => route.fulfill(
    unavailable ? { status: 504, json: { error: "upstream_timeout" } } : { json: [district] },
  ));
  await page.goto("/register");
  await fillAccount(page);
  await expect(page.getByText("Couldn't load school districts. Please try again.")).toBeVisible();
  await expect(page.getByLabel("District choices")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  unavailable = false;
  await page.getByRole("button", { name: "Retry districts" }).click();
  await expect(page.getByLabel("District choices")).toBeEnabled();
  await expect(page.getByRole("option", { name: "School A (Test County)" })).toHaveCount(1);
  await expect(page.getByText("Couldn't load school districts. Please try again.")).toHaveCount(0);
  await expect(page.getByLabel("Full name")).toHaveValue("Tester");
  await expect(page.getByLabel("School email")).toHaveValue("tester@school.edu");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("Password123!");
  expect(registerCalls).toBe(0);
});

test("successful empty results distinguish search from unavailable data", async ({ page }) => {
  await page.route("**/api/districts?**", (route) => route.fulfill({ json: [] }));
  await page.goto("/register");
  await expect(page.getByText("No school districts are available.")).toBeVisible();
  await page.getByLabel("School district", { exact: true }).fill("missing");
  await expect(page.getByText("No districts match your search.")).toBeVisible();
  await expect(page.getByText("No school districts are available.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry districts" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
});

test("clearing search restores options and permits selection", async ({ page }) => {
  await page.route("**/api/districts?**", (route) => route.fulfill({
    json: new URL(route.request().url()).searchParams.has("search") ? [] : [district],
  }));
  await page.goto("/register");
  await fillAccount(page);
  await page.getByLabel("School district", { exact: true }).fill("missing");
  await expect(page.getByText("No districts match your search.")).toBeVisible();
  await page.getByLabel("School district", { exact: true }).clear();
  await expect(page.getByRole("option", { name: "School A (Test County)" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  await page.getByLabel("District choices").selectOption("1");
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
});

test("changing search clears a previous district selection", async ({ page }) => {
  await page.route("**/api/districts?**", (route) => route.fulfill({ json: [district] }));
  await page.goto("/register");
  await fillAccount(page);
  await page.getByLabel("District choices").selectOption("1");
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  await page.getByLabel("School district", { exact: true }).fill("School");
  await expect(page.getByLabel("District choices")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
});

test("late search responses cannot replace current choices", async ({ page }) => {
  const older = deferred();
  const delivered = deferred();
  await page.route("**/api/districts?**", async (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    if (search === "A") {
      await older.promise;
      await route.fulfill({ json: [district] });
      delivered.resolve();
    } else {
      await route.fulfill({ json: [{ ...district, id: 2, name: "School B" }] });
    }
  });
  await page.goto("/register");
  const firstRequest = page.waitForRequest((request) =>
    request.url().includes("/api/districts?") && new URL(request.url()).searchParams.get("search") === "A",
  );
  await page.getByLabel("School district", { exact: true }).fill("A");
  await firstRequest;
  try {
    await page.getByLabel("School district", { exact: true }).fill("B");
    await expect(page.getByRole("option", { name: "School B (Test County)" })).toHaveCount(1);
  } finally {
    older.resolve();
  }
  await delivered.promise;
  await expect(page.getByRole("option", { name: "School A (Test County)" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "School B (Test County)" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
});

test("background refresh failure prevents submitting a cached selection", async ({ page }) => {
  await page.clock.install();
  let unavailable = false;
  let registerCalls = 0;
  await page.route("**/api/auth/register", (route) => {
    registerCalls++;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.route("**/api/districts?**", (route) => route.fulfill(
    unavailable ? { status: 504, json: { error: "upstream_timeout" } } : { json: [district] },
  ));
  await page.goto("/register");
  await fillAccount(page);
  await page.getByLabel("District choices").selectOption("1");
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  unavailable = true;
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("Couldn't load school districts. Please try again.")).toBeVisible();
  await expect(page.getByLabel("District choices")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  // Enter/programmatic form submission must also honor query failure.
  await page.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(registerCalls).toBe(0);
});
