import { expect, test } from "bun:test";
import {
  allowedApiPrefixes,
  apiPathAllowed,
  grantFor,
  grantedKeys,
} from "./pages";

// --- grant resolution -------------------------------------------------------

test("owner gets 'all'", () => {
  expect(grantFor("aitheroad@gmail.com", {}, true)).toBe("all");
});

// Page grants now live in D1 (see resolveGrant); the code default is empty, so
// grantFor is purely the owner + ACCESS_GRANTS-env override path. A known guest
// whose grant lives only in D1 is invisible to grantFor → []. (D1-backed
// resolution is covered separately by resolveGrant, which grantFor delegates
// the D1 read to in production.)
test("guest with no env grant is deny-by-default (grantFor sees no D1)", () => {
  expect(grantFor("noabarkai@gmail.com", {}, false)).toEqual([]);
});

test("unknown guest is deny-by-default (empty grant)", () => {
  expect(grantFor("stranger@example.com", {}, false)).toEqual([]);
});

test("email match is case-insensitive for env-grant resolution", () => {
  const env = {
    ACCESS_GRANTS: JSON.stringify({ "noabarkai@gmail.com": ["move", "rental"] }),
  };
  expect(grantFor("NoaBarkai@Gmail.com", env, false)).toEqual(["move", "rental"]);
});

test("ACCESS_GRANTS env overrides the default grant", () => {
  const env = { ACCESS_GRANTS: JSON.stringify({ "bob@example.com": ["goals"] }) };
  expect(grantFor("bob@example.com", env, false)).toEqual(["goals"]);
});

test("ACCESS_GRANTS env drops invalid page keys, keeps valid", () => {
  const env = {
    ACCESS_GRANTS: JSON.stringify({ "bob@example.com": ["goals", "WORLD_DOMINATION"] }),
  };
  expect(grantFor("bob@example.com", env, false)).toEqual(["goals"]);
});

test("malformed ACCESS_GRANTS is ignored, never throws (deny-by-default)", () => {
  const env = { ACCESS_GRANTS: "{not json" };
  expect(grantFor("noabarkai@gmail.com", env, false)).toEqual([]);
});

// --- prefix derivation ------------------------------------------------------

test("guest prefixes = granted pages' apis + always-allowed, nothing else", () => {
  const p = allowedApiPrefixes(["move", "rental"]);
  expect(p).toContain("/api/move");
  expect(p).toContain("/api/rental");
  expect(p).toContain("/api/me");
  expect(p).toContain("/api/version");
  expect(p).toContain("/api/settings");
  // NOT granted:
  expect(p).not.toContain("/api/portfolio");
  expect(p).not.toContain("/api/spend");
  expect(p).not.toContain("/api/projects");
});

test("owner prefixes = everything", () => {
  expect(allowedApiPrefixes("all")).toEqual(["/api/"]);
});

test("grantedKeys('all') = every key", () => {
  expect(grantedKeys("all").size).toBeGreaterThanOrEqual(13);
});

// --- the matcher: positive ---------------------------------------------------

const guest = allowedApiPrefixes(["move", "rental"]);

test("granted exact + child segment pass", () => {
  expect(apiPathAllowed("/api/move", guest)).toBe(true);
  expect(apiPathAllowed("/api/move/123", guest)).toBe(true);
  expect(apiPathAllowed("/api/rental", guest)).toBe(true);
  expect(apiPathAllowed("/api/me", guest)).toBe(true);
  expect(apiPathAllowed("/api/settings", guest)).toBe(true);
});

// --- the matcher: adversarial (must DENY) -----------------------------------

test("non-granted pages are denied for a guest", () => {
  expect(apiPathAllowed("/api/portfolio", guest)).toBe(false);
  expect(apiPathAllowed("/api/spend", guest)).toBe(false);
  expect(apiPathAllowed("/api/projects", guest)).toBe(false);
  expect(apiPathAllowed("/api/memories", guest)).toBe(false);
  expect(apiPathAllowed("/api/voice", guest)).toBe(false);
  expect(apiPathAllowed("/api/voice/clip", guest)).toBe(false);
});

test("prefix-boundary confusion is denied (no /api/moveX leak)", () => {
  expect(apiPathAllowed("/api/moves", guest)).toBe(false);
  expect(apiPathAllowed("/api/move-secret", guest)).toBe(false);
  expect(apiPathAllowed("/api/rentalzzz", guest)).toBe(false);
});

test("traversal + odd separators are denied", () => {
  expect(apiPathAllowed("/api/move/../portfolio", guest)).toBe(false);
  expect(apiPathAllowed("/api//move", guest)).toBe(false);
  expect(apiPathAllowed("/api/move/..\\portfolio", guest)).toBe(false);
  expect(apiPathAllowed("/api/move/..", guest)).toBe(false);
});

// Mirror of the _middleware.ts decision: decode up to 3x, then require BOTH the
// raw and the decoded form to pass. This is the actual deployed defense against
// encoded prefixes / encoded traversal.
function safeDecode(p: string): string | null {
  try {
    let cur = p;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(cur);
      if (next === cur) return cur;
      cur = next;
    }
    return cur;
  } catch {
    return null;
  }
}
function middlewareAllows(raw: string, prefixes: string[]): boolean {
  const decoded = safeDecode(raw);
  return decoded !== null && apiPathAllowed(raw, prefixes) && apiPathAllowed(decoded, prefixes);
}

test("middleware dual-check blocks encoded prefix + encoded/double-encoded traversal", () => {
  // encoded "/api/" prefix → raw fails the clean-prefix match
  expect(middlewareAllows("/%61pi/portfolio", guest)).toBe(false);
  // encoded dot-segment → raw matches /api/move/ but DECODED has ".." → blocked
  expect(middlewareAllows("/api/move/%2e%2e%2fportfolio", guest)).toBe(false);
  // double-encoded traversal → safeDecode loops resolve it → blocked
  expect(middlewareAllows("/api/move/%252e%252e%252fportfolio", guest)).toBe(false);
  // and a legitimately granted path still passes the dual-check
  expect(middlewareAllows("/api/move", guest)).toBe(true);
  expect(middlewareAllows("/api/move/abc-123", guest)).toBe(true);
  // a non-granted page is blocked even in clean form
  expect(middlewareAllows("/api/portfolio", guest)).toBe(false);
});

test("owner matcher allows anything under /api", () => {
  const owner = allowedApiPrefixes("all");
  expect(apiPathAllowed("/api/portfolio", owner)).toBe(true);
  expect(apiPathAllowed("/api/voice/clip", owner)).toBe(true);
  // even owner can't traverse (defensive)
  expect(apiPathAllowed("/api/x/../../etc", owner)).toBe(false);
});
