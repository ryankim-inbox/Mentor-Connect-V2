import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  const submissions: unknown[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ status: 401, json: {} });
    if (path === "/api/districts") return route.fulfill({ json: [
      { id: 1, name: "School", county: "Test", type: "high_school", memberCount: 0, openRequestCount: 0 },
    ] });
    if (path === "/api/auth/register") {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 422, json: { error: "validation_error" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/register");
  await page.getByLabel("Full name").fill("New Student");
  await page.getByLabel("School email").fill("new@school.edu");
  await page.getByLabel("District choices").selectOption("1");
  return submissions;
}

test("signup requires private fields with help and sends valid fields only after password checks", async ({ page }) => {
  const submissions = await setup(page);
  const gender = page.getByLabel("Gender", { exact: true });
  const birth = page.getByLabel("Date of birth");
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Create account", exact: true });
  await expect(gender).toHaveAccessibleDescription(/kept private/);
  await expect(birth).toHaveAccessibleDescription(/do not verify your age or school enrollment/);
  await expect(password).toHaveAccessibleDescription(/at least 12 characters/);
  await password.fill("Password123!");
  await submit.click();
  expect(submissions).toHaveLength(0);
  await gender.selectOption("female");
  await submit.click();
  expect(submissions).toHaveLength(0);
  await birth.fill("2008-02-29");
  for (const invalid of ["lowercase123!", "Uppercase1234", "A!" + "😀".repeat(9), "A!" + "😀".repeat(17) + "界"]) {
    await password.fill(invalid);
    await submit.click();
    await expect(page.getByRole("alert")).toHaveText(/at least 12 characters/);
    expect(submissions).toHaveLength(0);
  }
  await password.fill("A!" + "😀".repeat(10));
  await submit.click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toEqual({
    name: "New Student", email: "new@school.edu", password: "A!" + "😀".repeat(10),
    role: "mentee", districtId: 1, gender: "female", dateOfBirth: "2008-02-29",
  });
});

test("birth date cannot be in the future, including programmatic form submission", async ({ page }) => {
  const submissions = await setup(page);
  await page.getByLabel("Password", { exact: true }).fill("Password123!");
  await page.getByLabel("Gender", { exact: true }).selectOption("male");
  await page.getByLabel("Date of birth").fill("9999-12-31");
  // Bypass native constraints to exercise the form's own server-compatible guard.
  await page.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await expect(page.getByRole("alert")).toHaveText(/no later than today/);
  expect(submissions).toHaveLength(0);
});
