import { createHmac } from "crypto";
import { env } from "./env.js";

export function sign(payload: unknown): string {
  return createHmac("sha256", env.HMAC_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
}
