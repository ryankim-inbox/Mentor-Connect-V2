import { createContext, useContext, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ApiError,
  getMe,
  logout as endSession,
  useGetMe,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const logoutPending = useRef<Promise<void> | null>(null);
  const { data, error, isPending } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false, staleTime: 0 },
  });
  const expired = error instanceof ApiError && error.status === 401;
  const user = expired ? null : (data ?? null);
  const status: AuthStatus = expired
    ? "anonymous"
    : error
      ? "error"
      : user
        ? "authenticated"
        : isPending
          ? "loading"
          : "anonymous";

  const refreshSession = async (): Promise<User | null> => {
    try {
      return await queryClient.fetchQuery({
        queryKey: getGetMeQueryKey(),
        queryFn: ({ signal }) => getMe({ signal }),
        staleTime: 0,
        retry: false,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(getGetMeQueryKey(), null);
        return null;
      }
      throw error;
    }
  };

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
