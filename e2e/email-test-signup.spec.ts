import { test, expect, type Page } from "@playwright/test";
import { fixtures, signedInUser } from "./fixtures";

// Browser/API mocks only: these tests do not create accounts or deliver mail.
const signupPassword = "Password123!";
const testMember = {
  ...signedInUser,
  name: "Email Test Member",
  email: "student@gmail.com",
  role: "mentee",
  isVerified: false, hasMemberAccess: true,
  isAdmin: false,
};
const acceptedMessage =
  "Verification email accepted for delivery. Open the newest link within 30 minutes. Resends require at least 60 seconds.";

async function setup(page: Page, signedIn = false) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill(
        signedIn ? { json: testMember } : { status: 401, json: {} },
      );
    return route.fulfill({ json: fixtures[path] ?? [] });
  });
}

async function fillRegistration(page: Page, email: string) {
  await page.getByLabel("Full name").fill(testMember.name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(signupPassword);
  await page.getByLabel("Gender", { exact: true }).selectOption("female");
  await page.getByLabel("Date of birth").fill("2008-02-29");
  await page.getByLabel("District choices").selectOption("1");
}

test("non-.edu signup reaches the server once and a rejection preserves the form", async ({
  page,
}) => {
  await setup(page);
  await page.clock.install();
  const submissions: unknown[] = [];
  await page.route("**/api/auth/register", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: 422, json: { error: "validation_error" } });
  });
  await page.goto("/register");
  await fillRegistration(page, "unapproved@example.com");
  const submit = page.getByRole("button", {
    name: "Create account",
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Check the input and try again.",
  );
  await page.clock.fastForward(61_000);
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel("Full name")).toHaveValue(testMember.name);
  await expect(page.getByLabel("Email")).toHaveValue(
    "unapproved@example.com",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    signupPassword,
  );
  await expect(page.getByLabel("District choices")).toHaveValue("1");
  await expect(submit).toBeEnabled();
  expect(submissions).toEqual([
    {
      name: testMember.name,
      email: "unapproved@example.com",
      password: signupPassword,
      gender: "female",
      dateOfBirth: "2008-02-29",
      role: "mentee",
      districtId: 1,
    },
  ]);
});

test("server-accepted signup keeps ownership unverified, opens member features and denies administrator access", async ({
  page,
}) => {
  await setup(page);
  let registered = false;
  let registrationCalls = 0;
  let sends = 0;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill(
      registered ? { json: testMember } : { status: 401, json: {} },
    ),
  );
  await page.route("**/api/auth/register", (route) => {
    registrationCalls++;
    registered = true;
    return route.fulfill({
      status: 201,
      json: { user: testMember, message: "ok" },
    });
  });
  await page.route("**/api/auth/verification/request", (route) => {
    sends++;
    return route.fulfill({ json: { message: "accepted" } });
  });
  await page.goto("/register?returnTo=%2Frequests");
  await fillRegistration(page, testMember.email);
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
  await expect(page.getByText("Email ownership unverified · Verification is optional for member access.")).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Mentors", exact: true })).toBeVisible();
  await expect(page.getByText("Your email is verified.", { exact: true })).toHaveCount(0);
  await page.goto("/admin/reports");
  await expect(page.getByText("Administrator access required", { exact: true })).toBeVisible();
  for (const label of ["Reports", "Analytics", "Scheduling"])
    await expect(page.getByRole("navigation").getByRole("link", { name: label, exact: true })).toHaveCount(0);
  expect(registrationCalls).toBe(1);
  expect(sends).toBe(0);
});

test("signup explains that valid email addresses from any domain are accepted", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/register");
  await expect(page.getByLabel("Email")).toHaveAccessibleDescription(
    "Use a valid email address. Any email domain is welcome.",
  );
});

test("native email syntax validation still prevents malformed signup requests", async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route("**/api/auth/register", (route) => {
    calls++;
    return route.fulfill({ status: 422, json: { error: "validation_error" } });
  });
  await page.goto("/register");
  await fillRegistration(page, "not-an-email");
  await expect(page.getByLabel("Email")).toHaveAttribute(
    "type",
    "email",
  );
  await page
    .locator("form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(
    await page
      .getByLabel("Email")
      .evaluate((input: HTMLInputElement) => input.validity.typeMismatch),
  ).toBe(true);
  expect(calls).toBe(0);
  await expect(page).toHaveURL(/\/register$/);
});

test("verification send reports acceptance for delivery only after a successful response", async ({
  page,
}) => {
  await setup(page, true);
  await page.clock.install();
  let sends = 0;
  await page.route("**/api/auth/verification/request", (route) => {
    sends++;
    return route.fulfill({ json: { message: "accepted" } });
  });
  await page.goto("/verify-email");
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(acceptedMessage);
  await page.clock.fastForward(61_000);
  expect(sends).toBe(1);
  await expect(
    page.getByText("Your email is verified.", { exact: true }),
  ).toHaveCount(0);
});

test("an uncertain verification send shows an error without success or automatic retry", async ({
  page,
}) => {
  await setup(page, true);
  await page.clock.install();
  let sends = 0;
  await page.route("**/api/auth/verification/request", (route) => {
    sends++;
    return route.fulfill({
      status: 503,
      json: { error: "upstream_unavailable" },
    });
  });
  await page.goto("/verify-email");
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "We had a connection problem. Please try again.",
  );
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByText("Your email is verified.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send verification email", exact: true }),
  ).toBeEnabled();
  expect(sends).toBe(1);
});
