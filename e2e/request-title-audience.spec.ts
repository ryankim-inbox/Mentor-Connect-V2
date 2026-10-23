import { test, expect } from "@playwright/test";
import { fixtures, signedInUser, request as requestFixture } from "./fixtures";

test("title boundaries count spaces and Unicode, and publication retains its chosen audience", async ({ page }) => {
  let published: Record<string, unknown> | undefined;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/requests" && route.request().method() === "POST") {
      published = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { ...requestFixture, ...published, authorId: signedInUser.id } });
    }
    if (path === "/api/requests/11") return route.fulfill({ json: { ...requestFixture, ...published, authorId: signedInUser.id } });
    return route.fulfill({ json: path === "/api/auth/me" ? signedInUser : path === "/api/dms/unread" ? { unreadCount: 0, conversations: [] } : (fixtures[path] ?? []) });
  });
  await page.goto("/requests/new");
  const title = page.getByLabel("Request title", { exact: true });
  const post = page.getByRole("button", { name: "Post request", exact: true });
  for (const n of [59, 60, 61]) {
    await title.fill("😀".repeat(n));
    await expect(page.getByText(`${n}/60 characters, including spaces`, { exact: true })).toBeVisible();
    if (n > 60) await expect(post).toBeDisabled();
    else await expect(post).toBeEnabled();
  }
  await title.fill(" " + "가".repeat(60));
  await expect(post).toBeDisabled();
  const raw = " " + "가".repeat(59);
  await title.fill(raw);
  await page.locator("textarea").fill("Synthetic local request");
  await page.getByLabel("Who can see this request?").selectOption("male");
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await post.click();
  await expect(page).toHaveURL(/\/requests\/11$/);
  expect(published?.title).toBe(raw);
  expect(published?.audience).toBe("male");
  await expect(page.getByText("Audience: Male students", { exact: true })).toBeVisible();
});
