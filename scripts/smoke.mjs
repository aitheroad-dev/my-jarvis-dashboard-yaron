#!/usr/bin/env node
/**
 * End-to-end smoke test for the deployed Lilach dashboard.
 *
 *   npm run smoke            # runs against production pages.dev
 *   BASE=https://... npm run smoke
 *
 * What it does:
 *   1. Uses Clerk Backend API to create a short-lived test user.
 *   2. Creates a sign-in token for that user.
 *   3. Exchanges the ticket via Clerk's Frontend API to get a session JWT.
 *   4. Calls POST /api/clients → expects 201 and a row.
 *   5. Calls GET  /api/clients → expects the row back.
 *   6. Calls POST /api/sessions with the new client id.
 *   7. Calls GET  /api/sessions → expects the row back.
 *   8. Cleans up (deletes test user via Clerk).
 */
import { createClerkClient } from "@clerk/backend";

const BASE = process.env.BASE ?? "https://my-jarvis-dashboard-yaron.pages.dev";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
if (!CLERK_SECRET_KEY || !CLERK_PUBLISHABLE_KEY) {
  console.error("Need CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY in env");
  process.exit(1);
}

// Frontend API host is encoded in the publishable key (base64 of "<host>$").
function frontendApiFromPublishableKey(pk) {
  const b64 = pk.replace(/^pk_(test|live)_/, "");
  const decoded = Buffer.from(b64, "base64").toString("utf8");
  return decoded.replace(/\$$/, "");
}

const frontendHost = frontendApiFromPublishableKey(CLERK_PUBLISHABLE_KEY);
const frontendApi = `https://${frontendHost}`;

const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });

const ts = Date.now();
const testEmail = `smoke+${ts}@example.com`;

function log(...a) {
  console.log("•", ...a);
}

async function httpJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

let user, token;

try {
  log("creating test user:", testEmail);
  user = await clerk.users.createUser({
    emailAddress: [testEmail],
    password: "Sm0keTest!Lilach2026",
    firstName: "Smoke",
    lastName: "Test",
    skipPasswordChecks: true,
  });
  log("user id:", user.id);

  log("creating sign-in token");
  const signInToken = await clerk.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 300,
  });

  log("exchanging ticket via frontend API");
  const exchangeRes = await httpJson(
    `${frontendApi}/v1/client/sign_ins?_clerk_js_version=5.19`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        strategy: "ticket",
        ticket: signInToken.token,
      }).toString(),
    },
  );
  if (exchangeRes.status >= 400) {
    throw new Error(
      `ticket exchange failed: ${exchangeRes.status} ${JSON.stringify(exchangeRes.body)}`,
    );
  }
  // The response.created_session_id is the newly-created session.
  const signIn = exchangeRes.body.response ?? exchangeRes.body;
  const sessionId =
    signIn?.created_session_id ??
    signIn?.client?.last_active_session_id ??
    signIn?.client?.sessions?.[0]?.id;
  if (!sessionId) {
    throw new Error(
      "could not find session id in sign-in response: " +
        JSON.stringify(exchangeRes.body).slice(0, 500),
    );
  }
  log("session id:", sessionId);

  // Mint a fresh JWT via Backend API
  const tokenRes = await clerk.sessions.getToken(sessionId, "");
  token = tokenRes.jwt;
  if (!token) throw new Error("no jwt returned from getToken");
  log("got session JWT (len", token.length, ")");

  const authed = (path, init = {}) =>
    httpJson(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });

  log("POST /api/clients");
  const createRes = await authed("/api/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Lilach Client",
      phone: "050-1234567",
      email: "client@example.com",
      notes: "created by smoke test",
    }),
  });
  if (createRes.status !== 201) {
    throw new Error(
      `client POST failed: ${createRes.status} ${JSON.stringify(createRes.body)}`,
    );
  }
  const client1 = createRes.body;
  log("  → client id", client1.id);

  log("GET /api/clients");
  const listRes = await authed("/api/clients");
  if (listRes.status !== 200 || !Array.isArray(listRes.body)) {
    throw new Error(`client GET failed: ${listRes.status}`);
  }
  const found = listRes.body.find((c) => c.id === client1.id);
  if (!found) throw new Error("created client not found in list");
  log("  → list length:", listRes.body.length);

  log("POST /api/sessions");
  const sessionRes = await authed("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: client1.id,
      scheduled_at: new Date().toISOString(),
      summary: "smoke test session",
    }),
  });
  if (sessionRes.status !== 201) {
    throw new Error(
      `session POST failed: ${sessionRes.status} ${JSON.stringify(sessionRes.body)}`,
    );
  }
  const session1 = sessionRes.body;
  log("  → session id", session1.id);

  log("GET /api/sessions");
  const sListRes = await authed("/api/sessions");
  if (sListRes.status !== 200 || !Array.isArray(sListRes.body)) {
    throw new Error(`session GET failed: ${sListRes.status}`);
  }
  const sFound = sListRes.body.find((s) => s.id === session1.id);
  if (!sFound) throw new Error("created session not found in list");
  log("  → sessions length:", sListRes.body.length);
  log("  → session.client_name:", sFound.client_name);

  console.log("\n✓ SMOKE PASSED");
  console.log(JSON.stringify({
    client: { id: client1.id, name: client1.name },
    session: { id: session1.id, client_name: sFound.client_name },
    counts: { clients: listRes.body.length, sessions: sListRes.body.length },
  }, null, 2));
} catch (err) {
  console.error("\n✗ SMOKE FAILED:", err?.message ?? err);
  process.exitCode = 1;
} finally {
  if (user?.id) {
    log("cleaning up user", user.id);
    try {
      await clerk.users.deleteUser(user.id);
      log("  → deleted");
    } catch (e) {
      log("  → cleanup failed:", e?.message ?? e);
    }
  }
}
