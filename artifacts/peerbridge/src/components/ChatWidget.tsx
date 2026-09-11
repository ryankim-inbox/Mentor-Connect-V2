// Floating messenger popup (bottom-right) with Global / My School / DMs tabs.
//
// The UI is finished, but the chat backend is a Python practice task: while
// Python/routers/chat.py still returns {"status": "todo"} envelopes, each tab
// shows a friendly practice-task notice instead of pretending chat works.
// The moment the student implements a mission, its tab comes alive — no
// frontend changes needed.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { ArrowLeft, Hammer, MessageCircle, Send, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { apiErrorMessage } from "@/lib/api-error-message";
import { relativeTime } from "@/lib/pythonApi";
import {
  fetchChatRooms,
  fetchDmConversations,
  fetchDmMessages,
  fetchRoomMessages,
  isScaffoldTodo,
  sendDmMessage,
  sendRoomMessage,
  startDmConversation,
  type ChatMessage,
  type ChatRoom,
  type DmConversation,
  type DmMessage,
  type ScaffoldTodo,
} from "@/lib/chat-api";

// Refresh implemented endpoints every few seconds so the popup feels live even
// before the student builds the WebSocket missions. While an endpoint still
// answers with the todo envelope there is nothing new to poll for.
const POLL_MS = 5000;

function pollDelay(data: unknown, error: unknown, failures: number): number | false {
  if (isScaffoldTodo(data)) return false;
  if (!error) return Array.isArray(data) ? POLL_MS : false;
  if (error instanceof ApiError && error.status < 500 && error.status !== 429) return false;
  const retryAfter = error instanceof ApiError ? error.headers.get("retry-after") : null;
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  return Math.min(POLL_MS * 2 ** Math.max(1, failures), 60_000);
}

export function ChatWidget() {
  const { user, isLoading } = useAuth();
  const [open, setOpen] = useState(false);

  if (isLoading || !user) return null;

  return (
    <>
      {open && <ChatPanel key={user.id} currentUserId={user.id} districtId={user.districtId} />}
      <Button
        size="icon"
        aria-label={open ? "Close chat" : "Open chat"}
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </Button>
    </>
  );
}

