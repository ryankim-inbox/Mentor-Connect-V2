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
    (payload as { status?: unknown }).status === "todo"
  );
}

async function chatFetch<T>(path: string, init?: RequestInit): Promise<T | ScaffoldTodo> {
  const response = await fetch(path, { credentials: "include", ...init });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      payload !== null && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return payload as T | ScaffoldTodo;
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const fetchChatRooms = () => chatFetch<ChatRoom[]>("/api/chat/rooms");

export const fetchRoomMessages = (roomId: number) =>
  chatFetch<ChatMessage[]>(`/api/chat/rooms/${roomId}/messages`);

export const sendRoomMessage = (roomId: number, body: string) =>
  chatFetch<ChatMessage>(`/api/chat/rooms/${roomId}/messages`, postJson({ body }));

export const fetchDmConversations = () => chatFetch<DmConversation[]>("/api/dms");

export const startDmConversation = (toUserId: number) =>
  chatFetch<DmConversation>("/api/dms/start", postJson({ toUserId }));

export const fetchDmMessages = (conversationId: number) =>
  chatFetch<DmMessage[]>(`/api/dms/${conversationId}/messages`);

export const sendDmMessage = (conversationId: number, body: string) =>
  chatFetch<DmMessage>(`/api/dms/${conversationId}/messages`, postJson({ body }));
