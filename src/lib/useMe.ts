import { useQuery } from "@tanstack/react-query";

export type Role = "admin" | "move";

export interface Me {
  email: string;
  role: Role;
}

/**
 * Resolves the *real* signed-in identity + role from the server (`/api/me`),
 * which derives them from the verified CF Access JWT. This replaces the
 * hardcoded `FIXED_USER` (always "Yaron") for any decision that must branch on
 * who is actually logged in.
 *
 * Fail-safe: the SERVER is the real authorization wall (see `_middleware.ts`),
 * so the front end fails toward the owner view on a transient `/api/me` error —
 * the owner is never locked out of his own UI, and a move user who slips through
 * the cosmetic gate still gets 403 on every non-move endpoint.
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

  // role resolves to "admin" until/unless the server says "move".
  const role: Role = q.data?.role === "move" ? "move" : "admin";

  return {
    email: q.data?.email,
    role,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
