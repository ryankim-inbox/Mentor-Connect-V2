// Real local stack only: no route interception, response fixtures, or API mocks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { openSync, closeSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createGatewayServer } from "../../artifacts/api-gateway/dist/gateway.js";
import { bootstrapClassroom } from "../../ops/bootstrap-classroom.mjs";
import { seedSyntheticClassroom, SYNTHETIC_PASSWORD_LOCK } from "../../ops/seed-synthetic-classroom.mjs";
import { verifySchemaAssets } from "../../lib/db/tools/schema-assets.mjs";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const root = process.cwd();
const dsn = process.env.SYNTHETIC_UI_DATABASE_URL;
const temp = process.env.SYNTHETIC_UI_TMP;
const target = new URL(dsn);
assert.ok(temp && target.hostname === "127.0.0.1" && /^\/chat_test_[a-f0-9]+$/.test(target.pathname), "Disposable loopback database required");
const db = new Client({ connectionString: dsn });
await db.connect();
const rows = async (query, values = []) => (await db.query(query, values)).rows;
async function freePort() {
  const finder = createServer();
  await new Promise((resolve) => finder.listen(0, "127.0.0.1", resolve));
  const port = finder.address().port;
  await new Promise((resolve) => finder.close(resolve));
  return port;
}

let python, gateway, browser, backendLog;
try {
  const { ledger } = await verifySchemaAssets({ rootDir: root });
  await bootstrapClassroom({ client: db, ledger, appSha: "00000000" });
  await db.query(readFileSync("tests/fixtures/chat-canonical.sql", "utf8"));
  await db.query(readFileSync("tests/fixtures/account-trust-verified.sql", "utf8"));
  await db.query("UPDATE users SET is_admin=true WHERE id=501");
  await db.query("INSERT INTO tags(id,name,color) VALUES (2,'Physics','#aa0000'),(3,'Chemistry','#00aa00'),(4,'English','#0000aa'),(5,'History','#aaaa00'),(6,'Biology','#aa00aa')");
  // Disposable fixture tracking predates all seeded events, making all eight weeks observable.
  await db.query("UPDATE request_events SET occurred_at=now()-interval '70 days' WHERE kind='tracking_started'");
  const baseline = (await rows("SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM questions) AS questions,(SELECT count(*)::int FROM requests) AS requests"))[0];
  const asOf = (await rows("SELECT now() AS now"))[0].now.toISOString();
  const seeded = await seedSyntheticClassroom({ client: db, asOf, apply: true });
  assert.equal(seeded.operation, "inserted");
  const totals = (await rows("SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM questions) AS questions,(SELECT count(*)::int FROM requests) AS requests"))[0];
  assert.deepEqual(totals, { users: baseline.users + 983, questions: baseline.questions + 782, requests: baseline.requests + 782 });
  const locked = (await rows("SELECT count(*)::int AS n FROM users WHERE password_hash=$1 AND email_verified_at IS NULL AND is_verified=false AND is_admin=false", [SYNTHETIC_PASSWORD_LOCK]))[0].n;
  assert.equal(locked, 983);

  // Independent SQL oracles do not use the seed plan or Python reporting functions.
  const summary = (await rows(`SELECT
    count(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC')::date=(now() AT TIME ZONE 'UTC')::date)::int AS today,
    count(*) FILTER (WHERE date_trunc('month',created_at AT TIME ZONE 'UTC')=date_trunc('month',now() AT TIME ZONE 'UTC'))::int AS "thisMonth",
    count(*) FILTER (WHERE date_trunc('year',created_at AT TIME ZONE 'UTC')=date_trunc('year',now() AT TIME ZONE 'UTC'))::int AS "thisYear",
    count(*)::int AS total FROM users`))[0];
  const subjects = await rows(`SELECT t.name AS subject,count(rt.request_id)::int AS requests,t.color
    FROM tags t JOIN request_tags rt ON rt.tag_id=t.id GROUP BY t.id ORDER BY requests DESC,t.id LIMIT 10`);
  const weekly = await rows(`SELECT to_char(w.week,'YYYY-MM-DD') AS week,count(e.id)::int AS matches,'complete' AS coverage
    FROM generate_series(date_trunc('week',now() AT TIME ZONE 'UTC')-interval '7 weeks',date_trunc('week',now() AT TIME ZONE 'UTC'),interval '1 week') AS w(week)
    LEFT JOIN request_events e ON e.kind='matched' AND e.occurred_at AT TIME ZONE 'UTC'>=w.week
      AND e.occurred_at AT TIME ZONE 'UTC'<w.week+interval '1 week' AND e.occurred_at<=now()
    GROUP BY w.week ORDER BY w.week`);
  const feed = async (offset = 0, tag = null) => rows(`SELECT r.id,r.title FROM requests r WHERE r.status='open'
    AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM request_tags rt WHERE rt.request_id=r.id AND rt.tag_id=$1))
    ORDER BY r.created_at DESC,r.id DESC LIMIT 50 OFFSET $2`, [tag, offset]);
  const firstPage = await feed();
  const secondPage = await feed(50);
  const mathPage = await feed(0, 1);
  assert.equal(firstPage.length, 50);
  assert.equal(secondPage.length, 50);
  assert.equal(mathPage.length, 50);

  const backendPort = await freePort();
  const gatewayPort = await freePort();
  const origin = `http://127.0.0.1:${gatewayPort}`;
  backendLog = openSync(path.join(temp, "python.log"), "w", 0o600);
  python = spawn(process.env.CLASSROOM_TEST_PYTHON || path.join(root, ".venv/bin/python"), [
    "-m", "uvicorn", "main:app", "--app-dir", "Python", "--host", "127.0.0.1", "--port", String(backendPort), "--no-access-log",
  ], { stdio: ["ignore", backendLog, backendLog], env: {
    ...process.env, DATABASE_URL: dsn, PYTHON_DOTENV_DISABLED: "1", NODE_ENV: "test",
    SESSION_SECRET: "synthetic-ui-disposable-session-secret", EMAIL_DELIVERY_MODE: "disabled",
    EMAIL_TEST_ALLOWLIST_ENABLED: "false", TEST_MEMBER_ACCESS_ENABLED: "false",
    TEST_MEMBER_MENTOR_ID: "", TEST_MEMBER_MENTEE_ID: "", APP_ORIGIN: origin, GATEWAY_PUBLIC_ORIGIN: origin,
  } });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/healthz`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    if (attempt === 99 || python.exitCode !== null) throw new Error("Synthetic UI Python server failed to start");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  gateway = createGatewayServer({ publicOrigin: origin, allowLoopbackPublicOrigin: true,
    upstreamOrigin: `http://127.0.0.1:${backendPort}`, staticDirectory: path.join(root, "artifacts/peerbridge/dist/public"), logger: { info() {} } });
  await new Promise((resolve) => gateway.listen(gatewayPort, "127.0.0.1", resolve));
  // External fonts/preconnects cannot leave loopback. This is transport isolation,
  // not route interception; every app/API request reaches the actual stack.
  browser = await chromium.launch({ proxy: { server: "http://127.0.0.1:9", bypass: "127.0.0.1,localhost" },
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] });
  const admin = await browser.newContext();
  const member = await browser.newContext();
  async function login(context, email) {
    const page = await context.newPage();
    await page.goto(origin + "/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Password123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    return page;
  }
  const page = await login(admin, "mentor501@test.edu");
  const responseFor = (pathname) => page.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === "GET");
  const unwrap = async (response) => {
    assert.equal(response.status(), 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    return payload.data;
  };
  const signupResponse = responseFor("/api/python-reports/summary");
  await page.goto(origin + "/admin/reports");
  assert.deepEqual(await unwrap(await signupResponse), summary);
  const summarySection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Signup summary", exact: true }) });
  for (const [label, key] of [["Today", "today"], ["This month", "thisMonth"], ["This year", "thisYear"], ["Total", "total"]]) {
    const metric = summarySection.getByText(label, { exact: true }).locator("..");
    await expect(metric.locator("p").first()).toHaveText(String(summary[key]));
  }
  await summarySection.screenshot({ path: path.join(temp, "signup-summary.png") });

  const weeklyResponse = responseFor("/api/analytics/weekly-matches");
  const subjectResponse = responseFor("/api/analytics/popular-subjects");
  await page.goto(origin + "/analytics");
  assert.deepEqual(await unwrap(await weeklyResponse), weekly);
  assert.deepEqual(await unwrap(await subjectResponse), subjects);
  const subjectPanel = page.getByRole("heading", { name: "Most requested subjects", exact: true }).locator("../..");
  for (const subject of subjects) {
    const item = subjectPanel.getByText(subject.subject, { exact: true }).locator("..");
    await expect(item.locator("span").last()).toHaveText(String(subject.requests));
  }
  const weeklyPanel = page.getByRole("heading", { name: "Weekly matches", exact: true }).locator("../..");
  for (const week of weekly) {
    const item = weeklyPanel.getByText(week.week, { exact: true }).locator("..");
    await expect(item.locator("span").last()).toHaveText(String(week.matches));
    await expect(item.locator("..").locator("[title]")).toHaveAttribute("title", `${week.matches} observed matches (complete)`);
  }
  await weeklyPanel.screenshot({ path: path.join(temp, "weekly-matches.png") });
  await subjectPanel.screenshot({ path: path.join(temp, "subject-demand.png") });

  async function assertFeed(response, expected) {
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.deepEqual(data.map(({ id, title }) => ({ id, title })), expected);
    await expect(page.getByText(`${expected.length} requests shown`, { exact: true })).toBeVisible();
    const cards = page.locator('a[href^="/requests/"]').filter({ has: page.locator("h3") });
    await expect(cards).toHaveCount(expected.length);
    await expect(cards.locator("h3")).toHaveText(expected.map((row) => row.title));
    assert.deepEqual(await cards.evaluateAll((links) => links.map((link) => Number(link.getAttribute("href").split("/").at(-1)))), expected.map((row) => row.id));
  }
  let feedResponse = responseFor("/api/requests");
  await page.goto(origin + "/requests");
  await assertFeed(await feedResponse, firstPage);
  feedResponse = responseFor("/api/requests");
  await page.getByRole("button", { name: "Older requests", exact: true }).click();
  await assertFeed(await feedResponse, secondPage);
  assert.equal(firstPage.some((row) => secondPage.some((other) => row.id === other.id)), false);
  feedResponse = responseFor("/api/requests");
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await assertFeed(await feedResponse, mathPage);
  await expect(page.getByRole("button", { name: "Newer requests", exact: true })).toBeDisabled();
  await page.screenshot({ path: path.join(temp, "filtered-requests.png") });
  // Gateway rejects an out-of-contract query before FastAPI body validation.
  assert.equal((await admin.request.get(origin + "/api/requests?limit=983")).status(), 400);

  const ordinary = await login(member, "student001@test.edu");
  for (const endpoint of ["/api/admin/reports", "/api/python-reports/summary", "/api/analytics/weekly-matches", "/api/analysis/status"]) {
    assert.equal((await member.request.get(origin + endpoint)).status(), 403, endpoint);
  }
  for (const pathname of ["/admin/reports", "/analytics"]) {
    await ordinary.goto(origin + pathname);
    await expect(ordinary.getByText("Administrator access required", { exact: true })).toBeVisible();
    await expect(ordinary.getByRole("heading", { name: "Signup summary", exact: true })).toHaveCount(0);
  }
  assert.equal((await member.request.get(origin + "/api/requests?limit=50")).status(), 200);
  console.log(JSON.stringify({ task: "synthetic-db-api-ui", result: "PASS", baseline, totals,
    syntheticUsers: locked, signupSummary: summary, subjectGroups: subjects.length, weeklyBuckets: weekly.length,
    pageSize: firstPage.length, distinctSecondPage: true, subjectFilter: "Math", ordinaryAdminApisDenied: 4,
    ordinaryAdminPagesDenied: 2, apiInterception: false, externalNetwork: "blocked-by-loopback-proxy" }));
} finally {
  await browser?.close();
  gateway?.closeWebSockets();
  gateway?.closeAllConnections();
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  if (python && python.exitCode === null) { python.kill("SIGTERM"); await once(python, "exit"); }
  if (backendLog !== undefined) closeSync(backendLog);
  await db.end();
}
