import { customFetch } from "@workspace/api-client-react";

// Fetch helpers for the chat learning scaffold (/api/chat/*, /api/dms/*).
//
// The Python side of these endpoints is intentionally unfinished — it is the
// student's practice task (see Python/routers/chat.py and
// docs/STUDENT_CHAT_BACKEND_GUIDE.md). Until a mission is implemented the
// endpoint answers with a ScaffoldTodo envelope; afterwards it returns the
// real shape. Every helper therefore resolves to `T | ScaffoldTodo`, and
// callers branch with isScaffoldTodo().

export interface ScaffoldTodo {
  status: "todo";
  mission?: number;
  message: string;
  guide?: string;
}

export interface ChatRoom {
  id: number;
  type: "global" | "district";
  districtId: number | null;
  name: string;
}

export interface ChatMessage {
  id: number;
  roomId: number;
  senderId: number;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface DmConversation {
  id: number;
  otherUserId: number;
  otherUserName: string;
  createdAt: string;
}

export interface DmMessage {
  id: number;
  conversationId: number;
  senderId: number;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export function isScaffoldTodo(payload: unknown): payload is ScaffoldTodo {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as { status?: unknown }).status === "todo" &&
    typeof (payload as { message?: unknown }).message === "string"
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fields(value: unknown, shape: Record<string, "number" | "string">): boolean {
  const item = record(value);
  return !!item && Object.entries(shape).every(([key, type]) => typeof item[key] === type);
}

async function chatFetch<T>(
  path: string,
  init: RequestInit | undefined,
  accepts: (payload: unknown) => boolean,
): Promise<T | ScaffoldTodo> {
  const payload = await customFetch<unknown>(path, {
    ...init,
    responseType: "json",
    credentials: "include",
  });
  if (isScaffoldTodo(payload)) return payload;
  if (!accepts(payload)) throw new TypeError("Unexpected chat API response");
  return payload as T;
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

const chatRoom = (value: unknown) =>
  fields(value, { id: "number", type: "string", name: "string" }) &&
  ["global", "district"].includes((value as ChatRoom).type);
const chatMessage = (value: unknown) =>
  fields(value, {
    id: "number",
    roomId: "number",
    senderId: "number",
    senderName: "string",
    body: "string",
    createdAt: "string",
  });
const dmConversation = (value: unknown) =>
  fields(value, {
    id: "number",
    otherUserId: "number",
    otherUserName: "string",
    createdAt: "string",
  });
const dmMessage = (value: unknown) =>
  fields(value, {
    id: "number",
    conversationId: "number",
    senderId: "number",
    body: "string",
    createdAt: "string",
  });
const arrayOf = (accepts: (value: unknown) => boolean) => (value: unknown) =>
  Array.isArray(value) && value.every(accepts);

export const fetchChatRooms = (signal?: AbortSignal) =>
  chatFetch<ChatRoom[]>("/api/chat/rooms", { signal }, arrayOf(chatRoom));

export const fetchRoomMessages = (roomId: number, signal?: AbortSignal) =>
  chatFetch<ChatMessage[]>(
    `/api/chat/rooms/${roomId}/messages`,
    { signal },
    arrayOf(chatMessage),
  );

export const sendRoomMessage = (roomId: number, body: string) =>
  chatFetch<ChatMessage>(
    `/api/chat/rooms/${roomId}/messages`,
    postJson({ body }),
    chatMessage,
  );

export const fetchDmConversations = (signal?: AbortSignal) =>
  chatFetch<DmConversation[]>("/api/dms", { signal }, arrayOf(dmConversation));

export const startDmConversation = (toUserId: number) =>
  chatFetch<DmConversation>(
    "/api/dms/start",
    postJson({ toUserId }),
    dmConversation,
  );

export const fetchDmMessages = (conversationId: number, signal?: AbortSignal) =>
  chatFetch<DmMessage[]>(
    `/api/dms/${conversationId}/messages`,
    { signal },
    arrayOf(dmMessage),
  );

export const sendDmMessage = (conversationId: number, body: string) =>
  chatFetch<DmMessage>(
    `/api/dms/${conversationId}/messages`,
    postJson({ body }),
    dmMessage,
  );
