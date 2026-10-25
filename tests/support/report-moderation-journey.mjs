import { expect } from "@playwright/test";

// Real browser/gateway/Python/PostgreSQL composition in the disposable TLS harness.
export async function runReportModerationJourney({ origin, db }, browser) {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    await db.query("UPDATE users SET is_admin=true WHERE id=501");
    const [student, admin] = contexts;
    for (const [context, email] of [
      [student, "student001@test.edu"],
      [admin, "mentor501@test.edu"],
    ]) {
      const login = await context.newPage();
      await login.goto(origin + "/login");
      await login.getByLabel("Email").fill(email);
      await login.getByLabel("Password", { exact: true }).fill("Password123!");
      await login.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(login).toHaveURL(/\/dashboard$/);
      await login.close();
    }
    const created = await student.request.post(origin + "/api/reports", {
      headers: { Origin: origin },
      data: {
        reportedUserId: 501,
        reason: "other",
        description: "E2E TEST moderation evidence",
      },
    });
    expect(created.status()).toBe(201);
    const reports = await admin.request.get(origin + "/api/admin/reports");
    expect(reports.status()).toBe(200);
    const reportId = (await reports.json())[0].id;
    const page = await admin.newPage();
    await page.goto(origin + "/admin/reports");
    const note = "Retain this ordinary saved moderation rationale";
    await page.getByLabel(`Internal note for report ${reportId}`).fill(note);
    await page
      .getByLabel(`Review status for report ${reportId}`)
      .selectOption("reviewing");
    const firstSave = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/admin/reports/${reportId}`),
    );
    await page
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    const firstResponse = await firstSave;
    expect(firstResponse.status()).toBe(200);
    const initialReview = await firstResponse.json();
    await expect(
      page.getByText(`Internal note: ${note}`, { exact: true }),
    ).toBeVisible();
    // Reload reconstructs an unchanged-note editor, so its next save omits note.
    await page.reload();
    await expect(
      page.getByLabel(`Internal note for report ${reportId}`),
    ).toHaveValue(note);
    await page
      .getByLabel(`Review status for report ${reportId}`)
      .selectOption("resolved");
    const statusSave = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/admin/reports/${reportId}`),
    );
    await page
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    const response = await statusSave;
    expect(response.request().postDataJSON()).toEqual({ status: "resolved" });
    expect(response.status()).toBe(200);
    const persisted = (
      await db.query(
        "SELECT status,note,reviewed_by,reviewed_at FROM reports WHERE id=$1",
        [reportId],
      )
    ).rows[0];
    expect(persisted.note).toBe(note);
    expect(persisted.status).toBe("resolved");
    expect(persisted.reviewed_by).toBe(501);
    expect(persisted.reviewed_at.getTime()).toBeGreaterThan(
      new Date(initialReview.reviewedAt).getTime(),
    );
    const saved = await response.json();
    expect(saved.note).toBe(note);
    expect(new Date(saved.reviewedAt).toISOString()).toBe(
      persisted.reviewed_at.toISOString(),
    );
    await page.reload();
    await expect(
      page.getByText(`Internal note: ${note}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel(`Review status for report ${reportId}`),
    ).toHaveValue("resolved");
    expect(
      (await student.request.get(origin + "/api/admin/reports")).status(),
    ).toBe(403);
    console.log(
      JSON.stringify({
        task: "local-https-report-moderation",
        result: "PASS",
        checks: [
          "browser-valid-note-save",
          "status-only-omits-note",
          "database-preserves-note",
          "audit-updated",
          "reload-retains-note",
          "student-read-denied",
        ],
      }),
    );
  } finally {
    await db.query("UPDATE users SET is_admin=false WHERE id=501");
    await Promise.all(contexts.map((context) => context.close()));
  }
}
