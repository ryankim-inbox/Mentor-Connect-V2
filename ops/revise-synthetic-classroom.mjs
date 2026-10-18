import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifySchemaAssets } from "../lib/db/tools/schema-assets.mjs";
import { validateAppliedMigrations } from "../lib/db/tools/migration-ledger.mjs";
import { diffCatalog } from "../lib/db/tools/catalog.mjs";
import {
  buildSyntheticPlan,
  SYNTHETIC_BATCH,
  SYNTHETIC_PASSWORD_LOCK,
} from "./seed-synthetic-classroom.mjs";
import {
  buildDemoRefreshPlan,
  APPROVED_DISTRICTS,
  APPROVED_TAGS,
  REVISION_ID,
} from "./demo-refresh-plan.mjs";
import {
  readRevisionCatalog,
  readRevisionSchemaState,
} from "./synthetic-revision-evidence.mjs";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const TABLE_COUNTS = {
  users: 983,
  questions: 782,
  requests: 782,
  schedules: 1966,
  request_tags: 782,
  request_applications: 782,
  request_comments: 391,
  request_events: 312,
};
const ALLOWED = {
  users: [
    "name",
    "bio",
    "subjects",
    "district_id",
    "location",
    "grade_level",
    "teaching_style",
  ],
  questions: ["subject", "topic", "message", "preferred_teaching_style"],
  requests: ["district_id", "title", "description", "matched_user_id"],
  request_tags: ["tag_id"],
  request_applications: ["applicant_id"],
  request_comments: ["author_id", "body"],
  request_events: ["mentor_id"],
};
const hex = /^[a-f0-9]{64}$/;
const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const canonical = (value) =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
const json = (value) => JSON.stringify(canonical(value));
const digest = (value) =>
  createHash("sha256").update(json(value)).digest("hex");
const same = (a, b) => json(a) === json(b);
const fail = (message) => {
  throw new Error(`synthetic revision: ${message}`);
};
const numericId = (id) =>
  /^[1-9][0-9]*$/.test(String(id)) && BigInt(id) <= 9223372036854775807n;

function validateInputs({
  receipt,
  expectedTarget,
  releaseSha,
  apply,
  expectedPreviewDigest,
  claim,
}) {
  if (
    receipt?.batchId !== SYNTHETIC_BATCH ||
    receipt.operation !== "inserted" ||
    !hex.test(receipt.planDigest ?? "")
  )
    fail("an acknowledged immutable insert receipt is required");
  if (!same(receipt.counts, TABLE_COUNTS))
    fail("receipt counts differ from the approved existing batch");
  for (const [table, count] of Object.entries(TABLE_COUNTS)) {
    const ids = receipt.ids?.[table];
    if (
      !Array.isArray(ids) ||
      ids.length !== count ||
      ids.some((id) => !numericId(id)) ||
      new Set(ids.map(String)).size !== count
    )
      fail(`receipt IDs invalid for ${table}`);
  }
  if (
    Object.keys(receipt.ids).sort().join() !==
    Object.keys(TABLE_COUNTS).sort().join()
  )
    fail("receipt contains an unapproved table");
  if (
    !expectedTarget?.database ||
    !expectedTarget?.user ||
    !Object.hasOwn(expectedTarget, "serverAddress") ||
    !Object.hasOwn(expectedTarget, "serverPort")
  )
    fail(
      "exact target database, user, serverAddress and serverPort are required",
    );
  if (!/^[a-f0-9]{40}$/.test(releaseSha ?? ""))
    fail("reviewed releaseSha required");
  if (
    apply &&
    (!hex.test(expectedPreviewDigest ?? "") ||
      claim?.revisionId !== REVISION_ID ||
      claim?.previewDigest !== expectedPreviewDigest ||
      claim?.releaseSha !== releaseSha ||
      claim?.state !== "claimed" ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(claim?.attemptId ?? ""))
  )
    fail(
      "apply requires exact preview digest and externally consumed immutable revision claim",
    );
}

