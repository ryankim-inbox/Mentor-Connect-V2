import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth-context";
import {
  startDmConversation,
  isScaffoldTodo,
  type DmConversation,
} from "./chat-api";
import { apiErrorMessage } from "./api-error-message";

interface Selection {
  accountId: number;
  sequence: number;
  conversation: DmConversation;
}
interface Navigation {
  selection: Selection | null;
  openDm: (userId: number) => void;
  pending: number | null;
  failure: { userId: number; message: string } | null;
}
const ChatNavigation = createContext<Navigation | null>(null);

export function ChatNavigationProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const account = useRef(user?.id);
  account.current =
    status === "authenticated" && user?.hasMemberAccess && !user.isAdmin
      ? user.id
      : undefined;
  const busy = useRef(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [failure, setFailure] = useState<Navigation["failure"]>(null);
  useEffect(() => {
    setSelection(null);
    setFailure(null);
  }, [user?.id, user?.isAdmin, user?.hasMemberAccess, status]);
  const openDm = async (userId: number) => {
    const owner = user?.id;
    if (
      !owner ||
      status !== "authenticated" ||
      !user?.hasMemberAccess ||
      user.isAdmin ||
      busy.current
    )
      return;
    busy.current = true;
    setPending(userId);
    setFailure(null);
    try {
      const conversation = await startDmConversation(userId);
      if (account.current !== owner) return;
      if (isScaffoldTodo(conversation)) throw new Error(conversation.message);
      setSelection((previous) => ({
        accountId: owner,
        sequence: (previous?.sequence ?? 0) + 1,
        conversation,
      }));
      void queryClient.invalidateQueries({ queryKey: ["chat", owner, "dms"] });
    } catch (error) {
      if (account.current === owner)
        setFailure({ userId, message: apiErrorMessage(error) });
    } finally {
      busy.current = false;
      setPending(null);
    }
  };
  return (
    <ChatNavigation.Provider
      value={{
        selection: selection?.accountId === account.current ? selection : null,
        openDm: (id) => void openDm(id),
        pending,
        failure,
      }}
    >
      {children}
    </ChatNavigation.Provider>
  );
}
export function useChatNavigation() {
  const value = useContext(ChatNavigation);
  if (!value) throw new Error("ChatNavigationProvider is required");
  return value;
}
export function MessageButton({
  userId,
  name,
}: {
  userId: number;
  name: string;
}) {
  const { openDm, pending, failure } = useChatNavigation();
  const { user, status } = useAuth();
  if (status !== "authenticated" || !user?.hasMemberAccess || user.isAdmin)
    return null;
  return (
    <div>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => openDm(userId)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending === userId ? "Opening conversation…" : `Message ${name}`}
      </button>
      {failure?.userId === userId && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {failure.message}
        </p>
      )}
    </div>
  );
}
