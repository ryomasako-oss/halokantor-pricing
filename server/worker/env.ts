/* Bindings/secrets available to every request on Workers. No process.env. */

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  NODE_ENV?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_NAME?: string;
  AUTH_LIMITER: RateLimit;
  ASSISTANT_LIMITER: RateLimit;
  API_LIMITER: RateLimit;
  APP_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
}

/** Client IP as seen by Cloudflare's edge, for keying rate limits. */
export const clientIp = (c: { req: { header: (name: string) => string | undefined } }): string =>
  c.req.header("cf-connecting-ip") ?? "unknown";

import type { User } from "../../shared/types";

export interface Variables {
  user?: User;
}

export type Env = { Bindings: Bindings; Variables: Variables };
