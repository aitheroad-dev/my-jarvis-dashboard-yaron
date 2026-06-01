import { useState } from "react";
import { MessageCircle, Mic, X, Copy, Download } from "lucide-react";
import { useVoiceChannel, type VoiceSample } from "./VoiceChannelProvider";
import { VoicePlayerInline } from "./VoicePlayerInline";
import { cn } from "@/lib/utils";

// Hosted in this tenant's R2 bucket under the `avatars/` prefix, served via
// the bucket's public r2.dev URL. Same origin as the voice WAV files — one
// bucket for all dashboard audio assets. The bucket URL is set per-tenant
// via `VITE_VOICE_PUBLIC_URL` (the provisioner fills it after R2 setup).
const AVATAR_BASE = `${import.meta.env.VITE_VOICE_PUBLIC_URL ?? ""}/avatars`;

// Colors are the canonical PAI persona colors from ~/.config/myjarvis/agents/<name>.json
// — keep these in sync with that source of truth so the dashboard, the local
// voice player, and the agent configs all show the same color per agent.
// Rex has no avatar image yet (rex.jpg 404 in R2) → renders a colored initial.
const AGENT_META: Record<string, { label: string; color: string; avatar: string }> = {
  jarvis: { label: "Jarvis", color: "#4f9cf9", avatar: `${AVATAR_BASE}/jarvis.jpg` },
  atlas: { label: "Atlas", color: "#34d399", avatar: `${AVATAR_BASE}/atlas.jpg` },
  nova: { label: "Nova", color: "#f472b6", avatar: `${AVATAR_BASE}/nova.jpg` },
  rex: { label: "Rex", color: "#fb923c", avatar: "" },
  ben: { label: "Ben", color: "#0891b2", avatar: `${AVATAR_BASE}/ben.jpg` },
  emma: { label: "Emma", color: "#db2777", avatar: `${AVATAR_BASE}/emma.jpg` },
  iris: { label: "Iris", color: "#65a30d", avatar: `${AVATAR_BASE}/iris.jpg` },
  echo: { label: "Echo", color: "#16a34a", avatar: `${AVATAR_BASE}/echo.jpg` },
  bolt: { label: "Bolt", color: "#f59e0b", avatar: "" },
  spark: { label: "Spark", color: "#ef4444", avatar: "" },
};

// The persona color for any agent_name, with a neutral fallback for unknowns.
function agentColor(agentName: string | null): string {
  const meta = AGENT_META[(agentName || "").toLowerCase()];
  return meta?.color ?? "#6b7280";
}

// Capitalize first letter; everything else as-is. Used as the display
// fallback when an agent_name isn't in AGENT_META.
function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

function AgentAvatar({ agentName }: { agentName: string | null }) {
  const key = (agentName || "").toLowerCase();
  const meta = key ? AGENT_META[key] : null;
  if (!meta) {
    // Unknown agent_name. If a name was provided, render an initial-letter
    // circle so the user still sees who sent it; only fall back to the
    // generic mic when there's nothing at all.
    if (agentName && agentName.length > 0) {
      return (
        <div
          className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
          style={{ backgroundColor: "#6b7280" }}
        >
          {agentName[0].toUpperCase()}
        </div>
      );
    }
    return (
      <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0 flex items-center justify-center">
        <Mic className="w-3.5 h-3.5 text-gray-400" />
      </div>
    );
  }
  // Photo avatars get a 2px ring in the agent's persona color so the color is
  // a consistent identity cue even when the face is the same size as others.
  if (meta.avatar) {
    return (
      <img
        src={meta.avatar}
        alt={meta.label}
        className="w-7 h-7 rounded-full shrink-0 object-cover border-2"
        style={{ borderColor: meta.color }}
      />
    );
  }
  // No photo (e.g. Rex) → a solid persona-colored circle with the initial.
  return (
    <div
      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
      style={{ backgroundColor: meta.color }}
    >
      {meta.label[0]}
    </div>
  );
}

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <p
      className={`text-sm text-[#555] leading-relaxed ${expanded ? "" : "line-clamp-3"} cursor-pointer`}
      onClick={(e) => {
        e.stopPropagation();
        setExpanded(!expanded);
      }}
    >
      {text}
    </p>
  );
}

function AutoplayToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>Auto-play</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Auto-play new voice messages"
        onClick={() => onChange(!enabled)}
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
          enabled ? "border-green-600 bg-green-600" : "border-border bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-[1px] h-[10px] w-[10px] rounded-full bg-background transition-transform",
            enabled ? "translate-x-[15px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </label>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function groupByDay(samples: VoiceSample[]) {
  const groups: Record<string, VoiceSample[]> = {};
  for (const s of samples) {
    const d = new Date(s.created_at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let label: string;
    if (d.toDateString() === today.toDateString()) label = "TODAY";
    else if (d.toDateString() === yesterday.toDateString()) label = "YESTERDAY";
    else
      label = d
        .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        .toUpperCase();
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  }
  return groups;
}

export function VoicePanelToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Open voice feed"
      onClick={onClick}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <MessageCircle className="h-[18px] w-[18px]" />
    </button>
  );
}

/**
 * Width-agnostic body of the voice feed (header + timeline). Used both by
 * `VoicePanel` (desktop 400px column) and by the mobile `<Sheet>` in
 * MobileTopBar (full-width). Parent owns the width / overlay chrome; this
 * component just fills its container with `flex h-full`.
 */
export function VoiceFeedBody({ onClose }: { onClose: () => void }) {
  const { samples, settings, updateSettings } = useVoiceChannel();
  const grouped = groupByDay(samples);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2
            className="text-sm font-semibold text-[#1a1a1a]"
            style={{ fontFamily: '"SF Pro Rounded", "Nunito", system-ui, sans-serif' }}
          >
            Voice Feed
          </h2>
          <p className="text-xs text-[#666]">
            🎙️ {samples.length} message{samples.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoplayToggle
            enabled={!!settings.voice_autoplay}
            onChange={(v) => updateSettings({ voice_autoplay: v })}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close voice feed"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {samples.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">🎙️</div>
            <p className="text-sm text-[#999]">No voice messages yet</p>
            <p className="text-xs text-[#bbb] mt-1">Your agents&apos; voice messages will appear here</p>
          </div>
        ) : (
          Object.entries(grouped).map(([label, msgs]) => (
            <div key={label}>
              <div className="py-3">
                <span className="text-xs font-semibold text-[#999] tracking-wider">{label}</span>
              </div>
              <div className="space-y-px">
                {msgs.map((sample) => {
                  const agentKey = (sample.agent_name || "").toLowerCase();
                  const meta = agentKey ? AGENT_META[agentKey] : null;
                  // Display label: prefer the curated label, fall back to
                  // the capitalized raw agent_name. Never silently hide a
                  // legitimate sender just because they're not in the lookup.
                  const labelText = meta?.label ?? (sample.agent_name ? capitalize(sample.agent_name) : null);
                  return (
                    <div
                      key={sample.id}
                      className="py-3.5 px-3 -mx-3 rounded-xl hover:bg-black/[0.02] transition-colors group space-y-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <AgentAvatar agentName={sample.agent_name} />
                        {labelText && (
                          <span
                            className="text-sm font-semibold"
                            style={{ color: agentColor(sample.agent_name) }}
                          >
                            {labelText}
                          </span>
                        )}
                        <span className="text-[10px] text-[#999] tabular-nums">
                          {formatTime(sample.created_at)}
                        </span>
                        <div className="flex items-center gap-0.5 ml-auto transition-opacity opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(sample.text_content);
                            }}
                            className="p-1 rounded-md hover:bg-black/5 text-[#999] hover:text-[#666] transition-colors"
                            title="Copy text"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {sample.audio_url ? (
                            <a
                              href={sample.audio_url}
                              download
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 rounded-md hover:bg-black/5 text-[#999] hover:text-[#666] transition-colors"
                              title="Download audio"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <ExpandableText text={sample.text_content} />
                      {sample.audio_url ? (
                        <VoicePlayerInline audioUrl={sample.audio_url} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function VoicePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <aside
      aria-hidden={!open}
      className={cn(
        "shrink-0 overflow-hidden border-s bg-white transition-[width] duration-200 ease-out",
        open ? "w-[400px]" : "w-0",
      )}
    >
      <div className="w-[400px] h-full">
        <VoiceFeedBody onClose={onClose} />
      </div>
    </aside>
  );
}
