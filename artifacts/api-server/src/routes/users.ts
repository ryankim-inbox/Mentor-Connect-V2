import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, districtsTable } from "@workspace/db";
import { GetUserParams, UpdateUserParams, UpdateUserBody } from "@workspace/api-zod";

const router: IRouter = Router();

function formatUser(user: typeof usersTable.$inferSelect, districtName: string | null) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    districtId: user.districtId,
    districtName,
    bio: user.bio,
    subjects: user.subjects,
    isVerified: user.isVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users/:id", async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, user.districtId));
  res.json(formatUser(user, district?.name ?? null));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (params.data.id !== req.session.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.bio !== undefined) updateData.bio = parsed.data.bio;
  if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
  if (parsed.data.subjects !== undefined) updateData.subjects = parsed.data.subjects;

  const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, user.districtId));
  res.json(formatUser(user, district?.name ?? null));
});

export default router;
