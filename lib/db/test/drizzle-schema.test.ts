import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import {
  emailVerificationTokensTable,
  emailVerificationRequestsTable,
  notificationsTable,
  blocksTable,
  chatMessagesTable,
  chatRoomsTable,
  districtsTable,
  dmConversationsTable,
  dmMessagesTable,
  questionsTable,
  reportsTable,
  requestTagsTable,
  requestSubmissionKeysTable,
  requestsTable,
  requestEventsTable,
  requestApplicationsTable,
  requestCommentsTable,
  schedulesTable,
  tagsTable,
  usersTable,
} from "../src/schema/index";

const tables = [
  notificationsTable,
  emailVerificationTokensTable,
  emailVerificationRequestsTable,
  blocksTable,
  chatMessagesTable,
  chatRoomsTable,
  districtsTable,
  dmConversationsTable,
  dmMessagesTable,
  questionsTable,
  reportsTable,
  requestTagsTable,
  requestSubmissionKeysTable,
  requestsTable,
  requestEventsTable,
  requestApplicationsTable,
  requestCommentsTable,
  schedulesTable,
  tagsTable,
  usersTable,
];
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const frozenCatalog = JSON.parse(
  readFileSync(
    path.join(rootDir, "database/schema/local-catalog.json"),
    "utf8",
  ),
) as {
  constraints: Array<{
    table: string;
    name: string;
    type: "p" | "u" | "f" | "c";
    definition: string;
  }>;
  indexes: Array<{ table: string; name: string }>;
};
const dialect = new PgDialect();

const expectedColumnCounts = new Map([
  ["notifications", 7],
  ["blocks", 4],
  ["chat_messages", 7],
  ["chat_rooms", 5],
  ["districts", 5],
  ["dm_conversations", 4],
  ["dm_messages", 8],
  ["questions", 10],
  ["reports", 13],
  ["request_tags", 3],
  ["requests", 14],
  ["request_submission_keys", 5],
  ["request_events", 6],
  ["request_applications", 6],
  ["request_comments", 9],
  ["schedules", 4],
  ["tags", 4],
  ["users", 18],
  ["email_verification_tokens",5],
  ["email_verification_requests",4],
]);

test("Drizzle represents every canonical table and column", () => {
  assert.deepEqual(
    tables.map(getTableName).sort(),
    [...expectedColumnCounts.keys()].sort(),
  );
  for (const table of tables) {
    assert.equal(
      getTableConfig(table).columns.length,
      expectedColumnCounts.get(getTableName(table)),
      `${getTableName(table)} column count`,
    );
  }
  assert.deepEqual(
    getTableConfig(usersTable).columns.map((column) => column.name),
    [
      "id",
      "email",
      "name",
      "password_hash",
      "role",
      "district_id",
      "bio",
      "subjects",
      "is_verified",
      "created_at",
      "updated_at",
      "location",
      "available_times",
      "languages",
      "grade_level",
      "teaching_style",
      "email_verified_at",
      "is_admin",
    ],
  );
  assert.deepEqual(
    getTableConfig(requestsTable).columns.map((column) => column.name),
    [
      "id",
      "author_id",
      "district_id",
      "title",
      "description",
      "role",
      "status",
      "matched_user_id",
      "created_at",
      "updated_at",
      "request",
      "preferred_times",
      "client_request_id",
      "payload_hash",
    ],
  );
});

function normalizedCheck(definition: string) {
  const anyArray = /^CHECK \((\w+) = ANY \(ARRAY\[(.*)\]\)\)$/.exec(definition);
  if (anyArray) {
    return `CHECK (${anyArray[1]} IN (${anyArray[2].replaceAll("::text", "")}))`;
  }
  return definition;
}

function canonicalConstraintSignatures(tableName: string) {
  return frozenCatalog.constraints
    .filter((constraint) => constraint.table === tableName)
    .map(
      (constraint) =>
        `${constraint.type}:${
          constraint.type === "c"
            ? normalizedCheck(constraint.definition)
            : constraint.definition
        }`,
    )
    .sort();
}

