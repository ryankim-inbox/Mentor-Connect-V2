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
