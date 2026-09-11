import type {
  User,
  District,
  Tag,
  MentorshipRequest,
  BlockedUser,
  StatsOverview,
  DistrictStats,
  ChatMessage,
  DmMessage,
} from "../../../lib/api-client-react/src/generated/api.schemas.js";

// Documented wire payloads shared by the response-boundary and HTTP forwarding tests.
export const userFixture = {
  id: 1,
  email: "student@example.edu",
  name: "Student One",
  role: "mentee",
  districtId: 1,
  districtName: "School",
  bio: null,
  subjects: ["Math"],
  isVerified: true,
  createdAt: "2026-01-01T00:00:00",
} satisfies User;
export const districtFixture = {
  id: 1,
  name: "School",
  county: "County",
  type: "unified",
  memberCount: 1,
  openRequestCount: 1,
} satisfies District;
export const tagFixture = {
  id: 1,
  name: "Math",
  color: "#123456",
  requestCount: 1,
} satisfies Tag;
export const requestFixture = {
  id: 1,
  authorId: 1,
  authorName: "Student One",
  authorRole: "mentee",
  districtId: 1,
  districtName: "School",
  title: "Math help",
  description: "Fractions",
  tags: [tagFixture],
  status: "open",
  matchedUserId: null,
  matchedUserName: null,
  createdAt: "2026-01-01T00:00:00",
  preferredTimes: [],
} satisfies MentorshipRequest;
export const blockFixture = {
  id: 1,
  blockedUserId: 2,
  blockedUserName: "Other",
  createdAt: "2026-01-01T00:00:00",
} satisfies BlockedUser;
export const overviewFixture = {
  totalUsers: 1,
  totalMentors: 0,
  totalMentees: 1,
  totalDistricts: 1,
  openRequests: 1,
  successfulMatches: 0,
  topTags: [tagFixture],
} satisfies StatsOverview;
export const districtStatsFixture = {
  districtId: 1,
  districtName: "School",
  memberCount: 1,
  mentorCount: 0,
  menteeCount: 1,
  openRequests: 1,
  matchedRequests: 0,
  topTags: [tagFixture],
} satisfies DistrictStats;
export const chatMessageFixture = {
  id: 1,
  roomId: 1,
  senderId: 1,
  senderName: "Student One",
  body: "hello",
  createdAt: "2026-01-01T00:00:00",
} satisfies ChatMessage;
export const dmMessageFixture = {
  id: 1,
  conversationId: 1,
  senderId: 1,
  body: "hello",
  createdAt: "2026-01-01T00:00:00",
  readAt: null,
} satisfies DmMessage;
