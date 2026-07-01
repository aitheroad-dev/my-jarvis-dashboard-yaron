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

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/workos-shim";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useApi } from "@/lib/api";
import { ALL_PAGE_KEYS, type PageKey } from "@/lib/page-keys";
import { useMe } from "@/lib/useMe";

type SharingGrant = { email: string; pages: PageKey[] };

const PAGE_LABELS: Record<PageKey, string> = {
  home: "Home",
  goals: "Goals",
  projects: "Projects",
  portfolio: "Portfolio",
  spend: "Spend",
  "deployed-sites": "Sites",
  move: "Move",
  rental: "Rental",
  koop: "Koop",
  "koop-plots": "Large plots",
  "finding-a-farm": "Finding a Farm",
  report: "Report",
  situation: "Situation",
  agents: "Agents",
  skills: "Skills",
  memory: "Memory",
  "knowledge-base": "Knowledge Base",
  meetings: "Meetings",
  tools: "Tools",
};

function isPageKey(value: string): value is PageKey {
  return (ALL_PAGE_KEYS as string[]).includes(value);
}

function parseSharingGrants(value: unknown): SharingGrant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SharingGrant[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.email !== "string" || !Array.isArray(record.pages)) return [];
    const pages = record.pages.filter((page): page is PageKey => {
      return typeof page === "string" && isPageKey(page);
    });
    return [{ email: record.email.toLowerCase(), pages }];
  });
}

export const SettingsPage = () => {
  const { user } = useAuth();
  const { settings, loaded, update } = useUserSettings();
  const apiFetch = useApi();
  const me = useMe();
  const [grants, setGrants] = useState<SharingGrant[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sharingSavingEmail, setSharingSavingEmail] = useState<string | null>(null);
  const [sharingError, setSharingError] = useState<string | null>(null);

  const fullName = [user?.firstName, user?.lastName]
    .filter((v): v is string => Boolean(v))
    .join(" ");
  const displayName = fullName || user?.email || "User";
  const initial = displayName.charAt(0).toUpperCase();

  // Default: open. Only respect a stored `false` — undefined keeps the
  // historical "panel opens on load" behavior so existing users aren't
  // surprised.
  const voiceAutoplay = settings.voice_autoplay !== false;
  const showSharing = me.isOwner && !me.isLoading;

  const loadGrants = useCallback(async () => {
    setSharingLoading(true);
    setSharingError(null);
    try {
      const res = await apiFetch("/api/grants", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`/api/grants ${res.status}`);
      setGrants(parseSharingGrants(await res.json()));
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Failed to load grants");
    } finally {
      setSharingLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (showSharing) void loadGrants();
  }, [loadGrants, showSharing]);

  const updateGrantPages = (email: string, page: PageKey, checked: boolean) => {
    setGrants((current) =>
      current.map((grant) => {
        if (grant.email !== email) return grant;
        const pages = new Set(grant.pages);
        if (checked) {
          pages.add(page);
        } else {
          pages.delete(page);
        }
        return { ...grant, pages: [...pages] };
      }),
    );
  };

  const addGrantRecipient = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setGrants((current) => {
      if (current.some((grant) => grant.email === email)) return current;
      return [...current, { email, pages: [] }];
    });
    setNewEmail("");
  };

  const saveGrant = async (grant: SharingGrant) => {
    setSharingSavingEmail(grant.email);
    setSharingError(null);
    try {
      const res = await apiFetch("/api/grants", {
        method: "POST",
        body: JSON.stringify({ email: grant.email, pages: grant.pages }),
      });
      if (!res.ok) throw new Error(`/api/grants ${res.status}`);
      await loadGrants();
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Failed to save grants");
    } finally {
      setSharingSavingEmail(null);
    }
  };

  const removeGrant = async (email: string) => {
    setSharingSavingEmail(email);
    setSharingError(null);
    try {
      const res = await apiFetch("/api/grants", {
        method: "DELETE",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`/api/grants ${res.status}`);
      await loadGrants();
    } catch (err) {
      setSharingError(err instanceof Error ? err.message : "Failed to remove grants");
    } finally {
      setSharingSavingEmail(null);
    }
  };

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

      {/* Sharing — owner only. Page grants live in D1; granting a page also
          authorizes that person at the app layer (see functions/_lib/auth.ts
          allowListAsync). The CF Access edge allow-list is a separate manual
          step and is intentionally NOT managed here. */}
      {showSharing && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Sharing
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Grant specific pages to other people. They must already be allowed
            through Cloudflare Access; granting a page here authorizes them for
            it inside the dashboard.
          </p>

          {sharingError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 text-destructive text-sm p-4 mb-4">
              {sharingError}
            </div>
          )}

          <div className="rounded-xl border bg-card divide-y">
            {sharingLoading && grants.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">Loading…</div>
            ) : grants.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">
                No one has been granted any pages yet.
              </div>
            ) : (
              grants.map((grant) => {
                const granted = new Set(grant.pages);
                const busy = sharingSavingEmail === grant.email;
                return (
                  <div key={grant.email} className="p-5">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div className="text-sm font-medium text-foreground truncate">
                        {grant.email}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void saveGrant(grant)}
                        >
                          <Save className="h-4 w-4 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void removeGrant(grant.email)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                      {ALL_PAGE_KEYS.map((page) => (
                        <label
                          key={page}
                          className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input accent-primary"
                            checked={granted.has(page)}
                            disabled={busy}
                            onChange={(e) =>
                              updateGrantPages(grant.email, page, e.target.checked)
                            }
                          />
                          <span className="truncate">{PAGE_LABELS[page]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })
            )}

            <div className="p-5 flex items-center gap-2">
              <Input
                type="email"
                placeholder="add person by email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGrantRecipient();
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={!newEmail.trim()}
                onClick={addGrantRecipient}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            New people start with no pages — tick the pages to share, then Save.
          </p>
        </section>
      )}
    </div>
  );
};

(SettingsPage as unknown as { path: string }).path = "/settings";
