import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, reportsTable, blocksTable, usersTable } from "@workspace/db";
import { CreateReportBody, BlockUserBody, UnblockUserParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/reports", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { reportedUserId, reason, description } = parsed.data;

  await db.insert(reportsTable).values({
    reporterId: req.session.userId,
    reportedUserId,
    reason,
    description: description ?? null,
  });

  res.status(201).json({ message: "Report submitted successfully" });
});

router.get("/blocks", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const blocks = await db.select().from(blocksTable).where(eq(blocksTable.blockerId, req.session.userId));

  const result = await Promise.all(blocks.map(async (block) => {
    const [blocked] = await db.select().from(usersTable).where(eq(usersTable.id, block.blockedUserId));
    return {
      id: block.id,
      blockedUserId: block.blockedUserId,
      blockedUserName: blocked?.name ?? "Unknown",
      createdAt: block.createdAt.toISOString(),
    };
  }));

  res.json(result);
});

router.post("/blocks", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = BlockUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { blockedUserId } = parsed.data;

  if (blockedUserId === req.session.userId) {
    res.status(400).json({ error: "Cannot block yourself" });
    return;
  }

  const existing = await db.select().from(blocksTable).where(
    and(eq(blocksTable.blockerId, req.session.userId), eq(blocksTable.blockedUserId, blockedUserId))
  );

  if (existing.length > 0) {
    res.status(201).json({ message: "Already blocked" });
    return;
  }

  await db.insert(blocksTable).values({
    blockerId: req.session.userId,
    blockedUserId,
  });

  res.status(201).json({ message: "User blocked successfully" });
});

router.delete("/blocks/:blockedUserId", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const params = UnblockUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(blocksTable).where(
    and(eq(blocksTable.blockerId, req.session.userId), eq(blocksTable.blockedUserId, params.data.blockedUserId))
  );

  res.sendStatus(204);
});

export default router;