function drizzleConstraintSignatures(table: (typeof tables)[number]) {
  const config = getTableConfig(table);
  const signatures: string[] = [];
  for (const column of config.columns) {
    if (column.primary) signatures.push(`p:PRIMARY KEY (${column.name})`);
    if (column.isUnique) signatures.push(`u:UNIQUE (${column.name})`);
  }
  for (const primaryKey of config.primaryKeys) {
    signatures.push(
      `p:PRIMARY KEY (${primaryKey.columns.map((column) => column.name).join(", ")})`,
    );
  }
  for (const uniqueConstraint of config.uniqueConstraints) {
    signatures.push(
      `u:UNIQUE (${uniqueConstraint.columns.map((column) => column.name).join(", ")})`,
    );
  }
  for (const foreignKey of config.foreignKeys) {
    const reference = foreignKey.reference();
    const onUpdate =
      foreignKey.onUpdate === "no action"
        ? ""
        : ` ON UPDATE ${foreignKey.onUpdate.toUpperCase()}`;
    const onDelete =
      foreignKey.onDelete === "no action"
        ? ""
        : ` ON DELETE ${foreignKey.onDelete.toUpperCase()}`;
    signatures.push(
      `f:FOREIGN KEY (${reference.columns.map((column) => column.name).join(", ")}) REFERENCES ${getTableName(reference.foreignTable)}(${reference.foreignColumns.map((column) => column.name).join(", ")})${onUpdate}${onDelete}`,
    );
  }
  for (const check of config.checks) {
    const expression = dialect
      .sqlToQuery(check.value)
      .sql.replace(/"[^"]+"\./g, "")
      .replace(/"([^"]+)"/g, "$1");
    signatures.push(`c:CHECK (${expression})`);
  }
  return signatures.sort();
}

test("Drizzle constraints and indexes match every frozen catalog table", () => {
  const constraintBackedIndexes = new Set(
    frozenCatalog.constraints
      .filter(
        (constraint) => constraint.type === "p" || constraint.type === "u",
      )
      .map((constraint) => constraint.name),
  );
  for (const table of tables) {
    const tableName = getTableName(table);
    assert.deepEqual(
      drizzleConstraintSignatures(table),
      canonicalConstraintSignatures(tableName),
      `${tableName} constraint signatures`,
    );
    assert.deepEqual(
      getTableConfig(table)
        .indexes.map((index) => index.config.name)
        .sort(),
      frozenCatalog.indexes
        .filter(
          (index) =>
            index.table === tableName &&
            !constraintBackedIndexes.has(index.name),
        )
        .map((index) => index.name)
        .sort(),
      `${tableName} non-constraint indexes`,
    );
  }
});

test("Drizzle exposes the new integrity checks and matching indexes", () => {
  assert.deepEqual(
    getTableConfig(blocksTable)
      .checks.map((check) => check.name)
      .sort(),
    ["blocks_no_self_check"],
  );
  assert.deepEqual(
    getTableConfig(reportsTable)
      .checks.map((check) => check.name)
      .sort(),
    ["reports_no_self_check", "reports_note_check", "reports_request_title_check", "reports_status_check", "reports_target_context_check", "reports_target_type_check"],
  );
  assert.deepEqual(
    getTableConfig(dmConversationsTable)
      .checks.map((check) => check.name)
      .sort(),
    ["dm_conversations_canonical_pair_check", "dm_conversations_check"],
  );
  assert.ok(
    getTableConfig(usersTable).indexes.some(
      (index) => index.config.name === "idx_users_matching_lookup",
    ),
  );
  assert.ok(
    getTableConfig(requestsTable).indexes.some(
      (index) => index.config.name === "idx_requests_open_matching_lookup",
    ),
  );
});
