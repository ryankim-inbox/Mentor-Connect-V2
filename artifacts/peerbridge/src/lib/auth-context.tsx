import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

interface AuthContextValue {
  user: {
    id: number;
    email: string;
    name: string;
    role: string;
    districtId: number;
    districtName?: string | null;
    bio?: string | null;
    subjects: string[];
    isVerified: boolean;
    createdAt: string;
  } | null;
  isLoading: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  refetch: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
    },
  });

  const handleRefetch = () => {
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    refetch();
  };

  return (
    <AuthContext.Provider value={{ user: data ?? null, isLoading, refetch: handleRefetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
