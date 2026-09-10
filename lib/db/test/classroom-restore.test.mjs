import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import pg from "pg";
import { bootstrapClassroom } from "../../../ops/bootstrap-classroom.mjs";
import { verifySchemaAssets } from "../tools/schema-assets.mjs";
import { diffCatalog, introspectCatalog } from "../tools/catalog.mjs";
const backupModule = await import("../../../ops/backup-classroom.mjs").catch(
  () => ({}),
);
const restoreModule = await import("../../../ops/restore-classroom.mjs").catch(
  () => ({}),
);
const sharedModule = await import("../../../ops/classroom-snapshot.mjs").catch(
  () => ({}),
);
const execFile = promisify(execFileCallback);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const integration = process.env.TEST_RESTORE_BASE_URL ? test : test.skip;

test("validated native connection preserves TLS and cannot inherit another PG target", () => {
  assert.equal(typeof sharedModule.classroomConnection, "function");
  const connection = sharedModule.classroomConnection(
    {
      databaseUrl:
        "postgresql://teacher:private-canary@provider.invalid/classroom?sslmode=verify-full&sslrootcert=%2Ftmp%2Fprovider-ca.pem",
      allowedHost: "provider.invalid",
      databaseName: "classroom",
    },
    {
      PATH: "/bin",
      PGHOST: "wrong.invalid",
      PGDATABASE: "wrong",
      PGSERVICE: "wrong",
      PGOPTIONS: "-c role=wrong",
      PGSSLMODE: "disable",
    },
  );
  assert.equal(connection.env.PGHOST, "provider.invalid");
  assert.equal(connection.env.PGDATABASE, "classroom");
  assert.equal(connection.env.PGSSLMODE, "verify-full");
  assert.equal(connection.env.PGSSLROOTCERT, "/tmp/provider-ca.pem");
  assert.equal(connection.env.PGPASSWORD, "private-canary");
  assert.equal(connection.env.PGSERVICE, undefined);
  assert.equal(connection.env.PGOPTIONS, undefined);
  assert.equal(
    sharedModule.classroomConnection({
      databaseUrl:
        "postgresql://provider.invalid/classroom?sslrootcert=%2Ftmp%2Fprovider-ca.pem",
      allowedHost: "provider.invalid",
      databaseName: "classroom",
    }).env.PGSSLMODE,
    "verify-full",
  );
  assert.throws(
    () =>
      sharedModule.classroomConnection({
        databaseUrl:
          "postgresql://provider.invalid/classroom?ssl=false&sslrootcert=%2Ftmp%2Fprovider-ca.pem",
        allowedHost: "provider.invalid",
        databaseName: "classroom",
      }),
    /TLS/,
  );

  for (const query of ["host=wrong", "database=wrong", "user=wrong"]) {
    assert.throws(
      () =>
        sharedModule.classroomConnection({
          databaseUrl: `postgresql://provider.invalid/classroom?${query}`,
          allowedHost: "provider.invalid",
          databaseName: "classroom",
        }),
      /unsupported/,
    );
  }
  assert.throws(
    () =>
      sharedModule.classroomConnection({
        databaseUrl: "postgresql://provider.invalid/host%3Dwrong",
        allowedHost: "provider.invalid",
        databaseName: "host=wrong",
      }),
    /database name/,
  );
});

