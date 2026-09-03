import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  blocksTable,
  chatMessagesTable,
  chatRoomsTable,
  districtsTable,
  dmConversationsTable,
  dmMessagesTable,
  questionsTable,
  reportsTable,
  requestTagsTable,
  requestsTable,
  schedulesTable,
  tagsTable,
  usersTable,
} from "../src/schema/index";

const tables = [
  blocksTable,
  chatMessagesTable,
  chatRoomsTable,
  districtsTable,
  dmConversationsTable,
  dmMessagesTable,
  questionsTable,
  reportsTable,
  requestTagsTable,
  requestsTable,
  schedulesTable,
  tagsTable,
  usersTable,
];

const expectedColumnCounts = new Map([
  ["blocks", 4],
  ["chat_messages", 6],
  ["chat_rooms", 5],
  ["districts", 5],
  ["dm_conversations", 4],
  ["dm_messages", 7],
  ["questions", 10],
  ["reports", 6],
  ["request_tags", 3],
  ["requests", 12],
  ["schedules", 4],
  ["tags", 4],
  ["users", 16],
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
    ],
  );
});

test("Drizzle exposes the canonical checks, foreign keys, unique rules, and indexes", () => {
  const configs = tables.map(getTableConfig);
  assert.equal(
    configs.reduce((sum, config) => sum + config.indexes.length, 0),
    18,
  );
  assert.equal(
    configs.reduce((sum, config) => sum + config.checks.length, 0),
    5,
  );

  const requestTags = getTableConfig(requestTagsTable);
  assert.equal(requestTags.foreignKeys.length, 2);
  assert.equal(requestTags.uniqueConstraints.length, 1);

  const chatRooms = getTableConfig(chatRoomsTable);
  assert.ok(
    chatRooms.indexes.some(
      (index) => index.config.name === "uq_chat_rooms_single_global",
    ),
  );

  const dmConversations = getTableConfig(dmConversationsTable);
  assert.equal(dmConversations.foreignKeys.length, 2);
  assert.equal(dmConversations.uniqueConstraints.length, 1);
});
