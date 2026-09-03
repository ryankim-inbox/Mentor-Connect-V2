import { diffCatalog } from "./catalog.mjs";

export function collectPlanIndexes(explainDocument) {
  const indexes = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value["Index Name"] === "string") {
      indexes.add(value["Index Name"]);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(explainDocument);
  return [...indexes].sort();
}

const PREFLIGHT_CHECKS = [
  {
    id: "duplicate_block_pair",
    category: "duplicate",
    candidateQuery: `
      SELECT jsonb_build_object(
        'blockerId', blocker_id,
        'blockedUserId', blocked_user_id,
        'duplicateCount', count(*)
      ) AS candidate
      FROM public.blocks
      GROUP BY blocker_id, blocked_user_id
      HAVING count(*) > 1
    `,
    orderBy: "blocker_id, blocked_user_id",
  },
  {
    id: "duplicate_dm_pair",
    category: "duplicate",
    candidateQuery: `
      SELECT jsonb_build_object(
        'lowerUserId', least(user_a_id, user_b_id),
        'upperUserId', greatest(user_a_id, user_b_id),
        'duplicateCount', count(*)
      ) AS candidate
      FROM public.dm_conversations
      GROUP BY least(user_a_id, user_b_id), greatest(user_a_id, user_b_id)
      HAVING count(*) > 1
    `,
    orderBy: "least(user_a_id, user_b_id), greatest(user_a_id, user_b_id)",
  },
  {
    id: "duplicate_request_tag_pair",
    category: "duplicate",
    candidateQuery: `
      SELECT jsonb_build_object(
        'requestId', request_id,
        'tagId', tag_id,
        'duplicateCount', count(*)
      ) AS candidate
      FROM public.request_tags
      GROUP BY request_id, tag_id
      HAVING count(*) > 1
    `,
    orderBy: "request_id, tag_id",
  },
  {
    id: "invalid_chat_room_type",
    category: "invalid_enum",
    candidateQuery: `
      SELECT jsonb_build_object('id', id, 'value', type) AS candidate
      FROM public.chat_rooms
      WHERE type NOT IN ('global', 'district')
    `,
    orderBy: "id",
  },
  {
    id: "invalid_requests_role",
    category: "invalid_enum",
    candidateQuery: `
      SELECT jsonb_build_object('id', id, 'value', role) AS candidate
      FROM public.requests
      WHERE role NOT IN ('mentee', 'mentor')
    `,
    orderBy: "id",
  },
  {
    id: "invalid_requests_status",
    category: "invalid_enum",
    candidateQuery: `
      SELECT jsonb_build_object('id', id, 'value', status) AS candidate
      FROM public.requests
      WHERE status NOT IN ('open', 'matched', 'closed')
    `,
    orderBy: "id",
  },
  {
    id: "invalid_users_role",
    category: "invalid_enum",
    candidateQuery: `
      SELECT jsonb_build_object('id', id, 'value', role) AS candidate
      FROM public.users
      WHERE role NOT IN ('mentee', 'mentor', 'both')
    `,
    orderBy: "id",
  },
  {
    id: "noncanonical_dm_pair",
    category: "self_or_ordered_relation",
    candidateQuery: `
      SELECT jsonb_build_object(
        'id', id, 'userAId', user_a_id, 'userBId', user_b_id
      ) AS candidate
      FROM public.dm_conversations
      WHERE user_a_id >= user_b_id
    `,
    orderBy: "id",
  },
  {
    id: "self_block",
    category: "self_relation",
    candidateQuery: `
      SELECT jsonb_build_object(
        'id', id, 'blockerId', blocker_id, 'blockedUserId', blocked_user_id
      ) AS candidate
      FROM public.blocks
      WHERE blocker_id = blocked_user_id
    `,
    orderBy: "id",
  },
  {
    id: "self_report",
    category: "self_relation",
    candidateQuery: `
      SELECT jsonb_build_object(
        'id', id, 'reporterId', reporter_id, 'reportedUserId', reported_user_id
      ) AS candidate
      FROM public.reports
      WHERE reporter_id = reported_user_id
    `,
    orderBy: "id",
  },
];

