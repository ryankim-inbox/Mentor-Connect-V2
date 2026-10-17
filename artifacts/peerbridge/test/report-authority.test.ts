import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getListAdminReportsQueryKey } from "@workspace/api-client-react";
import {
  discardReportState,
  reportAuthorityKey,
} from "../src/lib/report-authority";

test("report revocation discards query rows and moderation variables/results, including late completions", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const deniedKey = reportAuthorityKey(1);
  client.setQueryData(deniedKey, true);
  client.setQueryData(["public-stats"], { count: 4 });
  for (const status of ["open", "reviewing"] as const)
    client.setQueryData(getListAdminReportsQueryKey({ status }), [
      { description: "Private cached description", note: "Private saved note" },
    ]);
  const saved = client
    .getMutationCache()
    .build(client, {
      mutationFn: async (variables: { note: string }) => ({
        note: variables.note,
        description: "Private mutation result",
      }),
    });
  await saved.execute({ note: "Private moderation variables" });
  let releaseMutation!: (value: { note: string }) => void;
  const mutationResult = new Promise<{ note: string }>((resolve) => {
    releaseMutation = resolve;
  });
  const pending = client
    .getMutationCache()
    .build(client, {
      mutationFn: async (_variables: { note: string }) => mutationResult,
    });
  const pendingWrite = pending.execute({ note: "Private pending variables" });
  let releaseRead!: (value: { description: string }[]) => void;
  const readResult = new Promise<{ description: string }[]>((resolve) => {
    releaseRead = resolve;
  });
  const pendingRead = client
    .fetchQuery({
      queryKey: getListAdminReportsQueryKey({ beforeId: 99 }),
      queryFn: async () => readResult,
    })
    .catch(() => undefined);
  assert.equal(client.getMutationCache().getAll().length, 2);
  assert.equal(saved.state.variables?.note, "Private moderation variables");
  assert.equal(saved.state.data?.description, "Private mutation result");
  assert.equal(pending.state.variables?.note, "Private pending variables");
  discardReportState(client);
  assert.deepEqual(
    client.getQueriesData({ queryKey: getListAdminReportsQueryKey() }),
    [],
  );
  assert.deepEqual(client.getMutationCache().getAll(), []);
  assert.equal(client.getQueryData(deniedKey), true);
  assert.deepEqual(client.getQueryData(["public-stats"]), { count: 4 });
  releaseRead([{ description: "Late private report" }]);
  releaseMutation({ note: "Late private mutation" });
  await Promise.all([pendingRead, pendingWrite]);
  assert.deepEqual(
    client.getQueriesData({ queryKey: getListAdminReportsQueryKey() }),
    [],
  );
  assert.deepEqual(client.getMutationCache().getAll(), []);
  assert.doesNotMatch(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
    /Private|Late private/,
  );
  client.clear();
});
