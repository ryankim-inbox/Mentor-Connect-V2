import { Router, type IRouter } from "express";
import { eq, ilike, count, and } from "drizzle-orm";
import { db, districtsTable, usersTable, requestsTable } from "@workspace/db";
import { ListDistrictsQueryParams, GetDistrictParams } from "@workspace/api-zod";

const router: IRouter = Router();

async function buildDistrictResponse(district: typeof districtsTable.$inferSelect) {
  const [memberResult] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.districtId, district.id));
  const [openResult] = await db.select({ count: count() }).from(requestsTable).where(
    and(eq(requestsTable.districtId, district.id), eq(requestsTable.status, "open"))
  );
  return {
    id: district.id,
    name: district.name,
    county: district.county,
    type: district.type as "high_school" | "unified" | "elementary" | "other",
    memberCount: Number(memberResult?.count ?? 0),
    openRequestCount: Number(openResult?.count ?? 0),
  };
}

router.get("/districts", async (req, res): Promise<void> => {
  const params = ListDistrictsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(districtsTable);
  const conditions = [];

  if (params.data.type === "high_school") {
    conditions.push(eq(districtsTable.type, "high_school"));
  }

  if (params.data.search) {
    conditions.push(ilike(districtsTable.name, `%${params.data.search}%`));
  }

  const districts = conditions.length > 0
    ? await db.select().from(districtsTable).where(and(...conditions)).orderBy(districtsTable.name)
    : await db.select().from(districtsTable).orderBy(districtsTable.name);

  const results = await Promise.all(districts.map(buildDistrictResponse));
  res.json(results);
});

router.get("/districts/:id", async (req, res): Promise<void> => {
  const params = GetDistrictParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [district] = await db.select().from(districtsTable).where(eq(districtsTable.id, params.data.id));
  if (!district) {
    res.status(404).json({ error: "District not found" });
    return;
  }

  res.json(await buildDistrictResponse(district));
});

export default router;