async function targetIdentity(client, expectedTarget, apply) {
  const row = (
    await client.query(
      `SELECT current_database() AS database,current_user AS user,session_user AS "sessionUser",inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort",current_setting('transaction_read_only') AS "readOnly",current_setting('session_replication_role') AS "replicationRole"`,
    )
  ).rows[0];
  for (const field of ["database", "user", "serverAddress", "serverPort"])
    if (row[field] !== expectedTarget[field])
      fail(`target ${field} does not match`);
  if (row.sessionUser !== row.user || row.replicationRole !== "origin")
    fail("wrong role or replication scope");
  if (apply && row.readOnly !== "off")
    fail("apply cannot run in read-only scope");
  return Object.fromEntries(
    ["database", "user", "serverAddress", "serverPort"].map((key) => [
      key,
      row[key],
    ]),
  );
}
async function noOtherClients(client) {
  // Do not filter on backend_type/state: PostgreSQL redacts them for other roles.
  await client.query("SELECT pg_stat_clear_snapshot()");
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
  );
  if (rows[0].n !== 0) fail("other database clients are connected");
}
async function readSequences(client) {
  const seqs = (
    await client.query(
      "SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
    )
  ).rows;
  const result = {};
  for (const { sequencename: name } of seqs)
    result[name] = (
      await client.query(
        `SELECT last_value::text,is_called FROM public.${quote(name)}`,
      )
    ).rows[0];
  return result;
}
async function rowHashes(client, table, excludedIds = []) {
  const { rows } = await client.query(
    `SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM public.${quote(table)} t ${excludedIds.length ? "WHERE id<>ALL($1::bigint[])" : ""} ORDER BY hash`,
    excludedIds.length ? [excludedIds] : [],
  );
  return { count: rows.length, digest: digest(rows.map((row) => row.hash)) };
}
async function authorityDigest(client) {
  const roles = (
    await client.query(
      `SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig FROM pg_roles ORDER BY rolname`,
    )
  ).rows;
  // to_jsonb captures version-specific membership options without auth secrets.
  const memberships = (
    await client.query(
      `SELECT r.rolname AS role,m.rolname AS member,g.rolname AS grantor,to_jsonb(a)-'roleid'-'member'-'grantor' AS options FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor ORDER BY r.rolname,m.rolname,g.rolname`,
    )
  ).rows;
  return digest({ roles, memberships });
}

