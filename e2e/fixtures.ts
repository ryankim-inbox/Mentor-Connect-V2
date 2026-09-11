// Synthetic test data only. Never import from application runtime.
export type FixtureFailure = { method: string; path: string; status: number; body: unknown };
export const fixturePassword = 'classroom-fixture-pass';
export const signedInUser = {
  id: 1,
  name: "Classroom Mentor",
  email: "mentor@classroom.example.edu",
  role: "mentor",
  districtId: 1,
  districtName: "Classroom North",
  bio: "",
  subjects: ["Math"],
  isVerified: false,
  createdAt: "2026-09-09T00:00:00Z",
};

export const district = {
  id: 1,
  name: "Classroom North",
  county: "Santa Clara",
  type: "high_school",
  memberCount: 12,
  openRequestCount: 1,
};

export const tag = { id: 1, name: "Math", color: "#2563eb", requestCount: 1 };

export const request = {
  id: 11,
  authorId: 2,
  authorName: "Learning Partner",
  authorRole: "mentee",
  districtId: 1,
  districtName: "Classroom North",
  title: "Calculus study session",
  description: "Practice derivatives together.",
  tags: [tag],
  status: "open",
  matchedUserId: null,
  matchedUserName: null,
  createdAt: "2026-09-09T01:00:00Z",
  preferredTimes: ["Mon 17:00"],
};

export const pythonEnvelope = (feature: string, data: unknown) => ({
  ok: true,
  success: true,
  feature,
  source: "student-module",
  student_module: {
    module: feature,
    importable: true,
    called: true,
    status: "connected",
    error: null,
    available_functions: ["run"],
  },
  student_result: null,
  error: null,
  data,
});

export const fixtures: Record<string, unknown> = {
  "/api/auth/me": signedInUser,
  "/api/districts": [district],
  "/api/tags": [tag],
  "/api/requests": [request],
  "/api/requests/11": request,
  "/api/stats/overview": {
    totalUsers: 12,
    totalMentors: 6,
    totalMentees: 6,
    totalDistricts: 1,
    openRequests: 1,
    successfulMatches: 3,
    topTags: [tag],
  },
  "/api/practice/status": {
    success: true,
    status: "connected",
    engines: {},
  },
  "/api/practice/locations/status": {
    success: true,
    status: "connected",
    message: "Location module loaded.",
    available_functions: ["find_nearby"],
  },
  "/api/practice/blocks/status": {
    success: true,
    status: "connected",
    message: "Block module loaded.",
    service_available: true,
    blocked_users_excluded: true,
  },
  "/api/practice/matching/1": {
    success: true,
    status: "connected",
    message: "Matching module loaded.",
    question_id: 1,
    student_id: 1,
    student_name: "Classroom Mentor",
    requested_subject: "Math",
    requested_topic: "Derivatives",
    limit: 5,
    matches: [],
  },
  "/api/analysis/status": pythonEnvelope("analysis", null),
  "/api/analytics/weekly-matches": pythonEnvelope("analysis", [
    { week: "Sep 7", matches: 3 },
  ]),
  "/api/analytics/popular-subjects": pythonEnvelope("analysis", [
    { subject: "Math", requests: 4, color: "#2563eb" },
  ]),
  "/api/analytics/popular-time-slots": pythonEnvelope("scheduling", [
    { slot: "Mon 17:00", count: 2 },
  ]),
  "/api/analytics/mentor-response-rates": pythonEnvelope("analysis", [
    {
      mentorId: 1,
      mentorName: "Classroom Mentor",
      responseRate: 1,
      totalRequests: 2,
      avgResponseHours: 1.5,
    },
  ]),
  "/api/scheduling/status": pythonEnvelope("scheduling", null),
  "/api/scheduling/overview": pythonEnvelope("scheduling", {
    topSlots: [{ slot: "Mon 17:00", count: 2 }],
  }),
  "/api/admin/flagged-users": pythonEnvelope("reports", [
    {
      userId: 7,
      name: "Reported Learner",
      reportCount: 2,
      blockCount: 1,
      status: "review",
      lastReportedAt: "2026-09-09T02:00:00Z",
      topReasons: ["spam"],
    },
  ]),
  "/api/python-reports/summary": pythonEnvelope("reports", {
    today: 1,
    thisMonth: 4,
    thisYear: 20,
    total: 40,
  }),
  "/api/users/7": {
    id: 7,
    name: "Reported Learner",
    subjects: ["Biology"],
    createdAt: "2026-01-15T00:00:00Z",
  },
};


export const fixtureAccounts = {
  mentor: signedInUser,
  mentee: { ...signedInUser, id: 2, name: 'Classroom Mentee', email: 'mentee@classroom.example.edu', role: 'mentee', bio: 'Mentee fixture profile' },
};
export const fixtureRooms = [{ id: 1, type: 'global', districtId: null, name: 'Classroom Global' }];
