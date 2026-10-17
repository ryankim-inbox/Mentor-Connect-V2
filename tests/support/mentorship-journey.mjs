import { expect } from '@playwright/test';

// Only called by the disposable HTTPS harness, never against a public origin.
export async function runMentorshipJourney({ origin, credentials }, browser, restart) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [mentor, owner] = await Promise.all(contexts.map(c => c.newPage()));
    for (const [page, account] of [[mentor, credentials.accounts.mentor], [owner, credentials.accounts.mentee]]) {
      await page.goto(origin + '/login');
      await page.getByLabel('School email').fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    await owner.goto(origin + '/requests/new');
    await owner.getByPlaceholder('e.g. Need help with AP Calculus BC').fill('E2E TEST consent journey');
    await owner.getByPlaceholder("Describe what you're looking for, your background, and your goals...").fill('E2E TEST isolated local database only');
    await owner.getByRole('button', { name: 'Math', exact: true }).click();
    await owner.getByRole('button', { name: 'Post request', exact: true }).click();
    await expect(owner).toHaveURL(/\/requests\/\d+$/);
    const detail = owner.url();
    await mentor.goto(detail);
    await mentor.getByLabel('Comment', { exact: true }).fill('E2E TEST question <script>text only</script>');
    await mentor.getByRole('button', { name: 'Post comment', exact: true }).click();
    await expect(mentor.getByText('E2E TEST question <script>text only</script>', { exact: true })).toHaveCount(1);
    await mentor.getByRole('button', { name: 'Apply to connect', exact: true }).click();
    await expect(mentor.getByText('Application pending', { exact: true })).toBeVisible();
    await owner.reload();
    await owner.getByRole('button', { name: 'Reply', exact: true }).click();
    await owner.getByLabel('Comment', { exact: true }).fill('E2E TEST author reply');
    await owner.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(owner.getByText('E2E TEST author reply', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: /^Accept / }).click();
    await expect(owner.getByRole('heading', { name: 'This request has been matched' })).toBeVisible();
    await mentor.reload();
    for (const page of [mentor, owner]) {
      await page.getByRole('button', { name: /^Message / }).click();
      await expect(page.getByPlaceholder('Type a message…')).toBeVisible();
    }
    const input = mentor.getByPlaceholder('Type a message…');
    await input.fill('E2E TEST one named DM');
    // Two synchronous submits exercise the real UI and database dedup boundary.
    await mentor.locator('form').filter({ has: input }).evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    for (const page of [mentor, owner]) await expect(page.getByText('E2E TEST one named DM', { exact: true })).toHaveCount(1);
    await restart();
    for (const page of [mentor, owner]) {
      await page.goto(detail);
      await expect(page.getByRole('heading', { name: 'This request has been matched' })).toBeVisible();
      await expect(page.getByText('E2E TEST author reply', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /^Message / }).click();
      await expect(page.getByText('E2E TEST one named DM', { exact: true })).toHaveCount(1);
      await page.goto(origin + '/connections');
      await expect(page.getByRole('heading', { name: 'My connections', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Message / }).first()).toBeVisible();
    }
    console.log(JSON.stringify({task:'local-https-mentorship-journey',result:'PASS',checks:['two-independent-sessions','create-comment-reply','pending-before-owner-acceptance','named-dm','same-turn-send-once','restart-persistence','connections-deep-link']}));
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
