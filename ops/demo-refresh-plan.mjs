import { createHash } from "node:crypto";
import taxonomy from "../database/reference/demo-taxonomy.json" with { type: "json" };
import { topicBanks } from "./demo-refresh-content.mjs";
import { scenarioBanks } from "./demo-refresh-scenarios.mjs";

export const DEMO_BATCH = "mc-synthetic-v1-983-782";
export const REVISION_ID = "mc-demo-taxonomy-v1-20261018";
export const DEMO_REFRESH_REVISION = REVISION_ID;
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const DEMO_TAXONOMY = freeze(taxonomy);
export const APPROVED_DISTRICTS = DEMO_TAXONOMY.districts;
export const APPROVED_TAGS = DEMO_TAXONOMY.tags;
export const DEMO_REFRESH_COUNTS = freeze({
  users: 983,
  questions: 782,
  requests: 782,
  schedules: 1966,
  request_tags: 782,
  request_applications: 782,
  request_comments: 391,
  request_events: 312,
});
export const DEMO_REFRESH_COLUMNS = freeze({
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
});
const slots = [
  "Mon 16:00",
  "Tue 17:00",
  "Wed 18:00",
  "Thu 16:00",
  "Fri 17:00",
  "Sat 10:00",
  "Sun 14:00",
];
const firstNames =
  "Avery Jordan Morgan Riley Casey Quinn Taylor Parker Rowan Skyler Jamie Cameron Reese Sage Devon Finley Emerson Drew Harper Alex Bailey Logan Maren Ellis Remy Hayden Robin Kendall Blake Sidney Arden Blair Jules Sam Micah Noel Charlie Dakota Evan Lane".split(
    " ",
  );
const lastNames =
  "Bennett Brooks Carter Collins Cooper Ellis Foster Gray Hayes Jordan Lane Morgan Parker Reed Rivera Rowan Sawyer Taylor Walker Wells West Quinn Avery Bell Cruz Davis Green Hall Lee Moore Ross Stone Young Adams Baker Clark Diaz Evans Ford Grant"
    .split(" ")
    .filter((name) => !firstNames.includes(name));
const styles = ["Step by step", "Examples", "Practice", "Visual explanations"];
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
const serialize = (value) => JSON.stringify(canonical(value));
export const demoRefreshDigest = (value) =>
  createHash("sha256").update(serialize(value)).digest("hex");
const key = (id) => String(id);
const normal = (value) =>
  String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const expect = (condition, message) => {
  if (!condition) throw new Error(`demo refresh: ${message}`);
};
const same = (a, b) => serialize(a) === serialize(b);
const roleAt = (i) => (i < 600 ? "mentee" : i < 850 ? "mentor" : "both");
const statusAt = (i) =>
  i % 10 < 6 ? "open" : i % 10 < 9 ? "matched" : "closed";
const defaultTimes = (i) => [slots[i % 7], slots[(i + 2) % 7]];
const tally = (rows, select) =>
  rows.reduce(
    (out, row) => ((out[select(row)] = (out[select(row)] ?? 0) + 1), out),
    {},
  );

function subjectSequence() {
  const totals = DEMO_TAXONOMY.primarySubjectDistribution,
    names = Object.keys(totals),
    used = Object.fromEntries(names.map((n) => [n, 0]));
  return Array.from({ length: 782 }, (_, i) => {
    const name = names
      .filter((n) => used[n] < totals[n])
      .sort(
        (a, b) =>
          (totals[b] * (i + 1)) / 782 -
            used[b] -
            ((totals[a] * (i + 1)) / 782 - used[a]) ||
          names.indexOf(a) - names.indexOf(b),
      )[0];
    return { name, localIndex: used[name]++ };
  });
}

