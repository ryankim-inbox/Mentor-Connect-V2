import { Router, type IRouter } from "express";
import { count, eq } from "drizzle-orm";
import { db, tagsTable, requestTagsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/tags", async (_req, res): Promise<void> => {
  const tags = await db.select().from(tagsTable).orderBy(tagsTable.name);

  const tagsWithCounts = await Promise.all(tags.map(async (tag) => {
    const [result] = await db.select({ count: count() }).from(requestTagsTable).where(eq(requestTagsTable.tagId, tag.id));
    return {
      id: tag.id,
      name: tag.name,
      color: tag.color,
      requestCount: Number(result?.count ?? 0),
    };
  }));

  res.json(tagsWithCounts);
});

export default router;