async function snapshot(client, tables, receipt, metadataIds = {}) {
  const fingerprints = {};
  for (const table of tables)
    fingerprints[table] = await rowHashes(
      client,
      table,
      receipt.ids[table] ?? metadataIds[table] ?? [],
    );
  const schema = await readRevisionSchemaState(client);
  const sequences = await readSequences(client);
  return {
    fingerprints,
    nonBatchDigest: digest(fingerprints),
    schemaDigest: digest(schema),
    authorityDigest: await authorityDigest(client),
    sequences,
  };
}
async function readBatch(client, receipt) {
  const batch = {};
  for (const table of Object.keys(TABLE_COUNTS)) {
    const rows = (
      await client.query(
        `SELECT * FROM public.${quote(table)} WHERE id=ANY($1::bigint[])`,
        [receipt.ids[table]],
      )
    ).rows;
    const map = new Map(rows.map((row) => [String(row.id), row]));
    batch[table] = receipt.ids[table].map((id) => map.get(String(id)));
    if (batch[table].some((row) => !row))
      fail(`receipt row missing from ${table}`);
  }
  return batch;
}
async function checkReferences(client, receipt) {
  const fks = (
    await client.query(
      `SELECT ns.nspname AS schema,src.relname AS table,a.attname AS column,dst.relname AS target
 FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=src.relnamespace
 JOIN pg_class dst ON dst.oid=c.confrelid JOIN pg_namespace dn ON dn.oid=dst.relnamespace
 JOIN LATERAL unnest(c.conkey,c.confkey) AS keys(src,dst) ON true
 JOIN pg_attribute a ON a.attrelid=src.oid AND a.attnum=keys.src
 JOIN pg_attribute b ON b.attrelid=dst.oid AND b.attnum=keys.dst
 WHERE c.contype='f' AND dn.nspname='public' AND b.attname='id' AND dst.relname=ANY($1::text[])
 ORDER BY ns.nspname,src.relname,a.attname`,
      [Object.keys(TABLE_COUNTS)],
    )
  ).rows;
  for (const fk of fks) {
    const allowed = fk.schema === "public" ? receipt.ids[fk.table] : undefined;
    const { rows } = await client.query(
      `SELECT EXISTS(SELECT 1 FROM ${quote(fk.schema)}.${quote(fk.table)} WHERE ${quote(fk.column)}=ANY($1::bigint[]) ${allowed ? "AND id<>ALL($2::bigint[])" : ""}) AS found`,
      allowed ? [receipt.ids[fk.target], allowed] : [receipt.ids[fk.target]],
    );
    if (rows[0].found) fail(`unplanned cross-batch reference in ${fk.table}`);
  }
  const namespace = await client.query(
    `SELECT EXISTS(SELECT 1 FROM users WHERE (email LIKE $1 OR password_hash=$2) AND id<>ALL($3::bigint[]) UNION ALL SELECT 1 FROM requests WHERE request LIKE $4 AND id<>ALL($5::bigint[])) AS found`,
    [
      `%@${SYNTHETIC_BATCH}.invalid`,
      SYNTHETIC_PASSWORD_LOCK,
      receipt.ids.users,
      `${SYNTHETIC_BATCH}:%`,
      receipt.ids.requests,
    ],
  );
  if (namespace.rows[0].found) fail("unreceipted batch namespace row");
}
async function checkOldSeed(client, receipt, batch, tracking, districts, tags) {
  const oldDistricts = districts.filter((row) =>
    ["Classroom North", "Classroom South"].includes(row.name),
  );
  const oldTags = tags.filter((row) => ["Math", "Science"].includes(row.name));
  if (
    oldDistricts.length !== 2 ||
    oldTags.length !== 2 ||
    oldDistricts.some(
      (row) => row.county !== "Practice County" || row.type !== "high_school",
    )
  )
    fail("old seed reference metadata changed");
  const old = buildSyntheticPlan({
    asOf: receipt.asOf,
    trackingStartedAt: tracking,
    districts: oldDistricts,
    tags: oldTags,
  });
  if (digest(old) !== receipt.planDigest)
    fail("old seed plan differs from immutable receipt");
  const users = new Set([
    "student_id",
    "author_id",
    "user_id",
    "applicant_id",
    "matched_user_id",
    "mentor_id",
  ]);
  for (const table of Object.keys(TABLE_COUNTS)) {
    const expectedRows = [];
    for (let i = 0; i < old[table].length; i++) {
      const expected = Object.fromEntries(
        Object.entries(old[table][i]).map(([key, value]) => [
          key,
          value === null
            ? null
            : users.has(key)
              ? receipt.ids.users[value]
              : key === "request_id"
                ? receipt.ids.requests[value]
                : value,
        ]),
      );
      if (table === "requests")
        Object.assign(expected, {
          client_request_id: null,
          payload_hash: null,
        });
      expectedRows.push({ id: receipt.ids[table][i], ...expected });
      const actual = batch[table][i];
      for (const [key, value] of Object.entries(expected))
        if (!same(actual[key], value))
          fail(`old seed precondition differs for ${table}.${key}`);
    }
    // SQL also checks microseconds that JavaScript Date would truncate.
    const fields = Object.keys(expectedRows[0]);
    const result = await client.query(
      `SELECT count(*)::int AS n FROM public.${quote(table)} AS actual JOIN jsonb_populate_recordset(NULL::public.${quote(table)},$1::jsonb) AS expected ON actual.id=expected.id WHERE ${fields.map((field) => "actual." + quote(field) + " IS NOT DISTINCT FROM expected." + quote(field)).join(" AND ")}`,
      [JSON.stringify(expectedRows)],
    );
    if (result.rows[0].n !== expectedRows.length)
      fail(`old seed precise precondition differs for ${table}`);
  }
}
const normalized = (value) =>
  value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
