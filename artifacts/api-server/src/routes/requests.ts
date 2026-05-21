import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, requestsTable, usersTable, districtsTable, tagsTable, requestTagsTable } from "@workspace/db";
import {
  ListRequestsQueryParams,
  CreateRequestBody,
  GetRequestParams,
  UpdateRequestParams,
  UpdateRequestBody,
  DeleteRequestParams,
  MatchRequestParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildRequestResponse(request: typeof requestsTable.$inferSelect) {
  const [author] = await db.select().from(usersTable).where(eq(usersTable.id, request.authorId));
  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, request.districtId));

  const requestTagRows = await db.select().from(requestTagsTable).where(eq(requestTagsTable.requestId, request.id));
  const tags = await Promise.all(requestTagRows.map(async (rt) => {
    const [tag] = await db.select().from(tagsTable).where(eq(tagsTable.id, rt.tagId));
    if (!tag) return null;
    return { id: tag.id, name: tag.name, color: tag.color, requestCount: 0 };
  }));

  let matchedUserName: string | null = null;
  if (request.matchedUserId) {
    const [matchedUser] = await db.select().from(usersTable).where(eq(usersTable.id, request.matchedUserId));
    matchedUserName = matchedUser?.name ?? null;
  }

  return {
    id: request.id,
    authorId: request.authorId,
    authorName: author?.name ?? "Unknown",
    authorRole: request.role as "mentor" | "mentee",
    districtId: request.districtId,
    districtName: district?.name ?? "Unknown",
    title: request.title,
    description: request.description,
    tags: tags.filter(Boolean),
    status: request.status as "open" | "matched" | "closed",
    matchedUserId: request.matchedUserId ?? null,
    matchedUserName,
    createdAt: request.createdAt.toISOString(),
  };
}

router.get("/requests", async (req, res): Promise<void> => {
  const params = ListRequestsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [];
  if (params.data.districtId) conditions.push(eq(requestsTable.districtId, params.data.districtId));
  if (params.data.role) conditions.push(eq(requestsTable.role, params.data.role));
  if (params.data.status) {
    conditions.push(eq(requestsTable.status, params.data.status));
  } else {
    conditions.push(eq(requestsTable.status, "open"));
  }

  let requests = conditions.length > 0
    ? await db.select().from(requestsTable).where(and(...conditions)).orderBy(desc(requestsTable.createdAt))
    : await db.select().from(requestsTable).where(eq(requestsTable.status, "open")).orderBy(desc(requestsTable.createdAt));

  if (params.data.tagId) {
    const tagId = params.data.tagId;
    const requestTagRows = await db.select().from(requestTagsTable).where(eq(requestTagsTable.tagId, tagId));
    const requestIdsWithTag = new Set(requestTagRows.map(rt => rt.requestId));
    requests = requests.filter(r => requestIdsWithTag.has(r.id));
  }

  const results = await Promise.all(requests.map(buildRequestResponse));
  res.json(results);
});

router.post("/requests", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = CreateRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { districtId, title, description, tagIds, role } = parsed.data;

  const [request] = await db.insert(requestsTable).values({
    authorId: req.session.userId,
    districtId,
    title,
    description,
    role,
    status: "open",
  }).returning();

  if (tagIds && tagIds.length > 0) {
    await db.insert(requestTagsTable).values(tagIds.map(tagId => ({ requestId: request.id, tagId })));
  }

  res.status(201).json(await buildRequestResponse(request));
});

router.get("/requests/:id", async (req, res): Promise<void> => {
  const params = GetRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [request] = await db.select().from(requestsTable).where(eq(requestsTable.id, params.data.id));
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  res.json(await buildRequestResponse(request));
});

router.patch("/requests/:id", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const params = UpdateRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(requestsTable).where(eq(requestsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  if (existing.authorId !== req.session.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

  const [updated] = await db.update(requestsTable).set(updateData).where(eq(requestsTable.id, params.data.id)).returning();

  if (parsed.data.tagIds !== undefined) {
    await db.delete(requestTagsTable).where(eq(requestTagsTable.requestId, params.data.id));
    if (parsed.data.tagIds.length > 0) {
      await db.insert(requestTagsTable).values(parsed.data.tagIds.map(tagId => ({ requestId: params.data.id, tagId })));
    }
  }

  res.json(await buildRequestResponse(updated));
});

router.delete("/requests/:id", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const params = DeleteRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(requestsTable).where(eq(requestsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  if (existing.authorId !== req.session.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.delete(requestTagsTable).where(eq(requestTagsTable.requestId, params.data.id));
  await db.delete(requestsTable).where(eq(requestsTable.id, params.data.id));

  res.sendStatus(204);
});

router.post("/requests/:id/match", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const params = MatchRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [request] = await db.select().from(requestsTable).where(eq(requestsTable.id, params.data.id));
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  if (request.authorId === req.session.userId) {
    res.status(400).json({ error: "Cannot match your own request" });
    return;
  }

  if (request.status !== "open") {
    res.status(400).json({ error: "Request is not open" });
    return;
  }

  const [updated] = await db.update(requestsTable).set({
    status: "matched",
    matchedUserId: req.session.userId,
  }).where(eq(requestsTable.id, params.data.id)).returning();

  res.json(await buildRequestResponse(updated));
});

export default router;
