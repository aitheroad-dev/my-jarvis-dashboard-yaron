/**
 * Canonical `useAuth()` shim for the dashboard template.
 *
 * Wraps WorkOS AuthKit's `useAuth` into a template-neutral shape that:
 *   - renames `signOut` → `logout` (matches ra-core idiom)
 *   - exposes `identity` with `fullName` falling back to email
 *   - re-exports `getAccessToken` so existing template code (src/lib/api.ts,
 *     VoiceChannelProvider) can bind through a single hook
 *
 * Downstream: `ra-core-compat.ts` wraps this into `useGetIdentity()` /
 * `useLogout()` for ra-core-era pages being ported over (Daniel, Flame King,
 * OS-merged). New pages should use `useAuth()` directly.
 */
import { useAuth as useAuthKit } from "@/lib/workos-shim";

export interface AuthIdentity {
  /** WorkOS `user.id` — same value as `oauth_subject` in admin.tenants. */
  id: string;
  /** `"{first} {last}"` (trimmed) → falls back to email → "Unknown". */
  fullName?: string;
  email?: string;
  avatar?: string;
}

export interface Auth {
  identity: AuthIdentity | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  getAccessToken: () => Promise<string | undefined>;
}

export function useAuth(): Auth {
  const { isLoading, user, signOut, getAccessToken } = useAuthKit();

  const identity: AuthIdentity | undefined = user
    ? {
        id: user.id,
        fullName:
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
          user.email ||
          "Unknown",
        email: user.email ?? undefined,
        avatar: user.profilePictureUrl ?? undefined,
      }
    : undefined;

  return {
    identity,
    isLoading,
    isAuthenticated: !!user,
    logout: () => signOut(),
    getAccessToken,
  };
}
