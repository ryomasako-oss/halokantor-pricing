/* Zod schemas guarding everything that crosses the API boundary. */

import { z } from "zod";

export const assumptionsSchema = z.object({
  opex: z.number().min(0).max(2),
  targetMargin: z.number().min(0).max(0.95),
  leaderMargin: z.number().min(0).max(0.95),
  profitDiscount: z.number().min(0).max(0.95),
  rrpDiscount: z.number().min(0).max(0.95),
  marginFloor: z.number().min(0).max(0.95),
  ppn: z.number().min(0).max(0.5),
  step: z.number().int().min(1).max(1_000_000),
  months: z.number().int().min(1).max(120),
  includeLogistics: z.boolean(),
}).refine((a) => a.leaderMargin <= a.targetMargin, {
  message: "leaderMargin tidak boleh melebihi targetMargin.",
  path: ["leaderMargin"],
});

/* qty/cogs/rrp bounds are sized so that, even with the max 2000 items per
   quote (see snapshotSchema), qty * cogs summed across every line stays
   comfortably under Number.MAX_SAFE_INTEGER (~9e15): 50,000 * 50,000,000 *
   2000 = 5e15. Loosening any of the three needs re-checking that math. */
export const itemSchema = z.object({
  id: z.string().min(1).max(64),
  lineNo: z.number().int().min(0),
  code: z.string().max(64).default(""),
  name: z.string().min(1).max(300),
  uom: z.string().max(32).default("Pcs"),
  qty: z.number().min(0).max(50_000),
  cogs: z.number().min(0).max(50_000_000),
  rrp: z.number().min(0).max(50_000_000),
  role: z.enum(["LEADER", "CORE", "PROFIT"]),
  estCogs: z.boolean().optional(),
  manualPrice: z.array(z.number().nullable()).length(3).optional(),
  notes: z.string().max(500).optional(),
});

export const regionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  share: z.number().min(0).max(1),
  deliveries: z.number().min(0).max(1000),
  cost: z.number().min(0).max(100_000_000),
});

export const metaSchema = z.object({
  quoteNo: z.string().max(64).default(""),
  date: z.string().max(32),
  validity: z.number().int().min(1).max(365),
  payment: z.string().max(300).default(""),
  delivery: z.string().max(300).default(""),
  notes: z.string().max(4000).default(""),
  preparedBy: z.string().max(120).optional(),
});

export const snapshotSchema = z.object({
  assumptions: assumptionsSchema,
  items: z.array(itemSchema).max(2000),
  regions: z.array(regionSchema).max(100),
  meta: metaSchema,
  scenario: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

export const policySchema = z.object({
  minNetMargin: z.number().min(0).max(0.95),
  minLineMargin: z.number().min(-1).max(0.95),
  maxBasketDiscount: z.number().min(0).max(1),
  allowBelowCost: z.boolean(),
  approvalValueThreshold: z.number().min(0).max(1e15),
});

export const companySchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().min(1).max(120),
  tagline: z.string().max(200).default(""),
  address: z.string().max(500).default(""),
  phone: z.string().max(64).default(""),
  email: z.string().max(200).default(""),
  npwp: z.string().max(64).default(""),
  bank: z.string().max(300).default(""),
});

export const clientSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(64).default(""),
  address: z.string().max(500).default(""),
  contact_name: z.string().max(120).default(""),
  contact_email: z.string().max(200).default(""),
  contact_phone: z.string().max(64).default(""),
  payment_terms: z.string().max(200).default(""),
  delivery_terms: z.string().max(200).default(""),
});

export const catalogRowSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  uom: z.string().max(32).optional(),
  cogs: z.number().min(0).max(1e12).optional(),
  list_price: z.number().min(0).max(1e12).optional(),
  stock: z.number().min(-1e9).max(1e9).optional(),
  category: z.string().max(120).optional(),
});

/** Formats a ZodError into one human-readable line for the UI. */
export function zodMessage(err: z.ZodError): string {
  return err.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
}