function ChatPanel({ currentUserId, districtId }: { currentUserId: number; districtId: number }) {
  const roomsQuery = useQuery({
    queryKey: ["chat", currentUserId, "rooms"],
    queryFn: ({ signal }) => fetchChatRooms(signal),
  });

  return (
    <div className="fixed bottom-20 right-4 z-40 flex h-[min(28rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-card-border bg-card shadow-xl">
      <div className="flex items-center gap-2 border-b border-card-border px-4 py-3">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">PeerBridge Chat</h2>
      </div>

      <Tabs defaultValue="global" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 grid grid-cols-3">
          <TabsTrigger value="global">Global</TabsTrigger>
          <TabsTrigger value="school">My School</TabsTrigger>
          <TabsTrigger value="dms">DMs</TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="mt-0 min-h-0 flex-1">
          <RoomPane
            roomsQuery={roomsQuery}
            pickRoom={(rooms) => rooms.find((room) => room.type === "global")}
            missingText="No global room came back from GET /api/chat/rooms — check your Mission 1 query."
            currentUserId={currentUserId}
          />
        </TabsContent>
        <TabsContent value="school" className="mt-0 min-h-0 flex-1">
          <RoomPane
            roomsQuery={roomsQuery}
            pickRoom={(rooms) =>
              rooms.find((room) => room.type === "district" && room.districtId === districtId)
            }
            missingText="No room for your district came back from GET /api/chat/rooms — check your Mission 1 query."
            currentUserId={currentUserId}
          />
        </TabsContent>
        <TabsContent value="dms" className="mt-0 min-h-0 flex-1">
          <DmsPane currentUserId={currentUserId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared states
// ---------------------------------------------------------------------------

function TodoState({ message }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
      <Hammer className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">
        Chat backend is a Python practice task
      </p>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <p className="text-xs text-muted-foreground">
        Implement <code className="rounded bg-muted px-1 py-0.5">Python/routers/chat.py</code> to
        activate this tab — see docs/STUDENT_CHAT_BACKEND_GUIDE.md.
      </p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center"
      role="alert"
    >
      <WifiOff className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{apiErrorMessage(error)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center py-8">
      <Spinner />
    </div>
  );
}

// Minimal structural view of a "send message" mutation, so the shared Thread
// component works for both room messages and DMs.
interface SendMutationLike {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  mutate: (body: string, options?: { onSuccess?: (created: unknown) => void }) => void;
}

// ---------------------------------------------------------------------------
// Room chat (Global / My School)
// ---------------------------------------------------------------------------

function RoomPane({
  roomsQuery,
  pickRoom,
  missingText,
  currentUserId,
}: {
  roomsQuery: UseQueryResult<ChatRoom[] | ScaffoldTodo, Error>;
  pickRoom: (rooms: ChatRoom[]) => ChatRoom | undefined;
  missingText: string;
  currentUserId: number;
}) {
  if (roomsQuery.isLoading) return <LoadingState />;
  if (roomsQuery.isError && !Array.isArray(roomsQuery.data)) {
    return <ErrorState error={roomsQuery.error} onRetry={() => void roomsQuery.refetch()} />;
  }

  const rooms = roomsQuery.data;
  if (!rooms || isScaffoldTodo(rooms)) {
    return <TodoState message={isScaffoldTodo(rooms) ? rooms.message : undefined} />;
  }

  const room = pickRoom(rooms);
  if (!room) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{missingText}</div>;
  }

  return <RoomThread room={room} currentUserId={currentUserId} />;
}

function RoomThread({ room, currentUserId }: { room: ChatRoom; currentUserId: number }) {
  const queryClient = useQueryClient();
  const messagesQuery = useQuery({
    queryKey: ["chat", currentUserId, "room-messages", room.id],
    queryFn: ({ signal }) => fetchRoomMessages(room.id, signal),
    refetchInterval: (query) =>
      pollDelay(query.state.data, query.state.error, query.state.fetchFailureCount),
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendRoomMessage(room.id, body),
    onSuccess: (created) => {
      if (!isScaffoldTodo(created)) {
        void queryClient.invalidateQueries({
          queryKey: ["chat", currentUserId, "room-messages", room.id],
        });
      }
    },
  });

  if (messagesQuery.isLoading) return <LoadingState />;
  if (messagesQuery.isError && !Array.isArray(messagesQuery.data)) {
    return <ErrorState error={messagesQuery.error} onRetry={() => void messagesQuery.refetch()} />;
  }

  const messages = messagesQuery.data;
  if (!messages || isScaffoldTodo(messages)) {
    return <TodoState message={isScaffoldTodo(messages) ? messages.message : undefined} />;
  }

  return (
    <Thread
      title={room.name}
      messages={messages.map((message: ChatMessage) => ({
        id: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        body: message.body,
        createdAt: message.createdAt,
      }))}
      currentUserId={currentUserId}
      sendMutation={sendMutation}
      readError={messagesQuery.error}
      emptyText="No messages yet — say hi!"
    />
  );
}

// ---------------------------------------------------------------------------
// Direct messages
// ---------------------------------------------------------------------------

function DmsPane({ currentUserId }: { currentUserId: number }) {
  const [openConversation, setOpenConversation] = useState<DmConversation | null>(null);

  if (openConversation) {
    return (
      <DmThread
        conversation={openConversation}
        currentUserId={currentUserId}
        onBack={() => setOpenConversation(null)}
      />
    );
  }
  return <DmList currentUserId={currentUserId} onOpen={setOpenConversation} />;
}

function DmList({
  currentUserId,
  onOpen,
}: {
  currentUserId: number;
  onOpen: (conversation: DmConversation) => void;
}) {
  const queryClient = useQueryClient();
  const [newDmUserId, setNewDmUserId] = useState("");
  const [startNotice, setStartNotice] = useState<string | null>(null);

  const dmsQuery = useQuery({
    queryKey: ["chat", currentUserId, "dms"],
    queryFn: ({ signal }) => fetchDmConversations(signal),
    refetchInterval: (query) =>
      pollDelay(query.state.data, query.state.error, query.state.fetchFailureCount),
  });

  const startMutation = useMutation({
    mutationFn: (toUserId: number) => startDmConversation(toUserId),
    onSuccess: (created) => {
      if (isScaffoldTodo(created)) {
        setStartNotice(created.message);
      } else {
        setStartNotice(null);
        setNewDmUserId("");
        void queryClient.invalidateQueries({ queryKey: ["chat", currentUserId, "dms"] });
        onOpen(created);
      }
    },
    onError: (error) => setStartNotice(apiErrorMessage(error)),
  });

  if (dmsQuery.isLoading) return <LoadingState />;
  if (dmsQuery.isError && !Array.isArray(dmsQuery.data)) {
    return <ErrorState error={dmsQuery.error} onRetry={() => void dmsQuery.refetch()} />;
  }

  const conversations = dmsQuery.data;
  if (!conversations || isScaffoldTodo(conversations)) {
    return (
      <TodoState message={isScaffoldTodo(conversations) ? conversations.message : undefined} />
    );
  }

  const handleStart = (event: FormEvent) => {
    event.preventDefault();
    const toUserId = Number(newDmUserId);
    if (!Number.isInteger(toUserId) || toUserId <= 0) {
      setStartNotice("Enter a numeric user id (e.g. 501).");
      return;
    }
    startMutation.mutate(toUserId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        {conversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No conversations yet — start one below.
          </div>
        ) : (
          <ul className="divide-y divide-card-border">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onOpen(conversation)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="text-sm font-medium text-foreground">
                    {conversation.otherUserName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(conversation.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
      <form onSubmit={handleStart} className="border-t border-card-border p-3">
        <div className="flex gap-2">
          <Input
            value={newDmUserId}
            onChange={(event) => setNewDmUserId(event.target.value)}
            placeholder="Start a DM by user id…"
            inputMode="numeric"
            className="h-9"
          />
          <Button type="submit" size="sm" className="h-9" disabled={startMutation.isPending}>
            Start
          </Button>
        </div>
        {dmsQuery.error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {apiErrorMessage(dmsQuery.error)}
          </p>
        )}
        {startNotice && (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {startNotice}
          </p>
        )}
      </form>
    </div>
  );
}

function DmThread({
  conversation,
  currentUserId,
  onBack,
}: {
  conversation: DmConversation;
  currentUserId: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const messagesQuery = useQuery({
    queryKey: ["chat", currentUserId, "dm-messages", conversation.id],
    queryFn: ({ signal }) => fetchDmMessages(conversation.id, signal),
    refetchInterval: (query) =>
      pollDelay(query.state.data, query.state.error, query.state.fetchFailureCount),
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendDmMessage(conversation.id, body),
    onSuccess: (created) => {
      if (!isScaffoldTodo(created)) {
        void queryClient.invalidateQueries({
          queryKey: ["chat", currentUserId, "dm-messages", conversation.id],
        });
      }
    },
  });

  const back = (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to conversations"
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );

  if (messagesQuery.isLoading) return <LoadingState />;
  if (messagesQuery.isError && !Array.isArray(messagesQuery.data)) {
    return <ErrorState error={messagesQuery.error} onRetry={() => void messagesQuery.refetch()} />;
  }

  const messages = messagesQuery.data;
  if (!messages || isScaffoldTodo(messages)) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-card-border px-3 py-2">{back}</div>
        <div className="min-h-0 flex-1">
          <TodoState message={isScaffoldTodo(messages) ? messages.message : undefined} />
        </div>
      </div>
    );
  }

  return (
    <Thread
      title={conversation.otherUserName}
      leading={back}
      messages={messages.map((message: DmMessage) => ({
        id: message.id,
        senderId: message.senderId,
        senderName: message.senderId === currentUserId ? "You" : conversation.otherUserName,
        body: message.body,
        createdAt: message.createdAt,
      }))}
      currentUserId={currentUserId}
      sendMutation={sendMutation}
      readError={messagesQuery.error}
      emptyText="No messages yet — send the first one."
    />
  );
}

// ---------------------------------------------------------------------------
// Message thread (shared by rooms and DMs)
// ---------------------------------------------------------------------------

interface ThreadMessage {
  id: number;
  senderId: number;
  senderName: string;
  body: string;
  createdAt: string;
}

function Thread({
  title,
  leading,
  messages,
  currentUserId,
  sendMutation,
  readError,
  emptyText,
}: {
  title: string;
  leading?: ReactNode;
  messages: ThreadMessage[];
  currentUserId: number;
  sendMutation: SendMutationLike;
  readError?: unknown;
  emptyText: string;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const sendBlocked = isScaffoldTodo(sendMutation.data)
    ? `${sendMutation.data.message}. Sending isn't implemented yet.`
    : null;

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sendMutation.isPending) return;
    sendMutation.mutate(body, {
      onSuccess: (created) => {
        if (!isScaffoldTodo(created)) setDraft("");
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-card-border px-3 py-2">
        {leading}
        <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {messages.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {messages.map((message) => {
              const own = message.senderId === currentUserId;
              return (
                <div
                  key={message.id}
                  className={`flex flex-col ${own ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                      own ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {message.body}
                  </div>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">
                    {own ? "You" : message.senderName} · {relativeTime(message.createdAt)}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      <form onSubmit={handleSend} className="border-t border-card-border p-3">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message…"
            className="h-9"
          />
          <Button
            type="submit"
            size="sm"
            className="h-9"
            aria-label="Send message"
            disabled={!draft.trim() || sendMutation.isPending}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {readError != null && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {apiErrorMessage(readError)}
          </p>
        )}
        {sendBlocked && (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {sendBlocked}
          </p>
        )}
        {sendMutation.isError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {apiErrorMessage(sendMutation.error)}
          </p>
        )}
      </form>
    </div>
  );
}
