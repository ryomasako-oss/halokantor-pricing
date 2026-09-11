import { Router } from "express";
import { getSetting, setSetting } from "../db.js";
import { audit } from "../audit.js";
import { type AuthedRequest, requireAuth, requireRole } from "../auth.js";
import { companySchema, policySchema, zodMessage } from "../validate.js";
import { DEFAULT_POLICY } from "../../shared/policy.js";

export const settingsRouter = Router();
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

settingsRouter.get("/", (_req, res) => {
  res.json({
    policy: getSetting("policy", DEFAULT_POLICY),
    company: getSetting("company", DEFAULT_COMPANY),
  });
});

settingsRouter.put("/policy", requireRole("admin"), (req: AuthedRequest, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  setSetting("policy", parsed.data);
  audit(req.user!.id, "settings", 0, "policy_updated", parsed.data);
  res.json({ policy: parsed.data });
});

settingsRouter.put("/company", requireRole("admin"), (req: AuthedRequest, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  setSetting("company", parsed.data);
  audit(req.user!.id, "settings", 0, "company_updated", parsed.data);
  res.json({ company: parsed.data });
});
