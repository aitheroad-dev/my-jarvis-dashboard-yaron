// SettingsPage.tsx — MJOS-042
//
// User settings UI. Reads identity from the WorkOS AuthKit user; reads /
// writes preferences via useUserSettings() which round-trips a JSONB blob
// to /api/settings (Neon-backed user_settings table).
//
// First setting: voice_autoplay — does the right-rail voice panel open
// automatically when the dashboard loads. The Layout shell consumes the
// same hook (see Layout.tsx) so flipping this toggle takes effect on the
// next page load (no remount needed).

import { useAuth } from "@/lib/workos-shim";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUserSettings } from "@/hooks/useUserSettings";

export const SettingsPage = () => {
  const { user } = useAuth();
  const { settings, loaded, update } = useUserSettings();

  const fullName = [user?.firstName, user?.lastName]
    .filter((v): v is string => Boolean(v))
    .join(" ");
  const displayName = fullName || user?.email || "User";
  const initial = displayName.charAt(0).toUpperCase();

  // Default: open. Only respect a stored `false` — undefined keeps the
  // historical "panel opens on load" behavior so existing users aren't
  // surprised.
  const voiceAutoplay = settings.voice_autoplay !== false;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your profile and dashboard preferences.
        </p>
      </div>

      {/* Profile */}
      <section className="mb-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Profile
        </h2>
        <div className="rounded-xl border bg-card p-5 flex items-center gap-4">
          <Avatar className="h-12 w-12">
            {user?.profilePictureUrl && (
              <AvatarImage src={user.profilePictureUrl} />
            )}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-base font-semibold text-foreground truncate">
              {displayName}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {user?.email ?? "—"}
            </div>
          </div>
        </div>
      </section>

      {/* Preferences */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Preferences
        </h2>
        <div className="rounded-xl border bg-card divide-y">
          <div className="flex items-start justify-between gap-6 p-5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Open voice feed automatically
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                When the dashboard loads, the voice feed panel opens by
                default. Turn this off to start with the panel collapsed.
              </div>
            </div>
            <Switch
              checked={voiceAutoplay}
              disabled={!loaded}
              onCheckedChange={(checked) => update({ voice_autoplay: checked })}
            />
          </div>
        </div>
      </section>
    </div>
  );
};

(SettingsPage as unknown as { path: string }).path = "/settings";
