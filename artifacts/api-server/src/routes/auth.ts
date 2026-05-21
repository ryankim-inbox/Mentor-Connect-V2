import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, districtsTable } from "@workspace/db";
import { RegisterBody, LoginBody } from "@workspace/api-zod";

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

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, name, password, role, districtId } = parsed.data;

  if (!email.toLowerCase().endsWith(".edu")) {
    res.status(400).json({ error: "Only .edu school email addresses are allowed" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, districtId));
  if (!district) {
    res.status(400).json({ error: "Invalid district" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    name,
    passwordHash,
    role,
    districtId,
    isVerified: true,
    subjects: [],
  }).returning();

  req.session.userId = user.id;

  res.status(201).json({
    user: formatUser(user, district.name),
    message: "Registered successfully",
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, user.districtId));

  req.session.userId = user.id;

  res.json({
    user: formatUser(user, district?.name ?? null),
    message: "Logged in successfully",
  });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy(() => {});
  res.json({ message: "Logged out successfully" });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, user.districtId));

  res.json(formatUser(user, district?.name ?? null));
});

export default router;
