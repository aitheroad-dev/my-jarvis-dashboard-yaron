import { useQuery } from "@tanstack/react-query";
import { ALL_PAGE_KEYS, type PageKey } from "./page-keys";

export type Role = "admin" | "move";

export interface Me {
  email: string;
  role: Role;
  isOwner: boolean;
  pages: PageKey[];
}

/**
 * Resolves the *real* signed-in identity + page grants from the server
 * (`/api/me`), which derives them from the verified CF Access JWT. This replaces
 * any hardcoded identity for decisions that branch on who is actually logged in
 * and what they may see.
 *
 * Fail-safe: the SERVER is the real authorization wall (see `_middleware.ts`), so
 * the front end fails toward the OWNER view on a transient `/api/me` error — the
 * owner is never locked out of his own UI, and a guest who slips through the
 * cosmetic gate still gets 403 on every endpoint outside their grant.
 */
export function useMe() {
  const q = useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/me", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`/api/me ${res.status}`);
      return (await res.json()) as Me;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // Fail toward owner: when identity hasn't resolved (or errored), assume owner
  // so the owner is never locked out. App.tsx holds render until !isLoading, so
  // a guest never flashes the owner view.
  const isOwner = q.data ? q.data.isOwner : true;
  const pages = new Set<PageKey>(q.data?.pages ?? ALL_PAGE_KEYS);
  const role: Role = q.data?.role === "move" ? "move" : "admin";

  return {
    email: q.data?.email,
    role,
    isOwner,
    pages,
    // Only the owner gets the voice subsystem; granted guests do not (and would
    // 403-spam /api/voice). Gating voice chrome on this is what keeps a guest's
    // shell from crashing on the voice context.
    hasVoice: isOwner,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