function learningText(subject, localIndex, times) {
  const bank = topicBanks[subject]
    ?.trim()
    .split("\n")
    .map((line) => line.trim().split("|"));
  const entry = bank?.[Math.floor(localIndex / 4)],
    mode = localIndex % 4;
  expect(entry?.length === 5, `missing original learning task for ${subject}`);
  const [topic, ...actions] = entry,
    action = actions[mode];
  const title = action[0].toUpperCase() + action.slice(1);
  const availability = `My available times are ${times.join(" or ")}.`;
  const situation = scenarioBanks[subject]
    ?.trim()
    .split("\n")
    [Math.floor(localIndex / 4)]?.split("|")[mode];
  expect(situation, `missing original learner situation for ${subject}`);
  const asks = [
    `Could a peer help me ${action}?`,
    `I'd appreciate another pair of eyes to help me ${action}.`,
    `Would someone like to ${action} with me?`,
    `I would like to ${action} and get feedback from a peer.`,
  ];
  return {
    subject,
    topic,
    title,
    description: `${situation} ${asks[mode]} ${availability}`,
    learningGoal: action,
    approach: [
      "guided attempt",
      "diagnosis and revision",
      "application",
      "explanation",
    ][mode],
  };
}

/** Pure fictional content preview. Ordinals are review keys, never database IDs. */
export function buildDemoContentPreview({ availableTimes } = {}) {
  const districts = APPROVED_DISTRICTS.filter((d) => d.servesHighSchool),
    subjects = APPROVED_TAGS.map((t) => t.name);
  const profiles = Array.from({ length: 983 }, (_, i) => ({
    ordinal: i + 1,
    name: `${firstNames[i % firstNames.length]} ${lastNames[Math.floor(i / firstNames.length)]}`,
    role: roleAt(i),
    district: districts[i % districts.length].name,
    county: districts[i % districts.length].county,
    grade_level: String(9 + (i % 4)),
    teaching_style: styles[i % styles.length],
    subjects: [],
    available_times: [...(availableTimes?.[i] ?? defaultTimes(i))],
  }));
  for (const district of districts) {
    profiles
      .filter((p) => p.district === district.name && p.role !== "mentee")
      .forEach((p, j) => {
        p.subjects = [subjects[(j * 2) % 20], subjects[(j * 2 + 1) % 20]];
      });
  }
  const requests = subjectSequence().map(({ name, localIndex }, i) => {
    const author = profiles[i % 600];
    if (!author.subjects.includes(name)) author.subjects.push(name);
    return {
      ordinal: i + 1,
      authorOrdinal: author.ordinal,
      district: author.district,
      county: author.county,
      status: statusAt(i),
      ...learningText(name, localIndex, author.available_times),
    };
  });
  const usage = new Map();
  for (const request of requests) {
    const author = profiles[request.authorOrdinal - 1];
    const available = profiles.filter(
      (p) =>
        p.role !== "mentee" &&
        p.district === author.district &&
        p.available_times.some((t) => author.available_times.includes(t)),
    );
    const existing = available.filter((p) =>
      p.subjects.includes(request.subject),
    );
    const candidates = existing.length
      ? existing
      : available.filter((p) => p.subjects.length < 4);
    expect(
      candidates.length > 0,
      "could not form a district, subject and availability peer pair",
    );
    candidates.sort(
      (a, b) =>
        (usage.get(a.ordinal) ?? 0) - (usage.get(b.ordinal) ?? 0) ||
        a.subjects.length - b.subjects.length ||
        a.ordinal - b.ordinal,
    );
    const mentor = candidates[0];
    if (!mentor.subjects.includes(request.subject))
      mentor.subjects.push(request.subject);
    usage.set(mentor.ordinal, (usage.get(mentor.ordinal) ?? 0) + 1);
    request.mentorOrdinal = mentor.ordinal;
    request.sharedTimes = author.available_times.filter((t) =>
      mentor.available_times.includes(t),
    );
  }
  const profileGoalUse = new Map();
  for (const [i, p] of profiles.entries()) {
    const target =
      p.role === "mentee" ? 2 + (i % 3) : Math.max(2, p.subjects.length);
    for (let j = 0; p.subjects.length < target; j++) {
      const s = subjects[(i * 7 + j) % 20];
      if (!p.subjects.includes(s)) p.subjects.push(s);
    }
    const interest =
      p.subjects.slice(0, -1).join(", ") + ` and ${p.subjects.at(-1)}`;
    const primary = p.subjects[0],
      secondary = p.subjects[1],
      goalIndex = profileGoalUse.get(primary) ?? 0;
    profileGoalUse.set(primary, goalIndex + 1);
    const goals = topicBanks[primary]
      .trim()
      .split("\n")
      .flatMap((line) => line.split("|").slice(1));
    const otherGoals = topicBanks[secondary]
      .trim()
      .split("\n")
      .flatMap((line) => line.split("|").slice(1));
    const goal = goals[goalIndex % goals.length],
      otherGoal =
        otherGoals[
          (Math.floor(goalIndex / goals.length) + i) % otherGoals.length
        ];
    const goalText =
      p.role === "mentee"
        ? `Right now, I'd like to ${goal}. I am also curious about how to ${otherGoal}.`
        : p.role === "mentor"
          ? `I enjoy helping peers ${goal}. I also like to ${otherGoal} when exploring a new idea.`
          : `I'm working on how to ${goal}, and I enjoy helping peers ${otherGoal}.`;
    p.bio = `I'm exploring ${interest}. ${goalText}`;
    p.location = `${p.county} County`;
  }
  return {
    version: 1,
    batchId: DEMO_BATCH,
    revisionId: REVISION_ID,
    demoDisclosure: DEMO_TAXONOMY.demoDisclosure,
    identityNote:
      "All names and learning tasks are fictional. District labels are demo assignments, not enrollment claims. Ordinals are not database identifiers.",
    profiles,
    requests,
    summary: {
      roles: tally(profiles, (p) => p.role),
      statuses: tally(requests, (r) => r.status),
      subjects: tally(requests, (r) => r.subject),
      districts: districts.map((d) => ({
        name: d.name,
        members: profiles.filter((p) => p.district === d.name).length,
        requests: requests.filter((r) => r.district === d.name).length,
        mentorsUsed: new Set(
          requests
            .filter((r) => r.district === d.name)
            .map((r) => r.mentorOrdinal),
        ).size,
        subjects: new Set(
          requests.filter((r) => r.district === d.name).map((r) => r.subject),
        ).size,
      })),
      distinctMentors: usage.size,
      maxRequestsPerMentor: Math.max(...usage.values()),
      distinctTopics: new Set(requests.map((r) => `${r.subject}:${r.topic}`))
        .size,
    },
  };
}

