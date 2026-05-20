// Drop-in replacement for `@/lib/workos-shim` in a single-tenant
// Cloudflare-Access-gated dashboard.
//
// Cloudflare Access enforces auth at the network layer — every request that
// reaches the SPA already belongs to the allow-listed user. The browser
// receives `Cf-Access-Authenticated-User-Email` automatically; Pages Functions
// trust it via `functions/_lib/auth.ts`. The SPA itself doesn't need to
// negotiate tokens, redirect to a hosted login, or decode JWTs.
//
// We keep the WorkOS-shaped `useAuth` so existing components compile without
// edits. `signIn` is a no-op (you're already in), `signOut` redirects to
// `/cdn-cgi/access/logout` which clears the Access session.

import type { ReactNode } from "react";

const OWNER_EMAIL =
  (import.meta.env.VITE_OWNER_EMAIL as string | undefined) ??
  "aitheroad@gmail.com";

const FIXED_USER = {
  id: OWNER_EMAIL,
  firstName: "Yaron",
  lastName: "",
  email: OWNER_EMAIL,
  profilePictureUrl: null,
};

export function AuthKitProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

type SignInOpts = { organizationId?: string } | undefined;

export function useAuth() {
  return {
    isLoading: false,
    user: FIXED_USER,
    signIn: (_opts?: SignInOpts) => {
      // Cloudflare Access already authed the request; nothing to do.
    },
    signOut: () => {
      window.location.href = "/cdn-cgi/access/logout";
    },
    getAccessToken: async (): Promise<string | undefined> => undefined,
  };
}
