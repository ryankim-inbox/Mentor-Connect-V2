import assert from "node:assert/strict";
import test from "node:test";
import { connectChatSocket, uniqueMessages } from "../src/lib/chat-socket.ts";

class Socket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }
}

test("receives invalidation events, resyncs after reconnect, and stops cleanly without sending text", () => {
  const sockets: Socket[] = [];
  const scheduled = new Map<number, () => void>();
  const delays: number[] = [];
  let timerId = 0,
    syncs = 0;
  const events: unknown[] = [],
    states: string[] = [];
  const stop = connectChatSocket({
    url: "wss://example.test/ws/dms/1",
    createSocket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
    schedule: (fn, ms) => {
      delays.push(ms);
      scheduled.set(++timerId, fn);
      return timerId;
    },
    cancel: (id) => {
      scheduled.delete(id as number);
    },
    onState: (state) => states.push(state),
    onSync: () => {
      syncs++;
    },
    onMessage: (value) => events.push(value),
  });
  sockets[0].onopen?.();
  sockets[0].onmessage?.({ data: '{"id":1,"body":"hello"}' });
  sockets[0].onmessage?.({ data: "not json" });
  assert.equal(syncs, 1);
  assert.deepEqual(events, [{ id: 1, body: "hello" }]);
  sockets[0].onclose?.({ code: 1006 });
  assert.equal(states.at(-1), "reconnecting");
  assert.ok(delays.at(-1)! >= 1000 && delays.at(-1)! <= 1500);
  [...scheduled.values()].at(-1)!();
  sockets[1].onopen?.();
  assert.equal(syncs, 2);
  assert.equal(states.at(-1), "connected");
  stop();
  assert.ok(sockets[1].closed);
  assert.equal(scheduled.size, 0);
});

test("terminal authorization close does not reconnect", () => {
  let schedules = 0;
  const socket = new Socket();
  const stop = connectChatSocket({
    url: "wss://example.test/ws/dms/1",
    createSocket: () => socket,
    schedule: () => ++schedules,
    cancel() {},
    onState() {},
    onSync() {},
    onMessage() {},
  });
  socket.onclose?.({ code: 4403 });
  assert.equal(schedules, 1); // opening deadline only
  stop();
});

test("history reconciliation removes duplicate message IDs in server order", () => {
  assert.deepEqual(uniqueMessages([{ id: 2 }, { id: 1 }, { id: 2 }]), [
    { id: 2 },
    { id: 1 },
  ]);
});

test("dedup preserves canonical REST timestamp order even when IDs differ", () => {
  const rows = [
    { id: 2, createdAt: "2026-01-01T00:00:00Z" },
    { id: 1, createdAt: "2026-01-01T00:00:01Z" },
  ];
  assert.deepEqual(uniqueMessages(rows), rows);
});
