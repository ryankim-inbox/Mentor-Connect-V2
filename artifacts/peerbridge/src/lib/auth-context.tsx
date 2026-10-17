import { createContext, useContext, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ApiError,
  getMe,
  logout as endSession,
  getGetMeQueryKey,
  type User,
} from "@workspace/api-client-react";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";
interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  isLoading: boolean;
  refetch: () => Promise<User | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// A return destination is a local pathname, never a URL or another auth form.
export function sessionReturnPath(value: string | null): string {
  if (!value || !/^\/(?!\/)/.test(value) || /[\\?#%\s:]/.test(value))
    return "/dashboard";
  const pathname = new URL(value, "https://local.invalid").pathname;
  if (/^\/(login|register)(\/|$)/i.test(pathname)) return "/dashboard";
  return pathname;
}

// Both automatic and explicit checks replace rejected account data with null.
const sessionQueryOptions = {
  queryKey: getGetMeQueryKey(),
  queryFn: async ({
    signal,
  }: {
    signal: AbortSignal;
  }): Promise<User | null> => {
    try {
      return await getMe({ signal });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 0,
  retry: false,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const logoutPending = useRef<Promise<void> | null>(null);
  const options = {
    ...sessionQueryOptions,
    queryFn: async (context: { signal: AbortSignal }) => {
      const next = await sessionQueryOptions.queryFn(context);
      const previous = queryClient.getQueryData<User | null>(
        getGetMeQueryKey(),
      );
      if (
        previous &&
        (previous.id !== next?.id ||
          previous.isAdmin !== next.isAdmin ||
          previous.isVerified !== next.isVerified)
      ) {
        await queryClient.cancelQueries({
          predicate: (q) => q.queryKey[0] !== getGetMeQueryKey()[0],
        });
        queryClient.removeQueries({
          predicate: (q) => q.queryKey[0] !== getGetMeQueryKey()[0],
        });
        queryClient.getMutationCache().clear();
      }
      return next;
    },
  };
  const { data, error, isPending } = useQuery(options);
  const user = data ?? null;
  const status: AuthStatus = error
    ? "error"
    : user
      ? "authenticated"
      : isPending
        ? "loading"
        : "anonymous";

  const refreshSession = (): Promise<User | null> =>
    queryClient.fetchQuery(options);

  const logout = (): Promise<void> => {
    if (logoutPending.current) return logoutPending.current;
    logoutPending.current = (async () => {
      try {
        await endSession();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      await queryClient.cancelQueries();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== getGetMeQueryKey()[0],
      });
      queryClient.getMutationCache().clear();
      queryClient.setQueryData(getGetMeQueryKey(), null);
      navigate("/");
    })().finally(() => {
      logoutPending.current = null;
    });
    return logoutPending.current;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        isLoading: status === "loading",
        refetch: refreshSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
