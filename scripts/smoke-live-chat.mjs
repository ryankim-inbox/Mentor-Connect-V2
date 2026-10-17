import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { loadSmokeConfig, restrictSmokeOrigin } from "./smoke-classroom.mjs";

export async function runLiveChat(
  { origin, credentials },
  browser,
  { restart, evidence, emit = console.log } = {},
) {
  const contexts = [],
    pages = [];
  const report = (task) => emit(JSON.stringify({ task, status: "pass" }));
  const api = (page, route, method = "GET", body) =>
    page.evaluate(
      async ({ route, method, body }) => {
        const response = await fetch(route, {
          method,
          credentials: "include",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          ...(body === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }),
        });
        return {
          status: response.status,
          body: response.status === 204 ? null : await response.json(),
        };
      },
      { route, method, body },
    );
  async function findSaved(page, route, matches) {
    let cursor;
    const seen = new Set();
    for (;;) {
      const result = await api(
        page,
        route + (cursor === undefined ? "" : `?beforeId=${cursor}`),
      );
      assert.equal(result.status, 200);
      const found = result.body.find(matches);
      if (found) return found;
      if (result.body.length < 50) return undefined;
      cursor = result.body[0].id;
      assert.ok(!seen.has(cursor), "history cursor must advance");
      seen.add(cursor);
    }
  }
  async function login(page, account) {
    await page.goto(origin + "/login");
    await page.getByLabel("School email").fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(origin + "/dashboard");
    assert.equal((await api(page, "/api/auth/me")).body.id, account.id);
  }
  async function openRoom(page) {
    await page.getByRole("button", { name: "Open chat", exact: true }).click();
    await expect(page.getByText("Live", { exact: true })).toBeVisible({
      timeout: 15000,
    });
  }
  async function openDm(page, name) {
    await page.getByRole("tab", { name: "DMs", exact: true }).click();
    await page
      .getByRole("button")
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
    await expect(page.getByText("Live", { exact: true })).toBeVisible({
      timeout: 15000,
    });
  }
  async function send(sender, recipient, body) {
    await sender.getByPlaceholder("Type a message…").fill(body);
    await sender
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(recipient.getByText(body, { exact: true })).toHaveCount(1, {
      timeout: 5000,
    });
    await expect(sender.getByText(body, { exact: true })).toHaveCount(1);
  }
  try {
    for (const role of ["mentor", "mentee"]) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      page.setDefaultTimeout(15000);
      await restrictSmokeOrigin(page, origin);
      await login(page, credentials.accounts[role]);
    }
    report("independent-cookie-sessions");
    const [a, b] = pages;
    if (evidence) {
      for (const message of evidence.messages) {
        assert.ok(
          await findSaved(
            b,
            message.route,
            (row) => row.id === message.id && row.body === message.body,
          ),
        );
      }
      report("persistence-after-operator-restart");
      return evidence;
    }
    for (const page of pages) {
      const response = await page.goto(origin + "/dashboard/practice-lab");
      assert.equal(response.status(), 200);
      await page.goto(origin + "/dashboard");
    }
    assert.equal((await api(a, "/readyz")).status, 200);
    assert.equal((await api(a, "/api/definitely-missing")).status, 404);
    assert.equal(
      (await a.request.get(origin + "/assets/missing.js")).status(),
      404,
    );
    assert.equal((await a.request.get(origin + "/not-a-route")).status(), 404);
    report("deep-links-404-readiness");
    const token = `live-${randomUUID()}`;
    const roomRoute = `/api/chat/rooms/${credentials.fixtures.globalRoomId}/messages`;
    await openRoom(a);
    await openRoom(b);
    await send(a, b, token + "-room-a");
    await send(b, a, token + "-room-b");
    report("room-bidirectional-live-ui");
    async function recoverGap(sender, recipient, context, route, label) {
      await context.setOffline(true);
      for (let index = 0; index < 51; index++) {
        assert.equal(
          (
            await api(sender, route, "POST", {
              body: `${token}-${label}-${index}`,
            })
          ).status,
          201,
        );
      }
      await context.setOffline(false);
      await expect(
        recipient.getByText(new RegExp(`^${token}-${label}-[0-9]+$`)),
      ).toHaveCount(51, { timeout: 15000 });
    }
    await recoverGap(b, a, contexts[0], roomRoute, "room-gap");
    report("room-reconnect-recovers-51-messages");
    const dm = await api(a, "/api/dms/start", "POST", {
      toUserId: credentials.accounts.mentee.id,
    });
    assert.equal(dm.status, 200);
    const reverse = await api(b, "/api/dms/start", "POST", {
      toUserId: credentials.accounts.mentor.id,
    });
    assert.equal(reverse.body.id, dm.body.id);
    await openDm(a, dm.body.otherUserName);
    await openDm(b, reverse.body.otherUserName);
    await send(a, b, token + "-dm-a");
    await send(b, a, token + "-dm-b");
    report("dm-bidirectional-live-ui");
    const dmRoute = `/api/dms/${dm.body.id}/messages`;
    await recoverGap(a, b, contexts[1], dmRoute, "offline");
    report("reconnect-history-resync-dedup");
    const forged = await api(a, dmRoute, "POST", {
      body: token + "-forged",
      senderId: credentials.accounts.mentee.id,
    });
    assert.equal(forged.status, 422);
    assert.equal((await api(a, dmRoute)).body.some(message => message.body === token + "-forged"), false);
    const csrf = await a.request.post(origin + dmRoute, {
      headers: { origin: "https://untrusted.invalid" },
      data: { body: token + "-csrf" },
    });
    assert.equal(csrf.status(), 403);
    // The two accounts must be in different districts for this negative test.
    const ownRooms = (await api(a, "/api/chat/rooms")).body;
    const otherRooms = (await api(b, "/api/chat/rooms")).body;
    const forbiddenRoom = otherRooms.find(
      (room) =>
        room.type === "district" && !ownRooms.some((own) => own.id === room.id),
    );
    assert.ok(forbiddenRoom, "two-district test accounts required");
    assert.equal(
      (await api(a, `/api/chat/rooms/${forbiddenRoom.id}/messages`)).status,
      403,
    );
    // A conversation with a seeded third account gives a real non-member case.
    const outsiderId = credentials.fixtures.outsiderUserId;
    assert.ok(
      Number.isSafeInteger(outsiderId) && outsiderId > 0,
      "outsiderUserId required",
    );
    const privateDm = await api(a, "/api/dms/start", "POST", {
      toUserId: outsiderId,
    });
    assert.equal(privateDm.status, 200);
    assert.equal(
      (await api(b, `/api/dms/${privateDm.body.id}/messages`)).status,
      403,
    );
    async function rejectsSocket(page, route) {
      const rejected = await page.evaluate(
        (route) =>
          new Promise((resolve) => {
            const url = new URL(route, location.href);
            url.protocol = "wss:";
            const socket = new WebSocket(url);
            const timer = setTimeout(() => {
              socket.close();
              resolve(false);
            }, 5000);
            socket.onopen = () => {
              clearTimeout(timer);
              socket.close();
              resolve(false);
            };
            socket.onerror = () => {
              clearTimeout(timer);
              resolve(true);
            };
          }),
        route,
      );
      assert.equal(rejected, true);
    }
    await rejectsSocket(a, `/ws/chat/rooms/${forbiddenRoom.id}`);
    await rejectsSocket(b, `/ws/dms/${privateDm.body.id}`);
    const hostileSocket = await a.request.get(
      origin + `/ws/dms/${dm.body.id}`,
      {
        headers: {
          origin: "https://untrusted.invalid",
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": Buffer.alloc(16).toString("base64"),
        },
      },
    );
    assert.equal(hostileSocket.status(), 403);
    const anonymous = await browser.newContext({ serviceWorkers: "block" });
    contexts.push(anonymous);
    assert.equal((await anonymous.request.get(origin + dmRoute)).status(), 401);
    assert.equal(
      (
        await api(a, "/api/blocks", "POST", {
          blockedUserId: credentials.accounts.mentee.id,
        })
      ).status,
      201,
    );
    try {
      assert.equal(
        (await api(b, dmRoute, "POST", { body: token + "-blocked" })).status,
        403,
      );
    } finally {
      assert.equal(
        (
          await api(
            a,
            `/api/blocks/${credentials.accounts.mentee.id}`,
            "DELETE",
          )
        ).status,
        204,
      );
    }
    report("membership-district-block-origin-sender-guards");
    const saved = { messages: [] };
    for (const [route, body] of [
      [roomRoute, token + "-room-a"],
      [dmRoute, token + "-dm-a"],
    ]) {
      const row = await findSaved(b, route, (row) => row.body === body);
      assert.ok(row);
      saved.messages.push({ route, body, id: row.id });
    }
    await b.reload();
    await openRoom(b);
    await b
      .getByRole("button", { name: "Load older messages", exact: true })
      .click();
    await expect(b.getByText(token + "-room-a", { exact: true })).toHaveCount(
      1,
    );
    await openDm(b, reverse.body.otherUserName);
    await b
      .getByRole("button", { name: "Load older messages", exact: true })
      .click();
    await expect(b.getByText(token + "-dm-a", { exact: true })).toHaveCount(1);
    await api(b, "/api/auth/logout", "POST");
    await login(b, credentials.accounts.mentee);
    await openRoom(b);
    await b
      .getByRole("button", { name: "Load older messages", exact: true })
      .click();
    await expect(b.getByText(token + "-room-a", { exact: true })).toHaveCount(
      1,
    );
    await openDm(b, reverse.body.otherUserName);
    await b
      .getByRole("button", { name: "Load older messages", exact: true })
      .click();
    await expect(b.getByText(token + "-dm-a", { exact: true })).toHaveCount(1);
    report("refresh-and-relogin-persistence");
    if (restart) {
      await restart();
      await expect
        .poll(async () => (await api(a, "/readyz")).status, { timeout: 20000 })
        .toBe(200);
      for (const message of saved.messages) {
        assert.ok(
          await findSaved(
            b,
            message.route,
            (row) => row.id === message.id && row.body === message.body,
          ),
        );
      }
      report("service-restart-persistence");
    } else
      emit(
        JSON.stringify({
          task: "service-restart-persistence",
          status: "pending-operator-restart",
        }),
      );
    return saved;
  } finally {
    for (const context of contexts) await context.close();
  }
}

async function main() {
  let browser;
  try {
    const config = await loadSmokeConfig();
    const evidenceFile = process.env.LIVE_CHAT_EVIDENCE_FILE;
    if (!evidenceFile) throw new Error();
    const evidence =
      process.env.LIVE_CHAT_VERIFY_PERSISTENCE === "1"
        ? JSON.parse(await readFile(evidenceFile, "utf8"))
        : undefined;
    browser = await chromium.launch();
    const saved = await runLiveChat(config, browser, { evidence });
    if (!evidence)
      await writeFile(evidenceFile, JSON.stringify(saved), {
        mode: 0o600,
        flag: "wx",
      });
  } catch {
    // Errors may include credential form values or response content.
    console.error(JSON.stringify({ task: "live-chat", status: "failed" }));
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