function resolveMetadata(districts, tags) {
  expect(
    Array.isArray(districts) && Array.isArray(tags),
    "resolved metadata required",
  );
  const resolve = (approved, rows, kind) =>
    approved.map((item) => {
      const matches = rows.filter(
        (row) =>
          normal(row.name) === normal(item.name) &&
          (kind !== "district" || normal(row.county) === normal(item.county)),
      );
      expect(
        matches.length === 1,
        `${kind} metadata missing or ambiguous: ${item.name}`,
      );
      const row = matches[0];
      expect(
        Number.isSafeInteger(row.id) && row.id > 0,
        `invalid resolved ${kind} ID`,
      );
      if (kind === "district")
        expect(
          row.type === item.type,
          `district classification differs: ${item.name}`,
        );
      return row;
    });
  const resolvedDistricts = resolve(APPROVED_DISTRICTS, districts, "district"),
    resolvedTags = resolve(APPROVED_TAGS, tags, "tag");
  expect(
    new Set(resolvedDistricts.map((r) => r.id)).size === 24 &&
      new Set(resolvedTags.map((r) => r.id)).size === 20,
    "resolved metadata IDs are not unique",
  );
  return { districts: resolvedDistricts, tags: resolvedTags };
}

function validateInput(receipt, batch) {
  expect(receipt?.batchId === DEMO_BATCH, "wrong batch receipt");
  const ordered = {};
  for (const [table, count] of Object.entries(DEMO_REFRESH_COUNTS)) {
    const ids = receipt.ids?.[table],
      rows = batch?.[table];
    expect(
      Array.isArray(ids) &&
        ids.length === count &&
        new Set(ids.map(key)).size === count,
      `wrong receipt IDs for ${table}`,
    );
    expect(
      ids.every(
        (id) =>
          (Number.isSafeInteger(id) && id > 0) ||
          (table === "request_events" &&
            typeof id === "string" &&
            /^[1-9]\d*$/.test(id)),
      ),
      `invalid receipt ID in ${table}`,
    );
    expect(
      Array.isArray(rows) && rows.length === count,
      `unexpected rows touching batch in ${table}`,
    );
    const byId = new Map(rows.map((r) => [key(r.id), r]));
    expect(
      byId.size === count && ids.every((id) => byId.has(key(id))),
      `receipt rows differ for ${table}`,
    );
    ordered[table] = ids.map((id) => byId.get(key(id)));
  }
  ordered.users.forEach((u, i) => {
    expect(
      u.email ===
        `student-${String(i + 1).padStart(4, "0")}@${DEMO_BATCH}.invalid` &&
        u.password_hash === `!mentor-connect-synthetic:v1:${DEMO_BATCH}`,
      "immutable locked batch identity differs",
    );
    expect(
      u.role === roleAt(i) &&
        u.is_verified === false &&
        u.email_verified_at === null &&
        u.is_admin === false,
      "protected account fields differ",
    );
    const schedules = ordered.schedules.filter((s) => s.user_id === u.id);
    expect(
      Array.isArray(u.available_times) &&
        u.available_times.length === 2 &&
        new Set(u.available_times).size === 2 &&
        schedules.length === 2 &&
        same(
          [...u.available_times].sort(),
          schedules.map((s) => s.slot).sort(),
        ),
      "schedule and availability conflict",
    );
  });
  const users = new Map(ordered.users.map((u) => [key(u.id), u]));
  ordered.requests.forEach((r, i) => {
    const q = ordered.questions[i],
      author = ordered.users[i % 600];
    expect(
      r.request === `${DEMO_BATCH}:question:${String(i + 1).padStart(4, "0")}`,
      "immutable request key differs",
    );
    expect(
      r.author_id === author.id &&
        q.student_id === author.id &&
        r.role === "mentee" &&
        r.status === statusAt(i),
      "author, question or status differs",
    );
    expect(
      r.district_id === author.district_id &&
        q.message === r.description &&
        same(q.created_at, r.created_at),
      "question/post pair differs",
    );
    expect(
      same(r.preferred_times, author.available_times) &&
        same(q.preferred_times, author.available_times) &&
        q.preferred_time === author.available_times[0],
      "question/post availability differs",
    );
    const applications = ordered.request_applications.filter(
        (a) => a.request_id === r.id,
      ),
      tagRows = ordered.request_tags.filter((t) => t.request_id === r.id),
      events = ordered.request_events.filter((e) => e.request_id === r.id),
      comments = ordered.request_comments.filter((c) => c.request_id === r.id);
    expect(
      applications.length === 1 &&
        tagRows.length === 1 &&
        events.length === (r.status === "open" ? 0 : 1) &&
        comments.length === (i % 2 === 0 ? 1 : 0),
      "related graph shape differs",
    );
    const application = applications[0],
      mentor = users.get(key(application.applicant_id));
    expect(
      mentor &&
        ["mentor", "both"].includes(mentor.role) &&
        mentor.district_id === author.district_id &&
        mentor.subjects.includes(q.subject),
      "existing application is not an eligible batch mentor",
    );
    expect(
      application.status === (r.status === "open" ? "pending" : "accepted") &&
        r.matched_user_id === (r.status === "open" ? null : mentor.id),
      "application/match state differs",
    );
    expect(
      events.every(
        (e) =>
          e.kind === "matched" &&
          e.mentor_id === mentor.id &&
          same(e.request_created_at, r.created_at),
      ),
      "event graph differs",
    );
    expect(
      same(application.created_at, r.created_at) &&
        same(application.updated_at, r.updated_at) &&
        events.every(
          (e) =>
            same(e.occurred_at, r.updated_at) &&
            Date.parse(e.occurred_at) >= Date.parse(r.created_at),
        ),
      "application/event chronology differs",
    );
    expect(
      comments.every(
        (c) =>
          c.author_id === mentor.id &&
          c.parent_id === null &&
          c.deleted_at === null,
      ),
      "comment graph differs",
    );
  });
  return ordered;
}

