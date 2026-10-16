import { test, expect } from "@playwright/test";
import { fixtureAccounts, fixturePassword } from "./fixtures";

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:18181/__fixture/reset");
  await page.goto("/login");
  await page.getByLabel("School email").fill(fixtureAccounts.mentor.email);
  await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "Open chat" }).click();
});

for (const kind of ["room", "dm"] as const) {
  test(`${kind} composer locks synchronous repeated submits and reuses a failed operation key`, async ({ page, request }) => {
    if (kind === "dm") {
      await request.post("http://127.0.0.1:18181/__fixture/failure", { data: { method: "GET", path: "/api/dms/1/messages", status: 200, body: [] } });
      await page.getByRole("tab", { name: "DMs", exact: true }).click();
      await page.getByRole("button", { name: "Classroom Mentee", exact: false }).click();
    }
    const url = kind === "room" ? "**/api/chat/rooms/1/messages" : "**/api/dms/1/messages";
    const sent: { body: string; clientMessageId?: string }[] = [];
    await page.route(url, async route => {
      if (route.request().method() !== "POST") return route.continue();
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
    });
    const input = page.getByPlaceholder("Type a message…");
    await input.fill("E2E TEST retry once");
    // Two events in one turn reproduce the gap before React renders isPending.
    await page.locator("form").filter({ has: input }).evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page.getByRole("alert")).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(input).toHaveValue("E2E TEST retry once");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual(sent[0]);
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
    await input.fill("E2E TEST a different draft");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => sent.length).toBe(3);
    expect(sent[2].clientMessageId).not.toBe(sent[0].clientMessageId);
  });
}
