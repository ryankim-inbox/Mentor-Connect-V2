import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { fixtureAccounts, fixtureLoginEmail, fixturePassword } from "./fixtures";

const conversationId = 1;
const recipientId = fixtureAccounts.mentor.id;
const incoming = (id: number) => ({ id, conversationId, senderId: fixtureAccounts.mentee.id,
  body: `Incoming ${id}`, createdAt: "2026-10-23T12:00:00Z", readAt: null as string | null });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("School email").fill(fixtureLoginEmail("mentor", test.info().testId));
  await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function openDm(page: Page) {
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await page.getByRole("tab", { name: "DMs", exact: true }).click();
  await page.getByRole("button", { name: /Classroom Mentee/ }).click();
}

async function fixture(context: BrowserContext) {
  const state = { messages: [incoming(10)], reads: [] as number[][], countFetches: 0,
    beforeRead: async () => {}, history: undefined as undefined | ReturnType<typeof incoming>[] };
  const count = () => state.messages.filter(row => row.senderId !== recipientId && !row.readAt).length;
  await context.route("**/api/dms/unread", route => {
    state.countFetches++;
    return route.fulfill({ json: { unreadCount: count(), conversations: [{ conversationId, unreadCount: count() }] } });
  });
  await context.route(/\/api\/dms\/1\/messages(?:\?.*)?$/, route => {
    const before = Number(new URL(route.request().url()).searchParams.get("beforeId")) || Infinity;
    return route.fulfill({ json: (state.history ?? state.messages).filter(row => row.id < before).slice(-50) });
  });
  await context.route("**/api/dms/1/read", async route => {
    const ids: number[] = route.request().postDataJSON().messageIds;
    state.reads.push(ids);
    await state.beforeRead();
    for (const row of state.messages) if (ids.includes(row.id) && row.senderId !== recipientId) row.readAt ??= "2026-10-23T12:00:01Z";
    await route.fulfill({ json: { conversationId, unreadCount: count() } });
  });
  return state;
}

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:18181/__fixture/reset");
});

