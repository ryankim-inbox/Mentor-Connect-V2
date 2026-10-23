import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { fetchDmUnread, isScaffoldTodo, markDmRead, type DmMessage, type ScaffoldTodo } from "@/lib/chat-api";

export function useDmUnread(userId: number | undefined) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["chat", userId, "unread"],
    queryFn: ({ signal }) => fetchDmUnread(signal),
    enabled: userId !== undefined,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: query => {
      const { error, data, fetchFailureCount } = query.state;
      if (isScaffoldTodo(data) || (error instanceof ApiError && error.status < 500 && error.status !== 429)) return false;
      const retryAfter = error instanceof ApiError ? error.headers.get("retry-after") : null;
      if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
      return error ? Math.min(5000 * 2 ** Math.max(1, fetchFailureCount), 60_000) : 5000;
    },
  });
  useEffect(() => {
    if (userId === undefined) return;
    const sync = () => {
      void client.invalidateQueries({ queryKey: ["chat", userId, "unread"] });
      void client.invalidateQueries({ queryKey: ["chat", userId, "dm-messages"] });
    };
    const visible = () => { if (document.visibilityState === "visible") sync(); };
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(`peerbridge-dm-${userId}`);
    if (channel) channel.onmessage = sync;
    document.addEventListener("visibilitychange", visible);
    return () => {
      channel?.close();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, userId]);
  return query;
}

export function broadcastDmRead(userId: number) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(`peerbridge-dm-${userId}`);
  channel.postMessage("read");
  channel.close();
}

export function useMarkRenderedDmsRead(
  userId: number,
  conversationId: number,
  messages: DmMessage[] | ScaffoldTodo | undefined,
  dataUpdatedAt: number,
  historyError: unknown,
) {
  const client = useQueryClient();
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setError(null), [userId, conversationId]);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (!visible || !Array.isArray(messages) || historyError) return;
    const unread = messages.filter(message => message.senderId !== userId && message.readAt === null);
    if (!unread.length) {
      setError(null);
      return;
    }
    const messageIds = unread.slice(0, 50).map(message => message.id);
    const controller = new AbortController();
    // Wait for paint; closing the panel, switching accounts, or hiding cancels it.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (document.visibilityState !== "visible") return;
        void markDmRead(conversationId, messageIds, controller.signal).then(result => {
          if (controller.signal.aborted || isScaffoldTodo(result)) return;
          setError(null);
          void client.invalidateQueries({ queryKey: ["chat", userId, "unread"] });
          void client.invalidateQueries({ queryKey: ["chat", userId, "dm-messages", conversationId] });
          broadcastDmRead(userId);
        }).catch(error => { if (!controller.signal.aborted) setError(error); });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [client, userId, conversationId, messages, dataUpdatedAt, historyError, visible]);
  return error;
}
