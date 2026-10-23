import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectChatSocket, type ChatConnectionState } from "@/lib/chat-socket";

export function useChatSocket(
  userId: number,
  kind: "room" | "dm",
  id: number,
  enabled: boolean,
) {
  const client = useQueryClient();
  const [state, setState] = useState<ChatConnectionState>("connecting");
  useEffect(() => {
    if (!enabled) {
      setState("offline");
      return;
    }
    const queryKey = ["chat", userId, `${kind}-messages`, id];
    const sync = () => {
      void client.invalidateQueries({ queryKey, exact: true });
      if (kind === "dm") void client.invalidateQueries({ queryKey: ["chat", userId, "unread"], exact: true });
    };
    const url = new URL(
      kind === "room" ? `/ws/chat/rooms/${id}` : `/ws/dms/${id}`,
      window.location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let stop: (() => void) | undefined;
    const connect = () => {
      stop?.();
      if (!navigator.onLine) {
        setState("offline");
        return;
      }
      stop = connectChatSocket({
        url: url.href,
        onState: setState,
        onSync: sync,
        onMessage(value) {
          if (!value || typeof value !== "object") return;
          const row = value as Record<string, unknown>;
          if (
            row[kind === "room" ? "roomId" : "conversationId"] === id &&
            Number.isSafeInteger(row.id)
          )
            sync();
        },
      });
    };
    const offline = () => {
      stop?.();
      setState("offline");
    };
    const visible = () => {
      if (document.visibilityState === "visible") connect();
    };
    connect();
    window.addEventListener("online", connect);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stop?.();
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, userId, kind, id, enabled]);
  return state;
}
