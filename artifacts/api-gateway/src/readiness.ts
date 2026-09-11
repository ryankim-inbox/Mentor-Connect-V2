import { readFile } from "node:fs/promises";

import pg from "pg";

const { Pool } = pg;

const DEFAULT_UPSTREAM_ORIGIN = "http://127.0.0.1:8181";
const PROBE_DEADLINE_MS = 2_000;
const RESULT_CACHE_MS = 2_000;
const DATABASE_TIMEOUT_MS = 1_000;
const MIGRATION_ID = /^\d{4,}_[a-z0-9_]+$/;
const RELEASE_SHA = /^[a-f0-9]{7,64}$/;
const LEDGER_QUERY =
  'SELECT migration_id AS "migrationId" FROM public.mentor_connect_schema_migrations ORDER BY ordinal DESC LIMIT 1';

interface QueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

interface ReadinessClient {
  query(sql: string): Promise<QueryResult>;
  release(destroy?: boolean): void;
}

interface ReadinessPool {
  connect(): Promise<ReadinessClient>;
  end(): Promise<void>;
}

interface ReadinessPoolOptions {
  readonly connectionString: string;
  readonly connectionTimeoutMillis: number;
  readonly max: number;
  readonly statement_timeout: number;
}

export interface ReadinessChecker {
  checkReadiness(): Promise<boolean>;
  close(): Promise<void>;
  setDraining(): void;
}

export interface ReleaseMetadata {
  readonly currentMigrationId: string;
  readonly releaseSha: string;
}

export interface ReadinessOptions {
  readonly upstreamOrigin?: string;
  readonly databaseUrl?: string;
  readonly expectedMigrationId?: string;
  readonly deadlineMs?: number;
  readonly now?: () => number;
  readonly fetchImplementation?: typeof fetch;
  readonly poolFactory?: (
    options: ReadinessPoolOptions,
  ) => ReadinessPool | Promise<ReadinessPool>;
  readonly releaseMetadataUrl?: URL;
}

export function createReadinessChecker(
  options: ReadinessOptions = {},
): ReadinessChecker {
  const databaseUrl = Object.hasOwn(options, "databaseUrl")
    ? options.databaseUrl
    : process.env.READINESS_DATABASE_URL;
  const upstreamOrigin =
    options.upstreamOrigin ??
    process.env.GATEWAY_UPSTREAM_ORIGIN ??
    DEFAULT_UPSTREAM_ORIGIN;
  const deadlineMs = options.deadlineMs ?? PROBE_DEADLINE_MS;
  const now = options.now ?? Date.now;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const poolFactory = options.poolFactory ?? defaultPoolFactory;
  const releaseMetadataUrl =
    options.releaseMetadataUrl ?? new URL("./release.json", import.meta.url);

  let draining = false;
  let cached:
    | { readonly expiresAt: number; readonly value: boolean }
    | undefined;
  let inFlight: Promise<boolean> | undefined;
  let activeController: AbortController | undefined;
  let poolPromise: Promise<ReadinessPool> | undefined;

  function getPool(): Promise<ReadinessPool> {
    poolPromise ??= Promise.resolve().then(() =>
      poolFactory({
        connectionString: databaseUrl as string,
        connectionTimeoutMillis: DATABASE_TIMEOUT_MS,
        max: 1,
        statement_timeout: DATABASE_TIMEOUT_MS,
      }),
    );
    return poolPromise;
  }

  function checkReadiness(): Promise<boolean> {
    if (draining || !databaseUrl) return Promise.resolve(false);
    if (cached && cached.expiresAt > now())
      return Promise.resolve(cached.value);
    if (inFlight) return inFlight;

    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(
      () => controller.abort(new Error("readiness deadline exceeded")),
      deadlineMs,
    );

    inFlight = Promise.all([
      checkPythonHealth(upstreamOrigin, fetchImplementation, controller.signal),
      checkDatabase(getPool(), controller.signal),
      options.expectedMigrationId
        ? Promise.resolve(options.expectedMigrationId)
        : loadReleaseMetadata(releaseMetadataUrl, controller.signal).then(
            (metadata) => metadata?.currentMigrationId,
          ),
    ])
      .then(
        ([upstreamReady, actualMigrationId, expectedMigrationId]) =>
          upstreamReady &&
          MIGRATION_ID.test(actualMigrationId ?? "") &&
          actualMigrationId === expectedMigrationId,
        () => false,
      )
      .then((value) => {
        cached = { expiresAt: now() + RESULT_CACHE_MS, value };
        return value;
      })
      .finally(() => {
        clearTimeout(timeout);
        activeController = undefined;
        inFlight = undefined;
      });

    return inFlight;
  }

  return {
    checkReadiness,
    setDraining() {
      draining = true;
      cached = undefined;
      activeController?.abort(new Error("readiness checker draining"));
    },
    async close() {
      draining = true;
      cached = undefined;
      activeController?.abort(new Error("readiness checker closed"));
      await inFlight?.catch(() => {});
      const pool = await poolPromise?.catch(() => undefined);
      await pool?.end();
    },
  };
}

