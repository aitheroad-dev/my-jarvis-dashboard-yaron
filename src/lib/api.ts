// Single-tenant build. Cloudflare Access cookies the browser; same-origin fetch
// automatically carries them. Functions read `Cf-Access-Authenticated-User-Email`
// off each request — no Authorization bearer is required or attached here.

export function useApi() {
  return async function apiFetch(
    input: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(input, { ...init, headers });
  };
}