integration(
  "native snapshot restores counts, full ledger and catalog and rejects unsafe targets before spawn",
  async (t) => {
    assert.equal(typeof backupModule.backupClassroom, "function");
    assert.equal(typeof restoreModule.restoreClassroom, "function");
    const base = process.env.TEST_RESTORE_BASE_URL;
    const directory = await mkdtemp(
      path.join(tmpdir(), "classroom-backup-test-"),
    );
    const source = new pg.Client({
      connectionString: `${base}/restore_source`,
    });
    const target = new pg.Client({ connectionString: `${base}/restore_empty` });
    const occupied = new pg.Client({
      connectionString: `${base}/restore_occupied`,
    });
    await Promise.all([source.connect(), target.connect(), occupied.connect()]);
    try {
      const { ledger, catalog } = await verifySchemaAssets({ rootDir });
      await bootstrapClassroom({
        client: source,
        ledger,
        appSha: "e".repeat(40),
      });
      await source.query(
        "INSERT INTO districts(name, county) VALUES ('snapshot district', 'fixture county')",
      );
      await occupied.query(
        "CREATE SCHEMA occupied; CREATE TABLE occupied.keep_me(id integer); INSERT INTO occupied.keep_me VALUES(42)",
      );
      const expectedLedger = (
        await source.query(
          "SELECT * FROM mentor_connect_schema_migrations ORDER BY ordinal",
        )
      ).rows;
      // A real writer commits after the exporter has captured counts and ledger,
      // immediately before the native dump imports that snapshot.
      const { stdout: nativeDump } = await execFile("which", ["pg_dump"]);
      const snapshotBin = path.join(directory, "snapshot-bin");
      await mkdir(snapshotBin);
      await writeFile(
        path.join(snapshotBin, "pg_dump"),
        `#!/bin/sh
psql -X -q -c "INSERT INTO districts(name, county) VALUES ('later district', 'fixture county'); UPDATE mentor_connect_schema_migrations SET app_sha = repeat('f', 40)" >/dev/null || exit 98
exec '${nativeDump.trim()}' "$@"
`,
        { mode: 0o700 },
      );
      const originalPath = process.env.PATH;
      let result;
      try {
        process.env.PATH = `${snapshotBin}:${originalPath}`;
        result = await backupModule.backupClassroom({
          databaseUrl: `${base}/restore_source`,
          allowedHost: "127.0.0.1",
          databaseName: "restore_source",
          outputDir: directory,
        });
      } finally {
        process.env.PATH = originalPath;
      }
      assert.equal(
        (await source.query("SELECT count(*)::integer AS count FROM districts"))
          .rows[0].count,
        2,
      );
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
      assert.equal(manifest.schemaVersion, "0002");
      assert.equal(Object.keys(manifest.counts).length, 13);
      assert.equal(manifest.counts.districts, "1");
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(result.dumpPath)).mode & 0o777, 0o600);
      assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Date.parse(manifest.capturedAt));
      assert.doesNotMatch(
        await readFile(result.manifestPath, "utf8"),
        /postgresql:\/\//,
      );
      const sentinelDir = path.join(directory, "bin");
      await mkdir(sentinelDir);
      const marker = path.join(directory, "spawned");
      await writeFile(
        path.join(sentinelDir, "pg_restore"),
        `#!/bin/sh\ntouch '${marker}'\nexit 99\n`,
        { mode: 0o700 },
      );
      const restorePath = path.join(rootDir, "ops/restore-classroom.mjs");
      const environment = {
        ...process.env,
        PATH: `${sentinelDir}:${process.env.PATH}`,
        RESTORE_ALLOWED_HOST: "127.0.0.1",
        RESTORE_EXPECTED_DATABASE: "restore_empty",
        RESTORE_DATABASE_URL: `${base}/restore_empty`,
      };
      for (const override of [
        { RESTORE_EXPECTED_DATABASE: "wrong" },
        {
          RESTORE_EXPECTED_DATABASE: "restore_source",
          RESTORE_DATABASE_URL: `${base}/restore_source`,
        },
        {
          RESTORE_EXPECTED_DATABASE: "restore_occupied",
          RESTORE_DATABASE_URL: `${base}/restore_occupied`,
        },
      ]) {
        await assert.rejects(
          execFile(process.execPath, [restorePath, result.dumpPath], {
            env: { ...environment, ...override },
          }),
          (error) =>
            error.code === 1 && /mismatch|different|empty/.test(error.stderr),
        );
        await assert.rejects(stat(marker), { code: "ENOENT" });
      }
      await assert.rejects(
        execFile(process.execPath, [restorePath, result.dumpPath], {
          env: {
            ...environment,
            RESTORE_DATABASE_URL: `${base}/invalid_secret_canary_db`,
            RESTORE_EXPECTED_DATABASE: "invalid_secret_canary_db",
          },
        }),
        (error) => {
          assert.doesNotMatch(error.stderr, /secret_canary/);
          return error.code === 1;
        },
      );
      const dump = await readFile(result.dumpPath);
      await writeFile(
        result.dumpPath,
        Buffer.concat([dump, Buffer.from("corrupt")]),
      );
      await assert.rejects(
        execFile(process.execPath, [restorePath, result.dumpPath], {
          env: environment,
        }),
        (error) => error.code === 1 && /checksum/.test(error.stderr),
      );
      await assert.rejects(stat(marker), { code: "ENOENT" });
      await writeFile(result.dumpPath, dump);
      const restored = await restoreModule.restoreClassroom({
        databaseUrl: `${base}/restore_empty`,
        allowedHost: "127.0.0.1",
        databaseName: "restore_empty",
        dumpPath: result.dumpPath,
      });
      assert.equal(restored.verified, true);
      assert.equal(restored.schemaVersion, "0002");
      assert.equal(restored.ledgerChecksum, manifest.ledgerChecksum);
      assert.deepEqual(restored.counts, manifest.counts);
      assert.ok(restored.elapsedMs > 0 && restored.elapsedMs < 30 * 60 * 1000);
      assert.deepEqual(
        diffCatalog(catalog, await introspectCatalog(target)),
        [],
      );
      assert.deepEqual(
        (
          await target.query(
            "SELECT * FROM mentor_connect_schema_migrations ORDER BY ordinal",
          )
        ).rows,
        expectedLedger,
      );
      assert.equal(
        (await occupied.query("SELECT id FROM occupied.keep_me")).rows[0].id,
        42,
      );
      t.diagnostic(
        `native restore elapsedMs=${restored.elapsedMs}; backup=${path.basename(result.dumpPath)}; all 13 counts and catalog match`,
      );
    } finally {
      await Promise.all([source.end(), target.end(), occupied.end()]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("native failures discard stderr containing URL and password canaries", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "classroom-native-error-"),
  );
  try {
    const executable = path.join(directory, "failure");
    await writeFile(
      executable,
      "#!/bin/sh\necho 'postgresql://user:password-canary@host/db secret-canary' >&2\nexit 9\n",
      { mode: 0o700 },
    );
    await assert.rejects(
      sharedModule.nativeCommand(executable, [], { PATH: "/bin" }),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /password-canary|secret-canary|postgresql:/,
        );
        assert.equal(error.stderr, undefined);
        return /exit 9/.test(error.message);
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
