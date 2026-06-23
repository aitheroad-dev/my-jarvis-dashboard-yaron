import type { PagesFunction } from "@cloudflare/workers-types";
import {
  isOwnerEmail,
  json,
  requireUser,
  type AuthedUser,
  type Env,
} from "../../_lib/auth";
import { ALL_PAGE_KEYS, type PageKey } from "../../_lib/pages";

type GrantRow = { email: string; page_key: string };
type GrantEntry = { email: string; pages: PageKey[] };
type GrantPostBody = { email: string; pages: string[] };
type GrantDeleteBody = { email: string; page?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPageKey(value: string): value is PageKey {
  return (ALL_PAGE_KEYS as string[]).includes(value);
}

async function requireOwner(request: Request, env: Env): Promise<AuthedUser | Response> {
  let auth: AuthedUser;
  try {
    auth = await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  if (!isOwnerEmail(auth.email, env)) {
    return json({ error: "forbidden" }, { status: 403 });
  }
  return auth;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "body must be a JSON object" }, { status: 400 });
    }
    return body as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }
}

function normalizeGrantEmail(value: unknown, env: Env): string | Response {
  if (typeof value !== "string") {
    return json({ error: "email must be a string" }, { status: 400 });
  }
  const email = value.trim().toLowerCase();
  if (!email || email === "all" || !EMAIL_RE.test(email)) {
    return json({ error: "invalid email" }, { status: 400 });
  }
  if (isOwnerEmail(email, env)) {
    return json({ error: "owner cannot receive page grants" }, { status: 400 });
  }
  return email;
}

function parsePageList(value: unknown): PageKey[] | Response {
  if (!Array.isArray(value)) {
    return json({ error: "pages must be an array" }, { status: 400 });
  }
  const pages = new Set<PageKey>();
  for (const page of value) {
    if (typeof page !== "string" || page === "all" || !isPageKey(page)) {
      return json({ error: "invalid page key" }, { status: 400 });
    }
    pages.add(page);
  }
  return [...pages];
}

function parseOptionalPage(value: unknown): PageKey | undefined | Response {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "all" || !isPageKey(value)) {
    return json({ error: "invalid page key" }, { status: 400 });
  }
  return value;
}

function groupGrantRows(rows: GrantRow[]): GrantEntry[] {
  const grouped = new Map<string, Set<PageKey>>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!email || !isPageKey(row.page_key)) continue;
    const pages = grouped.get(email) ?? new Set<PageKey>();
    pages.add(row.page_key);
    grouped.set(email, pages);
  }
  return [...grouped.entries()].map(([email, pages]) => ({
    email,
    pages: [...pages],
  }));
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    "SELECT email, page_key FROM page_grants ORDER BY lower(email), page_key",
  ).all<GrantRow>();
  return json(groupGrantRows(results ?? []));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if (auth instanceof Response) return auth;

  const rawBody = await readJsonObject(request);
  if (rawBody instanceof Response) return rawBody;

  const body: GrantPostBody = {
    email: String(rawBody.email ?? ""),
    pages: Array.isArray(rawBody.pages) ? rawBody.pages.map((page) => String(page)) : [],
  };
  const email = normalizeGrantEmail(body.email, env);
  if (email instanceof Response) return email;

  if (!Array.isArray(rawBody.pages)) {
    return json({ error: "pages must be an array" }, { status: 400 });
  }
  const pages = parsePageList(rawBody.pages);
  if (pages instanceof Response) return pages;

  const statements = [
    env.DB.prepare("DELETE FROM page_grants WHERE email = ?1").bind(email),
    ...pages.map((page) =>
      env.DB.prepare(
        "INSERT INTO page_grants (email, page_key, granted_by) VALUES (?1, ?2, ?3)",
      ).bind(email, page, auth.email),
    ),
  ];
  await env.DB.batch(statements);

  return json({ email, pages });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if (auth instanceof Response) return auth;

  const rawBody = await readJsonObject(request);
  if (rawBody instanceof Response) return rawBody;

  const body: GrantDeleteBody = {
    email: String(rawBody.email ?? ""),
    page: rawBody.page === undefined ? undefined : String(rawBody.page),
  };
  const email = normalizeGrantEmail(body.email, env);
  if (email instanceof Response) return email;

  const page = parseOptionalPage(rawBody.page);
  if (page instanceof Response) return page;

  if (page) {
    await env.DB.prepare("DELETE FROM page_grants WHERE email = ?1 AND page_key = ?2")
      .bind(email, page)
      .run();
    return json({ email, page });
  }

  await env.DB.prepare("DELETE FROM page_grants WHERE email = ?1").bind(email).run();
  return json({ email });
};
