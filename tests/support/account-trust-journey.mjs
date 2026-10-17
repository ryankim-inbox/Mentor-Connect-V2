import { expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Called only with the protected outbox of this disposable HTTPS test process.
export async function runAccountTrustJourney({ origin, outbox }, browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin + "/register");
    await page.getByLabel("Full name").fill("E2E TEST Ownership Member");
    await page.getByLabel(/School email/).fill("ownership-browser@test.edu");
    await page.getByLabel("Password", { exact: true }).fill("Password123!");
    await page.getByRole("button", { name: "Both", exact: true }).click();
    await page.getByLabel("District choices").selectOption("1");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/\/verify-email$/);
    const before = await context.request.get(origin + "/api/auth/me");
    expect((await before.json()).isVerified).toBe(false);
    expect((await context.request.get(origin + "/api/mentors")).status()).toBe(
      403,
    );
    expect(
      (await context.request.get(origin + "/api/chat/rooms")).status(),
    ).toBe(403);
    await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Send verification email" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Verification email sent." }),
    ).toBeVisible();
    expect(statSync(outbox).mode & 0o777).toBe(0o700);
    const files = readdirSync(outbox).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    const file = path.join(outbox, files[0]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    let delivery, confirmation;
    try {
      delivery = JSON.parse(readFileSync(file, "utf8"));
      confirmation = new URL(delivery.confirmationUrl);
    } catch {
      throw new Error(
        "Invalid protected local test delivery (content redacted)",
      );
    }
    if (confirmation.origin !== origin)
      throw new Error("Unexpected confirmation origin");
    const token = new URL(delivery.confirmationUrl).hash.slice(
      "#token=".length,
    );
    // Deliberately avoid assertions/errors which can print the secret URL or token.
    await page.goto(delivery.confirmationUrl).catch(() => {
      throw new Error("Local confirmation navigation failed (URL redacted)");
    });
    await expect.poll(() => new URL(page.url()).hash === "").toBe(true);
    expect(
      (await (await context.request.get(origin + "/api/auth/me")).json())
        .isVerified,
    ).toBe(false);
    const noLeaks = await page.evaluate(
      (secret) =>
        !document.body.textContent.includes(secret) &&
        !JSON.stringify([localStorage, sessionStorage]).includes(secret),
      token,
    );
    expect(noLeaks).toBe(true);
    await page.getByRole("button", { name: "Confirm email ownership" }).click();
    await expect(
      page.getByText("Your email is verified.", { exact: true }),
    ).toBeVisible();
    const after = await (
      await context.request.get(origin + "/api/auth/me")
    ).json();
    expect(after.isVerified).toBe(true);
    expect(after.isAdmin).toBe(false);
    expect(
      (
        await context.request.get(origin + "/api/analytics/weekly-matches")
      ).status(),
    ).toBe(403);
    await page.getByRole("link", { name: "Find mentors", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Find a mentor", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sophia Lee", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Sophia Lee", exact: true }).click();
    await page
      .getByRole("button", { name: "Block member", exact: true })
      .click();
    await expect(
      page.getByText("Member blocked.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sophia Lee", exact: true }),
    ).toHaveCount(0);
    expect(
      (await context.request.get(origin + "/api/users/501")).status(),
    ).toBe(403);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Member profile unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(origin + "/settings");
    await page
      .getByRole("button", { name: "Unblock Sophia Lee", exact: true })
      .click();
    await expect(
      page.getByText("No blocked members.", { exact: true }),
    ).toBeVisible();
    expect(
      (await context.request.get(origin + "/api/users/501")).status(),
    ).toBe(200);
    await page.goto(origin + "/requests/new");
    await page
      .getByPlaceholder("e.g. Need help with AP Calculus BC")
      .fill("E2E TEST ownership action");
    await page
      .getByPlaceholder(
        "Describe what you're looking for, your background, and your goals...",
      )
      .fill("Verified through the real protected local outbox");
    await page.getByRole("button", { name: "Math", exact: true }).click();
    await page
      .getByRole("button", { name: "Post request", exact: true })
      .click();
    await expect(page).toHaveURL(/\/requests\/\d+$/);
    console.log(
      JSON.stringify({
        task: "local-https-account-trust",
        result: "PASS",
        checks: [
          "real-registration-unverified",
          "member-and-chat-denial",
          "explicit-dev-delivery",
          "protected-outbox",
          "fragment-scrub",
          "no-navigation-confirm",
          "explicit-confirmation",
          "no-browser-storage-secret",
          "fresh-ownership",
          "student-admin-denial",
          "mentor-discovery",
          "verified-request-creation",
          "block-revokes-profile-with-generic-success",
          "settings-unblock-restores-visibility",
        ],
      }),
    );
  } finally {
    await context.close();
  }
}