async function defaultPoolFactory(
  options: ReadinessPoolOptions,
): Promise<ReadinessPool> {
  const pool = new Pool(options);
  pool.on("error", () => {});
  return pool as unknown as ReadinessPool;
}

async function checkPythonHealth(
  upstreamOrigin: string,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetchImplementation(
      new URL("/api/healthz", upstreamOrigin),
      { redirect: "error", signal },
    );
    const body: unknown = await response.json();
    return (
      response.ok &&
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      body.status === "ok"
    );
  } catch {
    return false;
  }
}

async function checkDatabase(
  poolPromise: Promise<ReadinessPool>,
  signal: AbortSignal,
): Promise<string | undefined> {
  let client: ReadinessClient;
  try {
    client = await connectWithSignal(poolPromise, signal);
  } catch {
    return undefined;
  }

  let transactionStarted = false;
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    client.release(true);
  };
  signal.addEventListener("abort", destroy, { once: true });

  let migrationId: string | undefined;
  try {
    await raceWithSignal(client.query("BEGIN READ ONLY"), signal);
    transactionStarted = true;
    await raceWithSignal(client.query("SELECT 1"), signal);
    const result = await raceWithSignal(client.query(LEDGER_QUERY), signal);
    const value = result.rows[0]?.migrationId;
    if (typeof value === "string") migrationId = value;
  } catch {
    migrationId = undefined;
  }

  if (transactionStarted && !signal.aborted) {
    try {
      await raceWithSignal(client.query("ROLLBACK"), signal);
    } catch {
      migrationId = undefined;
      destroy();
    }
  }

  signal.removeEventListener("abort", destroy);
  if (!destroyed) client.release();
  return migrationId;
}

function connectWithSignal(
  poolPromise: Promise<ReadinessPool>,
  signal: AbortSignal,
): Promise<ReadinessClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(signal.reason);
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener("abort", abort, { once: true });
    poolPromise
      .then((pool) => pool.connect())
      .then(
        (client) => {
          signal.removeEventListener("abort", abort);
          if (settled) {
            client.release(true);
            return;
          }
          settled = true;
          resolve(client);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          if (settled) return;
          settled = true;
          reject(error);
        },
      );
  });
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function loadReleaseMetadata(
  releaseMetadataUrl = new URL("./release.json", import.meta.url),
  signal?: AbortSignal,
): Promise<ReleaseMetadata | undefined> {
  try {
    const metadata: unknown = JSON.parse(
      await readFile(releaseMetadataUrl, { encoding: "utf8", signal }),
    );
    if (
      typeof metadata === "object" &&
      metadata !== null &&
      "currentMigrationId" in metadata &&
      typeof metadata.currentMigrationId === "string" &&
      MIGRATION_ID.test(metadata.currentMigrationId) &&
      "releaseSha" in metadata &&
      typeof metadata.releaseSha === "string" &&
      RELEASE_SHA.test(metadata.releaseSha)
    ) {
      return {
        currentMigrationId: metadata.currentMigrationId,
        releaseSha: metadata.releaseSha,
      };
    }
  } catch {
    // Missing or malformed build metadata means this release is not ready.
  }
  return undefined;
}

const defaultChecker = createReadinessChecker();

export const checkReadiness = defaultChecker.checkReadiness;
export const setReadinessDraining = defaultChecker.setDraining;
export const closeReadiness = defaultChecker.close;