function resolveMetadata(existing, approved, table, sequence) {
  const key = (row) =>
    table === "districts"
      ? `${normalized(row.name)}|${normalized(row.county)}`
      : normalized(row.name);
  const fields =
    table === "districts" ? ["name", "county", "type"] : ["name", "color"];
  const rows = existing.map((row) => ({ ...row })),
    inserts = [];
  let next =
    Math.max(
      ...existing.map((row) => row.id),
      Number(sequence.last_value) + (sequence.is_called ? 1 : 0) - 1,
    ) + 1;
  for (const item of approved) {
    const matches = rows.filter((row) => key(row) === key(item));
    if (matches.length > 1) fail(`duplicate natural key in ${table}`);
    if (
      matches.length &&
      !(table === "tags" && ["math", "science"].includes(key(item))) &&
      fields.some((field) => matches[0][field] !== item[field])
    )
      fail(`approved metadata conflicts in ${table}`);
    if (!matches.length) {
      const row = {
        id: next++,
        ...Object.fromEntries(fields.map((field) => [field, item[field]])),
      };
      rows.push(row);
      inserts.push(row);
    }
  }
  if (!Number.isSafeInteger(next) || next < 1 || next > 2147483647)
    fail(`metadata sequence range invalid for ${table}`);
  return { rows, inserts, next };
}
function validatePatches(plan, receipt, batch) {
  if (plan.batchId !== receipt.batchId || plan.revisionId !== REVISION_ID)
    fail("content plan identity mismatch");
  if (
    Object.keys(plan.updates).sort().join() !==
    Object.keys(ALLOWED).sort().join()
  )
    fail("content plan update scope differs");
  const projected = structuredClone(batch);
  for (const [table, fields] of Object.entries(ALLOWED)) {
    const patches = plan.updates[table];
    if (
      !Array.isArray(patches) ||
      patches.length !== TABLE_COUNTS[table] ||
      new Set(patches.map((p) => String(p.id))).size !== patches.length
    )
      fail(`content patch count invalid for ${table}`);
    const rows = new Map(projected[table].map((row) => [String(row.id), row]));
    for (const patch of patches) {
      if (
        !rows.has(String(patch.id)) ||
        !patch.changes ||
        !Object.keys(patch.changes).length ||
        Object.keys(patch.changes).some((key) => !fields.includes(key))
      )
        fail(`forbidden content update in ${table}`);
      Object.assign(rows.get(String(patch.id)), patch.changes);
    }
  }
  return projected;
}
function checkRelations(batch, tags, districts) {
  const users = new Map(batch.users.map((row) => [String(row.id), row]));
  const requests = new Map(batch.requests.map((row) => [String(row.id), row]));
  const subjects = new Map(tags.map((row) => [row.id, row.name]));
  const districtsMap = new Map(districts.map((row) => [row.id, row]));
  const requestTags = new Map(
    batch.request_tags.map((row) => [
      String(row.request_id),
      subjects.get(row.tag_id),
    ]),
  );
  const applications = new Map(
    batch.request_applications.map((row) => [String(row.request_id), row]),
  );
  for (let i = 0; i < batch.requests.length; i++) {
    const r = batch.requests[i],
      q = batch.questions[i],
      a = applications.get(String(r.id));
    const author = users.get(String(r.author_id)),
      mentor = users.get(String(a?.applicant_id));
    if (
      !author ||
      !mentor ||
      !["mentor", "both"].includes(mentor.role) ||
      !["high_school", "unified"].includes(
        districtsMap.get(r.district_id)?.type,
      ) ||
      author.district_id !== r.district_id ||
      mentor.district_id !== r.district_id ||
      !mentor.subjects.includes(requestTags.get(String(r.id))) ||
      !author.subjects.includes(q.subject) ||
      q.subject !== requestTags.get(String(r.id)) ||
      q.student_id !== r.author_id ||
      q.message !== r.description ||
      !same(q.preferred_times, r.preferred_times) ||
      r.matched_user_id !== (r.status === "open" ? null : mentor.id) ||
      a.status !== (r.status === "open" ? "pending" : "accepted")
    )
      fail("planned request, question or mentor relation is inconsistent");
  }
  for (const row of batch.request_comments)
    if (
      row.author_id !== applications.get(String(row.request_id))?.applicant_id
    )
      fail("planned comment relation is inconsistent");
  for (const row of batch.request_events)
    if (row.mentor_id !== requests.get(String(row.request_id))?.matched_user_id)
      fail("planned event relation is inconsistent");
}
function validateAuthority(prerequisites, evidence, now) {
  for (const [key, value] of Object.entries(evidence))
    if (prerequisites?.[key] !== value)
      fail(`prerequisite ${key} is not bound to this preview`);
  const recent = (value, max, label) => {
    const date = Date.parse(value);
    if (!Number.isFinite(date) || date > now + 1000 || now - date > max)
      fail(`${label} evidence is not fresh`);
  };
  const { backup, restore, writers } = prerequisites;
  if (
    !hex.test(backup?.sha256 ?? "") ||
    backup.targetDigest !== evidence.targetDigest ||
    backup.baselineDigest !== evidence.baselineDigest
  )
    fail("backup evidence does not match target and baseline");
  if (
    restore?.backupSha256 !== backup.sha256 ||
    restore.baselineDigest !== evidence.baselineDigest
  )
    fail("restore proof does not match backup and baseline");
  if (
    writers?.targetDigest !== evidence.targetDigest ||
    writers.releaseSha !== evidence.releaseSha
  )
    fail("writer evidence does not match target and release");
  recent(backup.createdAt, 30 * 60_000, "backup");
  recent(restore.verifiedAt, 5 * 60_000, "restore");
  recent(writers.verifiedAt, 5 * 60_000, "writer");
  if (Date.parse(restore.verifiedAt) < Date.parse(backup.createdAt))
    fail("restore predates backup");
}
async function insertMetadata(client, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]),
    values = [];
  const tuples = rows.map(
    (row) =>
      "(" +
      columns
        .map((key) => {
          values.push(row[key]);
          return "$" + values.length;
        })
        .join(",") +
      ")",
  );
  const result = await client.query(
    `INSERT INTO public.${quote(table)} (${columns.map(quote).join(",")}) VALUES ${tuples.join(",")}`,
    values,
  );
  if (result.rowCount !== rows.length)
    fail(`metadata insert count differs for ${table}`);
}
async function updateRows(client, table, patches) {
  const groups = new Map();
  for (const patch of patches) {
    const key = Object.keys(patch.changes).sort().join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: patch.id, ...patch.changes });
  }
  for (const [key, rows] of groups) {
    const columns = key.split(",");
    const result = await client.query(
      `UPDATE public.${quote(table)} AS target SET ${columns.map((column) => quote(column) + "=source." + quote(column)).join(",")} FROM jsonb_populate_recordset(NULL::public.${quote(table)},$1::jsonb) AS source WHERE target.id=source.id`,
      [JSON.stringify(rows)],
    );
    if (result.rowCount !== rows.length)
      fail(`update count differs for ${table}`);
  }
}