const ORPHAN_RELATIONS = [
  ["orphan_block_blocked_user", "blocks", "blocked_user_id", "users"],
  ["orphan_block_blocker", "blocks", "blocker_id", "users"],
  ["orphan_chat_message_room", "chat_messages", "room_id", "chat_rooms"],
  ["orphan_chat_message_sender", "chat_messages", "sender_id", "users"],
  ["orphan_chat_room_district", "chat_rooms", "district_id", "districts"],
  ["orphan_dm_conversation_user_a", "dm_conversations", "user_a_id", "users"],
  ["orphan_dm_conversation_user_b", "dm_conversations", "user_b_id", "users"],
  [
    "orphan_dm_message_conversation",
    "dm_messages",
    "conversation_id",
    "dm_conversations",
  ],
  ["orphan_dm_message_sender", "dm_messages", "sender_id", "users"],
  ["orphan_question_student", "questions", "student_id", "users"],
  ["orphan_report_reported_user", "reports", "reported_user_id", "users"],
  ["orphan_report_reporter", "reports", "reporter_id", "users"],
  ["orphan_request_author", "requests", "author_id", "users"],
  ["orphan_request_district", "requests", "district_id", "districts"],
  ["orphan_request_matched_user", "requests", "matched_user_id", "users"],
  ["orphan_request_tag_request", "request_tags", "request_id", "requests"],
  ["orphan_request_tag_tag", "request_tags", "tag_id", "tags"],
  ["orphan_schedule_user", "schedules", "user_id", "users"],
  ["orphan_user_district", "users", "district_id", "districts"],
].map(([id, childTable, childColumn, parentTable]) => ({
  id,
  category: "orphan",
  candidateQuery: `
    SELECT jsonb_build_object(
      'id', child.id, 'missingId', child.${childColumn}
    ) AS candidate
    FROM public.${childTable} AS child
    LEFT JOIN public.${parentTable} AS parent
      ON parent.id = child.${childColumn}
    WHERE child.${childColumn} IS NOT NULL AND parent.id IS NULL
  `,
  orderBy: "child.id",
}));

