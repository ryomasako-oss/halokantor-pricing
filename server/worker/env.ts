/* Bindings/secrets available to every request on Workers. No process.env. */

export interface Bindings {
  DB: D1Database;
  JWT_SECRET: string;
  NODE_ENV?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_NAME?: string;
  AUTH_LIMITER: RateLimit;
  ASSISTANT_LIMITER: RateLimit;
}

/** Client IP as seen by Cloudflare's edge, for keying rate limits. */
export const clientIp = (c: { req: { header: (name: string) => string | undefined } }): string =>
  c.req.header("cf-connecting-ip") ?? "unknown";

import type { User } from "../../shared/types";

export interface Variables {
  user?: User;
}

export type Env = { Bindings: Bindings; Variables: Variables };
