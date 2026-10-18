import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyntheticPlan,
  SYNTHETIC_BATCH,
} from "../../../ops/seed-synthetic-classroom.mjs";
import {
  buildDemoRefreshPlan,
  buildDemoContentPreview,
  DEMO_TAXONOMY,
  demoRefreshDigest,
} from "../../../ops/demo-refresh-plan.mjs";
import { topicBanks } from "../../../ops/demo-refresh-content.mjs";
import { scenarioBanks } from "../../../ops/demo-refresh-scenarios.mjs";
import { readFile } from "node:fs/promises";
const counts = {
  users: 983,
  questions: 782,
  requests: 782,
  schedules: 1966,
  request_tags: 782,
  request_applications: 782,
  request_comments: 391,
  request_events: 312,
};
const expectedSubjects = {
  Math: 80,
  Science: 50,
  English: 45,
  History: 30,
  "Computer Science": 80,
  "College Prep": 55,
  "SAT/ACT": 55,
  "AP Courses": 50,
  Spanish: 25,
  Arts: 25,
  Music: 25,
  Sports: 20,
  "Mental Health": 22,
  "Career Guidance": 35,
  Engineering: 30,
  Biology: 30,
  Chemistry: 35,
  Physics: 35,
  Writing: 35,
  Research: 20,
};

export function fixture() {
  const old = buildSyntheticPlan({
    asOf: "2026-10-17T12:00:00.000Z",
    trackingStartedAt: "2026-01-01T00:00:00.000Z",
    districts: [{ id: 1 }, { id: 2 }],
    tags: [
      { id: 1, name: "Math" },
      { id: 2, name: "Science" },
    ],
  });
  const ids = Object.fromEntries(
    Object.entries(old).map(([table, rows], t) => [
      table,
      rows.map((_, i) => (t + 1) * 10000 + i + 1),
    ]),
  );
  const userKeys = new Set([
    "student_id",
    "author_id",
    "user_id",
    "applicant_id",
    "matched_user_id",
    "mentor_id",
  ]);
  const batch = Object.fromEntries(
    Object.entries(old).map(([table, rows]) => [
      table,
      rows.map((row, i) => ({
        id: ids[table][i],
        ...Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value === null
              ? null
              : userKeys.has(key)
                ? ids.users[value]
                : key === "request_id"
                  ? ids.requests[value]
                  : value,
          ]),
        ),
      })),
    ]),
  );
  return {
    receipt: { batchId: SYNTHETIC_BATCH, ids },
    batch,
    districts: DEMO_TAXONOMY.districts.map((d, i) => ({ ...d, id: 300 + i })),
    tags: DEMO_TAXONOMY.tags.map((t, i) => ({ ...t, id: i + 1 })),
  };
}
const tally = (rows, key) =>
  rows.reduce(
    (out, row) => ((out[row[key]] = (out[row[key]] || 0) + 1), out),
    {},
  );
const materialize = (input, plan, table) =>
  input.batch[table].map((row) => ({
    ...row,
    ...plan.updates[table]?.find((p) => p.id === row.id)?.changes,
  }));

test("exports a pure existing-batch refresh generator", () => {
  assert.equal(typeof buildDemoRefreshPlan, "function");
  assert.equal(typeof buildDemoContentPreview, "function");
});

