// Single-tenant build. Cloudflare Access cookies the browser; same-origin fetch
// automatically carries them. Functions read `Cf-Access-Authenticated-User-Email`
// off each request — no Authorization bearer is required or attached here.

import { useCallback } from "react";

// Memoized so the returned function keeps a STABLE identity across renders.
// Without this, every render produced a fresh `apiFetch`, which made any
// `useCallback(load, [api])` / `useEffect(() => load(), [load])` consumer
// (SpendPage, RentalPage, MeetingDetailPage) re-fire on every render — an
// infinite refetch storm that pinned the loading spinner forever. The wrapper
// has no dependencies, so an empty-dep `useCallback` is correct and permanent.
export function useApi() {
  return useCallback(async function apiFetch(
    input: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(input, { ...init, headers });
  }, []);
}
