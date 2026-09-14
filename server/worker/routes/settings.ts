import { Hono } from "hono";
import { getSetting, setSetting } from "../../db.d1";
import { audit } from "../audit";
import { requireAuth, requirePermission } from "../auth";
import { companySchema, policySchema, zodMessage } from "../../validate";
import { DEFAULT_POLICY } from "../../../shared/policy";
import type { Env } from "../env";

export const settingsRouter = new Hono<Env>();
settingsRouter.use(requireAuth);

export const DEFAULT_COMPANY = {
  name: "PT Salvator Inti Pratama",
  brand: "Halokantor",
  tagline: "Perlengkapan kantor B2B",
  address: "Tiang Bendera 3 No. 52-9, Jakarta Barat, DKI Jakarta",
  phone: "",
  email: "",
  npwp: "",
  bank: "",
};

settingsRouter.get("/", async (c) => {
  const policy = await getSetting(c.env.DB, "policy", DEFAULT_POLICY);
  const company = await getSetting(c.env.DB, "company", DEFAULT_COMPANY);
  return c.json({ policy, company });
});

settingsRouter.put("/policy", requirePermission("manage_policy"), async (c) => {
  const user = c.get("user")!;
  const parsed = policySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  await setSetting(c.env.DB, "policy", parsed.data);
  await audit(c.env.DB, user.id, "settings", 0, "policy_updated", parsed.data);
  return c.json({ policy: parsed.data });
});

settingsRouter.put("/company", requirePermission("manage_company"), async (c) => {
  const user = c.get("user")!;
  const parsed = companySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  await setSetting(c.env.DB, "company", parsed.data);
  await audit(c.env.DB, user.id, "settings", 0, "company_updated", parsed.data);
  return c.json({ company: parsed.data });
});
