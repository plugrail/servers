// Timing-safe string comparison for the ADMIN_TOKEN check (1B-1 Step 4-2).
//
// Uses node:crypto's `timingSafeEqual`, available under the `nodejs_compat`
// compatibility flag this Worker already requires (see wrangler.jsonc /
// ADR-001). `timingSafeEqual` throws on length mismatch, so we special-case
// that first — this leaks token *length* via timing but not content, which is
// the conventional trade-off for this kind of check.

import { timingSafeEqual } from "node:crypto";

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, "utf8");
  const bBytes = Buffer.from(b, "utf8");
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  return timingSafeEqual(aBytes, bBytes);
}