test("public taxonomy has 24 districts, 20 interests, and no local IDs", () => {
  assert.equal(DEMO_TAXONOMY.districts.length, 24);
  assert.equal(DEMO_TAXONOMY.tags.length, 20);
  assert.deepEqual(tally(DEMO_TAXONOMY.districts, "type"), {
    high_school: 5,
    unified: 17,
    elementary: 2,
  });
  assert.equal(
    DEMO_TAXONOMY.districts.filter((d) => d.servesHighSchool).length,
    22,
  );
  for (const d of DEMO_TAXONOMY.districts) {
    assert.equal("id" in d, false);
    assert.match(d.source, /^https:\/\//);
  }
  for (const name of [
    "Sunnyvale School District",
    "Saratoga Union School District",
  ])
    assert.equal(
      DEMO_TAXONOMY.districts.find((d) => d.name === name).type,
      "elementary",
    );
});

test("full preview contains 782 unique substantive asks with exact subject totals", () => {
  const preview = buildDemoContentPreview();
  assert.equal(preview.profiles.length, 983);
  assert.equal(preview.requests.length, 782);
  assert.deepEqual(tally(preview.requests, "subject"), expectedSubjects);
  assert.equal(new Set(preview.requests.map((r) => r.title)).size, 782);
  assert.equal(new Set(preview.requests.map((r) => r.description)).size, 782);
  for (const r of preview.requests) {
    assert.ok(r.description.length >= 180);
    assert.ok(r.title.length >= 20);
    assert.doesNotMatch(
      r.title,
      /\[Synthetic\]|\b(?:question|student|practice)\s+\d|\d{4}|#\d/i,
    );
  }
  assert.equal(new Set(preview.profiles.map((p) => p.name)).size, 983);
  assert.equal(new Set(preview.profiles.map((p) => p.bio)).size, 983);
  for (const p of preview.profiles) {
    assert.ok(p.subjects.length >= 2 && p.subjects.length <= 4);
    assert.doesNotMatch(p.name, /Synthetic|\d/);
  }
  assert.ok(
    preview.profiles.every(
      (p) => p.name.split(" ")[0] !== p.name.split(" ")[1],
    ),
  );
});

test("every learning task starts with its own concrete situation rather than a shared paragraph", () => {
  const requests = buildDemoContentPreview().requests;
  assert.equal(
    new Set(requests.map((r) => r.description.split(/[.!?]/)[0])).size,
    782,
  );
  for (const r of requests)
    assert.doesNotMatch(
      r.description,
      /I'm starting a practice task|I've made an initial attempt|Familiar exercises on|I'm extending my notes/,
    );
});

test("scenario bank aligns with every goal and the checked-in full preview is reproducible", async () => {
  for (const [subject, bank] of Object.entries(topicBanks)) {
    const rows = scenarioBanks[subject].trim().split("\n");
    assert.equal(rows.length, bank.trim().split("\n").length, subject);
    assert.ok(
      rows.every((row) => row.split("|").length === 4),
      subject,
    );
  }
  const artifact = JSON.parse(
    await readFile(
      new URL(
        "../../../database/reference/demo-refresh-preview.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const preview = buildDemoContentPreview();
  assert.deepEqual(artifact, {
    ...preview,
    contentDigest: demoRefreshDigest(preview),
  });
});

test("updates exact receipt IDs deterministically without input mutation or protected fields", () => {
  const input = fixture(),
    before = structuredClone(input),
    plan = buildDemoRefreshPlan(input);
  assert.deepEqual(input, before);
  assert.deepEqual(buildDemoRefreshPlan(input), plan);
  assert.deepEqual(plan.counts, counts);
  assert.equal(plan.updates.schedules, undefined);
  const allowed = {
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
  for (const [table, columns] of Object.entries(allowed)) {
    assert.equal(plan.updates[table].length, counts[table]);
    assert.deepEqual(
      new Set(plan.updates[table].map((p) => p.id)),
      new Set(input.receipt.ids[table]),
    );
    for (const row of plan.updates[table])
      assert.ok(
        Object.keys(row.changes).every((k) => columns.includes(k)),
        table,
      );
  }
  assert.deepEqual(tally(materialize(input, plan, "users"), "role"), {
    mentee: 600,
    mentor: 250,
    both: 133,
  });
  assert.deepEqual(tally(materialize(input, plan, "requests"), "status"), {
    open: 470,
    matched: 234,
    closed: 78,
  });
});

test("keeps authors and schedules, spans all 22 districts, and forms consistent diverse mentor relationships", () => {
  const input = fixture(),
    plan = buildDemoRefreshPlan(input);
  const users = new Map(
    materialize(input, plan, "users").map((u) => [u.id, u]),
  );
  const questions = materialize(input, plan, "questions"),
    requests = materialize(input, plan, "requests");
  const applications = materialize(input, plan, "request_applications"),
    events = materialize(input, plan, "request_events"),
    comments = materialize(input, plan, "request_comments"),
    tags = materialize(input, plan, "request_tags");
  assert.equal(new Set([...users.values()].map((u) => u.district_id)).size, 22);
  assert.equal(
    new Set(applications.map((a) => a.applicant_id)).size >= 150,
    true,
  );
  assert.deepEqual(
    materialize(input, plan, "schedules"),
    input.batch.schedules,
  );
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i],
      q = questions[i],
      author = users.get(r.author_id),
      a = applications.find((a) => a.request_id === r.id),
      mentor = users.get(a.applicant_id);
    assert.equal(q.student_id, r.author_id);
    assert.equal(q.message, r.description);
    assert.equal(r.district_id, author.district_id);
    assert.ok(author.subjects.includes(q.subject));
    assert.ok(mentor.subjects.includes(q.subject));
    assert.ok(["mentor", "both"].includes(mentor.role));
    assert.equal(mentor.district_id, r.district_id);
    assert.equal(r.matched_user_id, r.status === "open" ? null : mentor.id);
    assert.equal(
      input.tags.find(
        (t) => t.id === tags.find((t) => t.request_id === r.id).tag_id,
      ).name,
      q.subject,
    );
    for (const e of events.filter((e) => e.request_id === r.id))
      assert.equal(e.mentor_id, mentor.id);
    for (const c of comments.filter((c) => c.request_id === r.id))
      assert.equal(c.author_id, mentor.id);
    const district = input.districts.find((d) => d.id === r.district_id);
    assert.notEqual(district.type, "elementary");
  }
});

test("rejects extra rows, wrong receipts, credential drift, invalid states and graph conflicts", () => {
  for (const mutate of [
    (i) => i.batch.users.push({ ...i.batch.users[0], id: 999 }),
    (i) => i.receipt.ids.questions.pop(),
    (i) => (i.batch.users[0].password_hash = "changed"),
    (i) => (i.batch.users[0].email = "someone@example.com"),
    (i) => (i.batch.users[0].is_admin = true),
    (i) => (i.batch.users[0].is_verified = true),
    (i) => (i.batch.users[0].email_verified_at = "2026-10-18T00:00:00.000Z"),
    (i) => (i.batch.users[0].role = "mentor"),
    (i) => (i.batch.requests[0].status = "closed"),
    (i) => (i.batch.questions[0].student_id = i.batch.users[1].id),
    (i) => (i.batch.request_applications[0].applicant_id = 42),
    (i) => (i.batch.request_comments[0].author_id = 42),
    (i) => (i.batch.request_events[0].mentor_id = 42),
    (i) => (i.batch.requests[0].request = "different-key"),
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => buildDemoRefreshPlan(input));
  }
});

test("resolves names rather than local numeric IDs and rejects ambiguous or misclassified metadata", () => {
  const input = fixture(),
    p = buildDemoRefreshPlan(input);
  assert.ok(p.updates.users.every((u) => u.changes.district_id >= 300));
  for (const mutate of [
    (i) => i.districts.pop(),
    (i) => i.districts.push({ ...i.districts[0], id: 900 }),
    (i) => (i.districts[0].type = "unified"),
    (i) => i.tags.pop(),
    (i) => i.tags.push({ ...i.tags[0], id: 90 }),
  ]) {
    const bad = fixture();
    mutate(bad);
    assert.throws(() => buildDemoRefreshPlan(bad));
  }
});

test("normalizes reference names while retaining resolved destination IDs", () => {
  const input = fixture();
  input.tags.forEach((t) => (t.name = ` ${t.name.toUpperCase()} `));
  input.districts.forEach((d) => {
    d.name = ` ${d.name.toUpperCase()} `;
    d.county = ` ${d.county.toUpperCase()} `;
  });
  const plan = buildDemoRefreshPlan(input);
  assert.ok(plan.updates.users.every((p) => p.changes.district_id >= 300));
  assert.ok(
    plan.updates.request_tags.every((p) =>
      Number.isSafeInteger(p.changes.tag_id),
    ),
  );
});

test("row ordering does not change the plan and malformed receipt IDs abort", () => {
  const input = fixture(),
    expected = buildDemoRefreshPlan(input);
  Object.values(input.batch).forEach((rows) => rows.reverse());
  input.tags.reverse();
  input.districts.reverse();
  assert.deepEqual(buildDemoRefreshPlan(input), expected);
  input.receipt.ids.request_events[0] = -1;
  input.batch.request_events.find((r) => r.id === 80001).id = -1;
  assert.throws(() => buildDemoRefreshPlan(input), /invalid.*ID/);
});

test("aborts inconsistent application and match-event chronology", () => {
  for (const mutate of [
    (i) => (i.batch.request_events[0].occurred_at = "2026-01-01T00:00:00.000Z"),
    (i) =>
      (i.batch.request_applications[0].updated_at = "2026-01-01T00:00:00.000Z"),
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => buildDemoRefreshPlan(input), /chronology/);
  }
});
