import { useInfiniteQuery } from "@tanstack/react-query";
import {
  listConnections,
  listRequestActivity,
} from "@workspace/api-client-react";

export function useConnections(userId: number) {
  return useInfiniteQuery({
    queryKey: ["journey", userId, "connections"],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      listConnections({ limit: 50, beforeId: pageParam }, { signal }),
    getNextPageParam: (rows) =>
      rows.length === 50 ? rows.at(-1)?.userId : undefined,
    refetchInterval: 10_000,
    staleTime: 0,
  });
}
export function useRequestActivity(userId: number) {
  return useInfiniteQuery({
    queryKey: ["journey", userId, "activity"],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      listRequestActivity({ limit: 50, beforeId: pageParam }, { signal }),
    getNextPageParam: (rows) =>
      rows.length === 50 ? rows.at(-1)?.id : undefined,
    refetchInterval: 10_000,
    staleTime: 0,
  });
}