/**
 * No connection/credential/CLI support. Caller owns fresh backup+isolated restore,
 * immutable per-revision attempt consumption, writer-control evidence, and code freeze.
 * A rejected COMMIT acknowledgement is uncertain: never retry this call automatically.
 */
export async function reviseSyntheticClassroom(options) {
  const {
    client,
    receipt,
    expectedTarget,
    releaseSha,
    apply = false,
    expectedPreviewDigest,
    prerequisites,
    claim,
    refreshWriterEvidence,
  } = options;
  if (apply && typeof refreshWriterEvidence !== "function")
    fail("apply requires a fresh external writer-evidence reader");
  validateInputs({ ...options, apply });
  const assets = await verifySchemaAssets({ rootDir });
  let committing = false;
  await client.query(
    apply
      ? "BEGIN ISOLATION LEVEL READ COMMITTED"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL lock_timeout TO '5s'");
    await client.query("SET LOCAL statement_timeout TO '60s'");
    await client.query(
      "SET LOCAL idle_in_transaction_session_timeout TO '60s'",
    );
    const target = await targetIdentity(client, expectedTarget, apply);
    if (apply) {
      await noOtherClients(client);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        assets.ledger.advisoryLockKey,
      ]);
      await client.query(
        `LOCK TABLE ${[
          ...assets.catalog.tables,
          "mentor_connect_schema_migrations",
        ]
          .sort()
          .map((table) => "public." + quote(table))
          .join(",")} IN SHARE ROW EXCLUSIVE MODE NOWAIT`,
      );
    }
    const applied = (
      await client.query(
        'SELECT ordinal,migration_id AS "migrationId",checksum,applied_at AS "appliedAt",app_sha AS "appSha" FROM mentor_connect_schema_migrations ORDER BY ordinal',
      )
    ).rows;
    if (validateAppliedMigrations(assets.ledger.migrations, applied).length)
      fail("schema migration ledger is not current");
    const actualCatalog = await readRevisionCatalog(client);
    if (diffCatalog(assets.catalog, actualCatalog).length)
      fail("schema catalog differs from reviewed migration 0008");
    const unsafe = (
      await client.query(
        "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relrowsecurity OR c.relforcerowsecurity) UNION ALL SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS found",
      )
    ).rows[0].found;
    if (unsafe)
      fail("unreviewed row security or trigger changes the update scope");
    await checkReferences(client, receipt);
    const batch = await readBatch(client, receipt);
    const districts = (
      await client.query("SELECT * FROM districts ORDER BY id")
    ).rows;
    const tags = (await client.query("SELECT * FROM tags ORDER BY id")).rows;
    const tracking = (
      await client.query(
        "SELECT to_timestamp(ceil(extract(epoch FROM occurred_at)*1000)/1000) AS occurred_at FROM request_events WHERE kind='tracking_started'",
      )
    ).rows[0]?.occurred_at;
    await checkOldSeed(client, receipt, batch, tracking, districts, tags);
    const tables = [
      ...assets.catalog.tables,
      "mentor_connect_schema_migrations",
    ].sort();
    const before = await snapshot(client, tables, receipt);
    const districtPlan = resolveMetadata(
      districts,
      APPROVED_DISTRICTS,
      "districts",
      before.sequences.districts_id_seq,
    );
    const tagPlan = resolveMetadata(
      tags,
      APPROVED_TAGS,
      "tags",
      before.sequences.tags_id_seq,
    );
    const metadata = {
      inserts: { districts: districtPlan.inserts, tags: tagPlan.inserts },
      next: { districts: districtPlan.next, tags: tagPlan.next },
    };
    const plan = buildDemoRefreshPlan({
      receipt,
      batch,
      districts: districtPlan.rows,
      tags: tagPlan.rows,
    });
    const projected = validatePatches(plan, receipt, batch);
    checkRelations(projected, tagPlan.rows, districtPlan.rows);
    const evidence = {
      targetDigest: digest(target),
      baselineDigest: digest({ before, batchDigest: digest(batch) }),
      schemaDigest: before.schemaDigest,
      catalogDigest: assets.version.catalogSha256,
      releaseSha,
    };
    const previewDigest = digest({
      revisionId: REVISION_ID,
      receiptDigest: digest(receipt),
      evidence,
      metadata,
      plan,
    });
    evidence.previewDigest = previewDigest;
    const preview = {
      operation: "planned-revision",
      batchId: SYNTHETIC_BATCH,
      revisionId: REVISION_ID,
      previewDigest,
      evidence,
      metadata,
      plan,
      before,
      ids: receipt.ids,
    };
    if (!apply) {
      await client.query("ROLLBACK");
      return preview;
    }
    if (expectedPreviewDigest !== previewDigest)
      fail("preview digest changed; a fresh reviewed preview is required");
    validateAuthority(prerequisites, evidence, Date.now());
    const writerObservations = [];
    const refreshWriters = async (phase) => {
      const observation = await refreshWriterEvidence({
        phase,
        previewDigest,
        targetDigest: evidence.targetDigest,
        releaseSha,
      });
      if (!hex.test(observation?.evidenceDigest ?? ""))
        fail("external writer evidence digest required");
      validateAuthority(
        { ...prerequisites, writers: observation },
        evidence,
        Date.now(),
      );
      writerObservations.push({
        phase,
        verifiedAt: observation.verifiedAt,
        targetDigest: observation.targetDigest,
        releaseSha: observation.releaseSha,
        evidenceDigest: observation.evidenceDigest,
      });
    };
    await refreshWriters("locked-prewrite");
    await noOtherClients(client);
    await insertMetadata(client, "districts", metadata.inserts.districts);
    await insertMetadata(client, "tags", metadata.inserts.tags);
    for (const [table, patches] of Object.entries(plan.updates))
      await updateRows(client, table, patches);
    for (const table of ["districts", "tags"])
      if (metadata.inserts[table].length)
        await client.query(
          `ALTER SEQUENCE public.${quote(table + "_id_seq")} RESTART WITH ${metadata.next[table]}`,
        );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const afterBatch = await readBatch(client, receipt);
    if (!same(afterBatch, projected))
      fail("post-update batch differs from exact allowlisted plan");
    checkRelations(afterBatch, tagPlan.rows, districtPlan.rows);
    await checkReferences(client, receipt);
    const newIds = Object.fromEntries(
      Object.entries(metadata.inserts).map(([table, rows]) => [
        table,
        rows.map((row) => row.id),
      ]),
    );
    const after = await snapshot(client, tables, receipt, newIds);
    if (
      after.nonBatchDigest !== before.nonBatchDigest ||
      after.schemaDigest !== before.schemaDigest ||
      after.authorityDigest !== before.authorityDigest
    )
      fail("nonbatch fingerprints or schema/grants changed");
    const expectedSequences = structuredClone(before.sequences);
    for (const table of ["districts", "tags"])
      if (metadata.inserts[table].length)
        expectedSequences[table + "_id_seq"] = {
          last_value: String(metadata.next[table]),
          is_called: false,
        };
    if (!same(after.sequences, expectedSequences))
      fail("unexpected sequence state change");
    for (const table of ["districts", "tags"]) {
      const actual = (
        await client.query(
          `SELECT * FROM ${quote(table)} WHERE id=ANY($1::int[]) ORDER BY id`,
          [newIds[table]],
        )
      ).rows;
      if (
        !same(
          actual.map(({ created_at, ...row }) => row),
          metadata.inserts[table],
        )
      )
        fail("inserted metadata differs");
    }
    validateAuthority(prerequisites, evidence, Date.now());
    await refreshWriters("precommit");
    await targetIdentity(client, expectedTarget, true);
    await noOtherClients(client);
    committing = true;
    await client.query("COMMIT");
    return {
      ...preview,
      operation: "revised",
      attemptId: claim.attemptId,
      after,
      writerObservations,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (committing) {
      const uncertain = new Error(
        "synthetic revision: COMMIT acknowledgement uncertain; consume attempt and inspect independently; never retry",
      );
      uncertain.code = "REVISION_COMMIT_UNCERTAIN";
      throw uncertain;
    }
    throw error;
  }
}

/** Read only in a caller-owned consistent snapshot; pins local UTC for exact hashes. */
export async function readSyntheticRevisionBaseline({ client, receipt }) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const assets = await verifySchemaAssets({ rootDir });
  if (
    receipt?.batchId !== SYNTHETIC_BATCH ||
    !same(receipt.counts, TABLE_COUNTS)
  )
    fail("baseline requires exact original receipt");
  const catalog = await readRevisionCatalog(client);
  if (diffCatalog(assets.catalog, catalog).length)
    fail("baseline schema catalog differs from approved schema");
  const tables = [
    ...assets.catalog.tables,
    "mentor_connect_schema_migrations",
  ].sort();
  const before = await snapshot(client, tables, receipt);
  const batchDigest = digest(await readBatch(client, receipt));
  const fullRowDigests = {};
  for (const table of tables)
    fullRowDigests[table] = await rowHashes(client, table);
  return {
    before,
    batchDigest,
    baselineDigest: digest({ before, batchDigest }),
    fullRowDigests,
  };
}