const ALL_PREFLIGHT_CHECKS = [...PREFLIGHT_CHECKS, ...ORPHAN_RELATIONS].sort(
  (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
);

async function inReadOnlyTransaction(client, run) {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    const mode = await client.query("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") {
      throw new Error("integrity inspection requires a read-only transaction");
    }
    const result = await run();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runIntegrityPreflight(
  client,
  { candidateLimit = 1_000, pageSize = 100, writeEvidencePage } = {},
) {
  if (
    !Number.isSafeInteger(candidateLimit) ||
    candidateLimit < 1 ||
    candidateLimit > 1_000
  ) {
    throw new Error("candidateLimit must be an integer between 1 and 1000");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("pageSize must be an integer between 1 and 100");
  }
  if (
    writeEvidencePage !== undefined &&
    typeof writeEvidencePage !== "function"
  ) {
    throw new Error("writeEvidencePage must be a function");
  }

  return inReadOnlyTransaction(client, async () => {
    const checks = [];
    const checkCounts = new Map();
    for (const check of ALL_PREFLIGHT_CHECKS) {
      const result = await client.query(`
        SELECT count(*)::text AS "violationCount"
        FROM (${check.candidateQuery}) AS preflight_violations
      `);
      const rawCount = result.rows[0]?.violationCount;
      if (typeof rawCount !== "string" || !/^\d+$/.test(rawCount)) {
        throw new Error("preflight count query returned an invalid count");
      }
      const count = BigInt(rawCount);
      checkCounts.set(check.id, count);
      checks.push({
        id: check.id,
        category: check.category,
        violationCount: count.toString(),
      });
    }
    const violationCount = [...checkCounts.values()].reduce(
      (count, checkCount) => count + checkCount,
      0n,
    );
    if (violationCount > 0n && !writeEvidencePage) {
      throw new Error(
        "a protected evidence writer is required when violations exist",
      );
    }

    let candidatesWritten = 0;
    if (writeEvidencePage) {
      for (const check of ALL_PREFLIGHT_CHECKS) {
        const checkCount = checkCounts.get(check.id);
        let offset = 0;
        let pageNumber = 1;
        while (
          BigInt(offset) < checkCount &&
          candidatesWritten < candidateLimit
        ) {
          const remainingForCheck = checkCount - BigInt(offset);
          const limit = Math.min(
            pageSize,
            Number(
              remainingForCheck > BigInt(pageSize)
                ? BigInt(pageSize)
                : remainingForCheck,
            ),
            candidateLimit - candidatesWritten,
          );
          const result = await client.query(
            `${check.candidateQuery} ORDER BY ${check.orderBy} LIMIT $1 OFFSET $2`,
            [limit, offset],
          );
          if (result.rows.length > limit) {
            throw new Error(
              "preflight evidence query exceeded its requested page size",
            );
          }
          if (result.rows.length === 0) break;
          const candidates = result.rows.map((row) => row.candidate);
          await writeEvidencePage({
            formatVersion: 1,
            checkId: check.id,
            category: check.category,
            pageNumber,
            candidateOffset: offset,
            candidates,
          });
          candidatesWritten += candidates.length;
          offset += candidates.length;
          pageNumber += 1;
          if (candidates.length < limit) break;
        }
      }
    }

    return {
      readOnly: true,
      cleanupPerformed: false,
      violationCount: violationCount.toString(),
      checks,
      quarantine: {
        required: violationCount > 0n,
        candidateCount: violationCount.toString(),
      },
      evidence: {
        protectedSink: writeEvidencePage !== undefined,
        candidateLimit,
        candidatesWritten,
        truncated: BigInt(candidatesWritten) < violationCount,
      },
      approvalTaskRequired: violationCount > 0n,
    };
  });
}

export async function verifyConstraintCatalog(client, expectedConstraints) {
  return inReadOnlyTransaction(client, async () => {
    const result = await client.query(`
      SELECT
        relation.relname AS "table",
        constraint_row.conname AS name,
        constraint_row.contype::text AS type,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class relation
        ON relation.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname <> 'mentor_connect_schema_migrations'
      ORDER BY relation.relname, constraint_row.conname
    `);
    const differences = diffCatalog(
      {
        tables: [],
        columns: [],
        constraints: expectedConstraints,
        indexes: [],
      },
      { tables: [], columns: [], constraints: result.rows, indexes: [] },
    );
    return { readOnly: true, differences };
  });
}

const EXPLAIN_QUERIES = [
  {
    id: "district_lookup",
    sql: "SELECT id FROM public.users WHERE district_id = $1 ORDER BY id LIMIT 20",
    parameters: [2],
    expectedIndexes: ["idx_users_district", "idx_users_matching_lookup"],
  },
  {
    id: "email_lookup",
    sql: "SELECT id FROM public.users WHERE email = $1",
    parameters: ["user-00001@example.test"],
    expectedIndexes: ["users_email_key"],
  },
  {
    id: "matching_lookup",
    sql: "SELECT id FROM public.users WHERE district_id = $1 AND role = $2 AND is_verified = $3 ORDER BY id LIMIT 20",
    parameters: [2, "mentee", true],
    expectedIndexes: ["idx_users_matching_lookup"],
  },
  {
    id: "open_request_lookup",
    sql: "SELECT id FROM public.requests WHERE district_id = $1 AND status = 'open' AND role = $2 ORDER BY created_at DESC, id LIMIT 20",
    parameters: [1, "mentor"],
    expectedIndexes: ["idx_requests_open_matching_lookup"],
  },
  {
    id: "request_tag_lookup",
    sql: "SELECT request_id FROM public.request_tags WHERE tag_id = $1 ORDER BY request_id LIMIT 20",
    parameters: [2],
    expectedIndexes: ["idx_request_tags_tag"],
  },
  {
    id: "status_lookup",
    sql: "SELECT id FROM public.requests WHERE status = $1 ORDER BY id LIMIT 20",
    parameters: ["open"],
    expectedIndexes: ["idx_requests_status"],
  },
];

export async function verifyExplainPlans(client) {
  return inReadOnlyTransaction(client, async () => {
    const queries = [];
    for (const specification of EXPLAIN_QUERIES) {
      const result = await client.query(
        `EXPLAIN (FORMAT JSON, COSTS FALSE) ${specification.sql}`,
        specification.parameters,
      );
      const document = result.rows[0]["QUERY PLAN"][0];
      const indexes = collectPlanIndexes(document);
      const matchedIndex = specification.expectedIndexes.find((index) =>
        indexes.includes(index),
      );
      queries.push({
        id: specification.id,
        expectedIndexes: specification.expectedIndexes,
        indexes,
        matched: matchedIndex !== undefined,
      });
    }
    return {
      readOnly: true,
      queries,
      failures: queries
        .filter((query) => !query.matched)
        .map((query) => query.id),
    };
  });
}
