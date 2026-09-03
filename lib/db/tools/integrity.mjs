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
    query: `
      SELECT jsonb_build_object(
        'blockerId', blocker_id,
        'blockedUserId', blocked_user_id,
        'rowIds', jsonb_agg(id ORDER BY id)
      ) AS candidate
      FROM public.blocks
      GROUP BY blocker_id, blocked_user_id
      HAVING count(*) > 1
      ORDER BY blocker_id, blocked_user_id
    `,
  },
  {
    id: "duplicate_dm_pair",
    category: "duplicate",
    query: `
      SELECT jsonb_build_object(
        'lowerUserId', least(user_a_id, user_b_id),
        'upperUserId', greatest(user_a_id, user_b_id),
        'rowIds', jsonb_agg(id ORDER BY id)
      ) AS candidate
      FROM public.dm_conversations
      GROUP BY least(user_a_id, user_b_id), greatest(user_a_id, user_b_id)
      HAVING count(*) > 1
      ORDER BY least(user_a_id, user_b_id), greatest(user_a_id, user_b_id)
    `,
  },
  {
    id: "duplicate_request_tag_pair",
    category: "duplicate",
    query: `
      SELECT jsonb_build_object(
        'requestId', request_id,
        'tagId', tag_id,
        'rowIds', jsonb_agg(id ORDER BY id)
      ) AS candidate
      FROM public.request_tags
      GROUP BY request_id, tag_id
      HAVING count(*) > 1
      ORDER BY request_id, tag_id
    `,
  },
  {
    id: "invalid_chat_room_type",
    category: "invalid_enum",
    query: `
      SELECT jsonb_build_object('id', id, 'value', type) AS candidate
      FROM public.chat_rooms
      WHERE type NOT IN ('global', 'district')
      ORDER BY id
    `,
  },
  {
    id: "invalid_requests_role",
    category: "invalid_enum",
    query: `
      SELECT jsonb_build_object('id', id, 'value', role) AS candidate
      FROM public.requests
      WHERE role NOT IN ('mentee', 'mentor')
      ORDER BY id
    `,
  },
  {
    id: "invalid_requests_status",
    category: "invalid_enum",
    query: `
      SELECT jsonb_build_object('id', id, 'value', status) AS candidate
      FROM public.requests
      WHERE status NOT IN ('open', 'matched', 'closed')
      ORDER BY id
    `,
  },
  {
    id: "invalid_users_role",
    category: "invalid_enum",
    query: `
      SELECT jsonb_build_object('id', id, 'value', role) AS candidate
      FROM public.users
      WHERE role NOT IN ('mentee', 'mentor', 'both')
      ORDER BY id
    `,
  },
  {
    id: "noncanonical_dm_pair",
    category: "self_or_ordered_relation",
    query: `
      SELECT jsonb_build_object(
        'id', id, 'userAId', user_a_id, 'userBId', user_b_id
      ) AS candidate
      FROM public.dm_conversations
      WHERE user_a_id >= user_b_id
      ORDER BY id
    `,
  },
  {
    id: "self_block",
    category: "self_relation",
    query: `
      SELECT jsonb_build_object(
        'id', id, 'blockerId', blocker_id, 'blockedUserId', blocked_user_id
      ) AS candidate
      FROM public.blocks
      WHERE blocker_id = blocked_user_id
      ORDER BY id
    `,
  },
  {
    id: "self_report",
    category: "self_relation",
    query: `
      SELECT jsonb_build_object(
        'id', id, 'reporterId', reporter_id, 'reportedUserId', reported_user_id
      ) AS candidate
      FROM public.reports
      WHERE reporter_id = reported_user_id
      ORDER BY id
    `,
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
  query: `
    SELECT jsonb_build_object(
      'id', child.id, 'missingId', child.${childColumn}
    ) AS candidate
    FROM public.${childTable} AS child
    LEFT JOIN public.${parentTable} AS parent
      ON parent.id = child.${childColumn}
    WHERE child.${childColumn} IS NOT NULL AND parent.id IS NULL
    ORDER BY child.id
  `,
}));

const ALL_PREFLIGHT_CHECKS = [...PREFLIGHT_CHECKS, ...ORPHAN_RELATIONS].sort(
  (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
);

async function inReadOnlyTransaction(client, run) {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    await client.query("SET LOCAL search_path TO public, pg_catalog");
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

export async function runIntegrityPreflight(client) {
  return inReadOnlyTransaction(client, async () => {
    const checks = [];
    for (const check of ALL_PREFLIGHT_CHECKS) {
      const result = await client.query(check.query);
      checks.push({
        id: check.id,
        category: check.category,
        violationCount: result.rows.length,
        candidates: result.rows.map((row) => row.candidate),
      });
    }
    const candidates = checks.flatMap((check) =>
      check.candidates.map((candidate) => ({ checkId: check.id, candidate })),
    );
    return {
      readOnly: true,
      cleanupPerformed: false,
      violationCount: candidates.length,
      checks,
      quarantine: {
        required: candidates.length > 0,
        candidateCount: candidates.length,
        candidates,
      },
      approvalTaskRequired: candidates.length > 0,
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