/**
 * Pure update-only contract. Full current batch rows + immutable seed receipt IDs
 * enter; allowlisted {id, changes} patches leave. No connection, SQL, environment,
 * credential lookup, clock, filesystem writes, or user/post insertion occurs.
 * Caller must independently reject other inbound cross-batch references, verify
 * original seed digests and lock/snapshot the exact rows before applying patches.
 */
export function buildDemoRefreshPlan({ receipt, batch, districts, tags }) {
  const ordered = validateInput(receipt, batch),
    metadata = resolveMetadata(districts, tags);
  const preview = buildDemoContentPreview({
    availableTimes: ordered.users.map((u) => u.available_times),
  });
  const districtByName = new Map(
      metadata.districts.map((d, i) => [APPROVED_DISTRICTS[i].name, d]),
    ),
    tagByName = new Map(
      metadata.tags.map((t, i) => [APPROVED_TAGS[i].name, t]),
    );
  const updates = Object.fromEntries(
    Object.keys(DEMO_REFRESH_COLUMNS).map((table) => [table, []]),
  );
  ordered.users.forEach((u, i) => {
    const p = preview.profiles[i];
    updates.users.push({
      id: u.id,
      changes: {
        name: p.name,
        bio: p.bio,
        subjects: p.subjects,
        district_id: districtByName.get(p.district).id,
        location: p.location,
        grade_level: p.grade_level,
        teaching_style: p.teaching_style,
      },
    });
  });
  ordered.requests.forEach((r, i) => {
    const content = preview.requests[i],
      q = ordered.questions[i],
      author = preview.profiles[content.authorOrdinal - 1],
      mentor = ordered.users[content.mentorOrdinal - 1];
    updates.questions.push({
      id: q.id,
      changes: {
        subject: content.subject,
        topic: content.topic,
        message: content.description,
        preferred_teaching_style: author.teaching_style,
      },
    });
    updates.requests.push({
      id: r.id,
      changes: {
        district_id: districtByName.get(content.district).id,
        title: content.title,
        description: content.description,
        matched_user_id: r.status === "open" ? null : mentor.id,
      },
    });
    const tag = ordered.request_tags.find((t) => t.request_id === r.id),
      application = ordered.request_applications.find(
        (a) => a.request_id === r.id,
      );
    updates.request_tags.push({
      id: tag.id,
      changes: { tag_id: tagByName.get(content.subject).id },
    });
    updates.request_applications.push({
      id: application.id,
      changes: { applicant_id: mentor.id },
    });
    for (const c of ordered.request_comments.filter(
      (c) => c.request_id === r.id,
    ))
      updates.request_comments.push({
        id: c.id,
        changes: {
          author_id: mentor.id,
          body: `Let's ${content.learningGoal}. Bring your current attempt, and we can identify one useful next step together. ${content.sharedTimes[0]} works for a short session.`,
        },
      });
    for (const e of ordered.request_events.filter((e) => e.request_id === r.id))
      updates.request_events.push({
        id: e.id,
        changes: { mentor_id: mentor.id },
      });
  });
  const base = {
    version: 1,
    batchId: DEMO_BATCH,
    revisionId: REVISION_ID,
    inputDigest: demoRefreshDigest({
      receipt,
      batch: ordered,
      districts: metadata.districts,
      tags: metadata.tags,
    }),
    counts: { ...DEMO_REFRESH_COUNTS },
    updates,
    summary: preview.summary,
    preview,
  };
  return { ...base, planDigest: demoRefreshDigest(base) };
}