test("closed launcher uses canonical unread count and read acknowledges only exact rendered incoming IDs", async ({ page, context }) => {
  const state = await fixture(context);
  state.messages.push({ ...incoming(11), senderId: recipientId, body: "My own message" });
  let releaseRead!: () => void;
  state.beforeRead = () => new Promise<void>(resolve => { releaseRead = resolve; });
  await login(page);
  const badge = page.getByLabel("1 unread direct message", { exact: true });
  await expect(badge).toBeVisible();
  await expect(page.getByText("PeerBridge Chat", { exact: true })).toBeHidden();
  await openDm(page);
  await expect.poll(() => state.reads).toEqual([[10]]);
  state.history = state.messages;
  // Both an older late commit and a newer arrival were absent from the snapshot.
  state.messages = [incoming(9), ...state.messages, incoming(12)];
  state.beforeRead = async () => {};
  releaseRead();
  const remainingBadge = page.getByLabel("2 unread direct messages", { exact: true });
  await expect(remainingBadge).toBeVisible();
  await expect(page.getByText("Incoming 9", { exact: true })).toBeHidden();
  await expect(page.getByText("Incoming 12", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.reload();
  await expect(remainingBadge).toBeVisible();
  expect(state.reads).toEqual([[10]]);
  state.history = undefined;
  await openDm(page);
  await expect(page.getByText("Incoming 12", { exact: true })).toBeVisible();
  await expect.poll(() => state.reads).toEqual([[10], [9, 12]]);
  await expect(remainingBadge).toBeHidden();
});

test("hidden thread does not mark read and another tab converges after a visible read", async ({ page, context }) => {
  const state = await fixture(context);
  await login(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/dashboard");
  await expect(otherTab.getByLabel("1 unread direct message", { exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
  await openDm(page);
  await expect(page.getByText("Incoming 10", { exact: true })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(state.reads).toEqual([]);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => state.reads).toEqual([[10]]);
  await expect(otherTab.getByLabel("1 unread direct message", { exact: true })).toBeHidden();
});

test("duplicate socket events and reconnect reconcile counts without increments", async ({ page, context }) => {
  const state = await fixture(context);
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket("**/ws/dms/1", ws => { socket = ws; });
  await login(page);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
  await openDm(page);
  await expect(page.getByText("Incoming 10", { exact: true })).toBeVisible();
  await expect.poll(() => !!socket).toBe(true);
  state.messages.push(incoming(12));
  const before = state.countFetches;
  socket!.send(JSON.stringify(incoming(12)));
  socket!.send(JSON.stringify(incoming(12)));
  await expect.poll(() => state.countFetches).toBeGreaterThan(before);
  await expect(page.getByLabel("2 unread direct messages", { exact: true })).toBeVisible();
  socket!.close({ code: 1001 });
  state.messages.push(incoming(13));
  await expect(page.getByLabel("3 unread direct messages", { exact: true })).toBeVisible();
  expect(state.reads).toEqual([]);
});

test("closed launcher polls and pending read acknowledgement is cancelled on logout", async ({ page, context }) => {
  const state = await fixture(context);
  const aborted: string[] = [];
  page.on("requestfailed", request => aborted.push(new URL(request.url()).pathname));
  await login(page);
  await expect(page.getByLabel("1 unread direct message", { exact: true })).toBeVisible();
  state.messages.push(incoming(12));
  await expect(page.getByLabel("2 unread direct messages", { exact: true })).toBeVisible({ timeout: 8000 });
  let releaseRead!: () => void;
  state.beforeRead = () => new Promise<void>(resolve => { releaseRead = resolve; });
  await openDm(page);
  await expect.poll(() => state.reads.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => aborted).toContain("/api/dms/1/read");
  releaseRead();
  await expect(page.getByRole("button", { name: "Open chat", exact: true })).toBeHidden();
  await expect(page.getByLabel("2 unread direct messages", { exact: true })).toBeHidden();
});

test("reconciled history acknowledges rendered unread IDs in batches of at most 50", async ({ page, context }) => {
  const state = await fixture(context);
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket("**/ws/dms/1", ws => { socket = ws; });
  await login(page);
  await openDm(page);
  await expect.poll(() => state.reads).toEqual([[10]]);
  await expect(page.getByLabel("1 unread direct message", { exact: true })).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  state.messages.push(...Array.from({ length: 60 }, (_, index) => incoming(index + 20)));
  await expect.poll(() => !!socket).toBe(true);
  socket!.send(JSON.stringify(incoming(79)));
  await expect(page.getByText("Incoming 79", { exact: true })).toBeVisible();
  await expect(page.getByLabel("60 unread direct messages", { exact: true })).toBeVisible();
  expect(state.reads).toEqual([[10]]);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => state.reads).toEqual([
    [10], Array.from({ length: 50 }, (_, index) => index + 20), Array.from({ length: 10 }, (_, index) => index + 70),
  ]);
  await expect(page.getByLabel("60 unread direct messages", { exact: true })).toBeHidden();
});

test("an older message committed after the first snapshot appears and is acknowledged without reload", async ({ page, context }) => {
  const state = await fixture(context);
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket("**/ws/dms/1", ws => { socket = ws; });
  await login(page);
  await openDm(page);
  await expect.poll(() => state.reads).toEqual([[10]]);
  await expect(page.getByLabel("1 unread direct message", { exact: true })).toBeHidden();
  state.messages.unshift(incoming(9));
  await expect.poll(() => !!socket).toBe(true);
  socket!.send(JSON.stringify(incoming(9)));
  await expect(page.getByText("Incoming 9", { exact: true })).toBeVisible();
  await expect.poll(() => state.reads).toEqual([[10], [9]]);
  await expect(page.getByLabel("1 unread direct message", { exact: true })).toBeHidden();
});

test("launcher and conversation badge show the exact count above 99", async ({ page, context }) => {
  const state = await fixture(context);
  state.messages = Array.from({ length: 120 }, (_, index) => incoming(index + 10));
  await login(page);
  await expect(page.getByLabel("120 unread direct messages", { exact: true })).toHaveText("120");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await page.getByRole("tab", { name: "DMs", exact: true }).click();
  await expect(page.getByLabel("120 unread in this conversation", { exact: true })).toHaveText("120");
  expect(state.reads).toEqual([]);
});
