export type ChatConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";
type ChatSocket = Pick<
  WebSocket,
  "onopen" | "onmessage" | "onclose" | "onerror" | "close"
>;
type Timer = ReturnType<typeof setTimeout> | number;
interface SocketOptions {
  url: string;
  onState(state: ChatConnectionState): void;
  onSync(): void;
  onMessage(value: unknown): void;
  createSocket?: (url: string) => ChatSocket;
  schedule?: (callback: () => void, ms: number) => Timer;
  cancel?: (timer: Timer) => void;
}

// Receive only. Application text is a chat message on the legacy server;
// never use socket.send('ping') or replay an uncertain send during reconnect.
export function connectChatSocket(options: SocketOptions): () => void {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let stopped = false,
    failures = 0;
  let socket: ChatSocket | undefined;
  let retry: Timer | undefined;
  let deadline: Timer | undefined;
  const clearDeadline = () => {
    if (deadline !== undefined) cancel(deadline);
    deadline = undefined;
  };
  function reconnect() {
    if (stopped) return;
    options.onState("reconnecting");
    const delay = Math.min(1000 * 2 ** Math.min(failures++, 5), 30_000);
    retry = schedule(
      () => {
        if (retry !== undefined) cancel(retry);
        retry = undefined;
        open();
      },
      delay + Math.random() * 500,
    );
  }
  function open() {
    if (stopped) return;
    options.onState(failures ? "reconnecting" : "connecting");
    let current: ChatSocket;
    try {
      current = (options.createSocket ?? ((url) => new WebSocket(url)))(
        options.url,
      );
      socket = current;
    } catch {
      reconnect();
      return;
    }
    deadline = schedule(() => current.close(), 10_000);
    current.onopen = () => {
      if (stopped || socket !== current) return;
      clearDeadline();
      failures = 0;
      options.onState("connected");
      options.onSync();
    };
    current.onmessage = (event) => {
      if (stopped || socket !== current) return;
      try {
        options.onMessage(JSON.parse(event.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    current.onerror = () => current.close();
    current.onclose = (event) => {
      if (stopped || socket !== current) return;
      clearDeadline();
      socket = undefined;
      if ([1008, 4401, 4403].includes(event.code)) {
        options.onState("offline");
        return;
      }
      reconnect();
    };
  }
  open();
  return () => {
    stopped = true;
    clearDeadline();
    if (retry !== undefined) cancel(retry);
    socket?.close();
  };
}

export function uniqueMessages<T extends { id: number }>(messages: T[]): T[] {
  return [
    ...new Map(messages.map((message) => [message.id, message])).values(),
  ];
}
import type { ScaffoldTodo } from "./chat-api";

// Re-read the displayed window from canonical REST pages, including every gap.
// Undefined means first open (latest page); [] means an empty thread was seen.
export async function syncChatHistory<T extends { id: number }>(
  fetchPage: (beforeId?: number) => Promise<T[] | ScaffoldTodo>,
  previous?: T[],
  loadOlder = false,
): Promise<T[] | ScaffoldTodo> {
  let page = await fetchPage();
  if (!Array.isArray(page)) return page;
  let rows = uniqueMessages(page);
  if (previous === undefined && !loadOlder) return rows;
  const anchor = previous?.[0]?.id;
  const cursors = new Set<number>();
  for (;;) {
    const index = rows.findIndex((row) => row.id === anchor);
    if (index >= 0 && !loadOlder) return rows.slice(index);
    if (index >= 50 && loadOlder) return rows.slice(index - 50);
    if (page.length < 50) return rows;
    const cursor = page[0].id;
    if (cursors.has(cursor)) throw new Error("History cursor did not advance");
    cursors.add(cursor);
    page = await fetchPage(cursor);
    if (!Array.isArray(page)) throw new Error("History paging is unavailable");
    rows = uniqueMessages([...page, ...rows]);
  }
}
