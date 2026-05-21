import { Router, type IRouter } from "express";
import { eq, count, and } from "drizzle-orm";
import { db, usersTable, districtsTable, requestsTable, tagsTable, requestTagsTable } from "@workspace/db";
import { GetDistrictStatsParams } from "@workspace/api-zod";

const router: IRouter = Router();

async function getTopTags(limit = 5) {
  const tags = await db.select().from(tagsTable).orderBy(tagsTable.name);
  const tagsWithCounts = await Promise.all(tags.map(async (tag) => {
    const [result] = await db.select({ count: count() }).from(requestTagsTable).where(eq(requestTagsTable.tagId, tag.id));
    return { id: tag.id, name: tag.name, color: tag.color, requestCount: Number(result?.count ?? 0) };
  }));
  return tagsWithCounts.sort((a, b) => b.requestCount - a.requestCount).slice(0, limit);
}

router.get("/stats/overview", async (_req, res): Promise<void> => {
  const [totalUsersResult] = await db.select({ count: count() }).from(usersTable);
  const [totalMentorsResult] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "mentor"));
  const [totalMenteesResult] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "mentee"));
  const [totalDistrictsResult] = await db.select({ count: count() }).from(districtsTable);
  const [openRequestsResult] = await db.select({ count: count() }).from(requestsTable).where(eq(requestsTable.status, "open"));
  const [matchedRequestsResult] = await db.select({ count: count() }).from(requestsTable).where(eq(requestsTable.status, "matched"));

  const topTags = await getTopTags(5);

  res.json({
    totalUsers: Number(totalUsersResult?.count ?? 0),
    totalMentors: Number(totalMentorsResult?.count ?? 0),
    totalMentees: Number(totalMenteesResult?.count ?? 0),
    totalDistricts: Number(totalDistrictsResult?.count ?? 0),
    openRequests: Number(openRequestsResult?.count ?? 0),
    successfulMatches: Number(matchedRequestsResult?.count ?? 0),
    topTags,
  });
});

router.get("/stats/district/:id", async (req, res): Promise<void> => {
  const params = GetDistrictStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, params.data.id));
  if (!district) {
    res.status(404).json({ error: "District not found" });
    return;
  }

  const [memberCountResult] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.districtId, params.data.id));
  const [mentorCountResult] = await db.select({ count: count() }).from(usersTable).where(
    and(eq(usersTable.districtId, params.data.id), eq(usersTable.role, "mentor"))
  );
  const [menteeCountResult] = await db.select({ count: count() }).from(usersTable).where(
    and(eq(usersTable.districtId, params.data.id), eq(usersTable.role, "mentee"))
  );
  const [openRequestsResult] = await db.select({ count: count() }).from(requestsTable).where(
    and(eq(requestsTable.districtId, params.data.id), eq(requestsTable.status, "open"))
  );
  const [matchedRequestsResult] = await db.select({ count: count() }).from(requestsTable).where(
    and(eq(requestsTable.districtId, params.data.id), eq(requestsTable.status, "matched"))
  );

  const topTags = await getTopTags(5);

  res.json({
    districtId: district.id,
    districtName: district.name,
    memberCount: Number(memberCountResult?.count ?? 0),
    mentorCount: Number(mentorCountResult?.count ?? 0),
    menteeCount: Number(menteeCountResult?.count ?? 0),
    openRequests: Number(openRequestsResult?.count ?? 0),
    matchedRequests: Number(matchedRequestsResult?.count ?? 0),
    topTags,
  });
});

export default router;
