import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search, TrendingUp } from "lucide-react";
import { useApi } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

type InvestChannel = {
  id: string; name: string; handle: string;
  style: string | null; jurisdiction: string | null;
  on_roster: number; notes: string | null;
};
type InvestVideo = {
  id: string; channel_id: string; title: string; url: string;
  views: number | null; duration_s: number | null; upload_date: string | null;
  words: number | null; transcript_source: string | null; summary_md: string | null;
  claims_total: number; claims_validated: number; claims_quarantined: number;
  processed_at: string | null;
};
type InvestClaim = {
  id: number; video_id: string; claim: string; type: string; stance: string;
  quote: string | null; jurisdiction: string | null; validated: number;
};
type InvestResponse = { channels: InvestChannel[]; videos: InvestVideo[]; claims: InvestClaim[] };

type VideoMeta = InvestVideo;

type ClaimRow = {
  claim: InvestClaim;
  video: InvestVideo | undefined;
  channel: InvestChannel | undefined;
};

type ChannelAggregate = {
  videos: InvestVideo[];
  claimsTotal: number;
  claimsValidated: number;
  predictionCount: number;
  ownedPredictionCount: number;
  stanceCounts: Map<string, number>;
};

const CLAIM_TYPES = ["fact", "recommendation", "prediction", "opinion", "numeric", "warning"] as const;
const STANCE_ORDER = ["asserts", "reports_other", "hypothetical"] as const;
const STANCE_COLOR: Record<string, string> = {
  asserts: "#2563eb",
  reports_other: "#d97706",
  hypothetical: "#7c3aed",
};

function compactNumber(value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function integerNumber(value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function labelize(value: string): string {
  return value.replace(/_/g, " ");
}

function capitalize(value: string): string {
  if (value.length === 0) return "-";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stanceColor(stance: string): string {
  return STANCE_COLOR[stance] ?? T.ink3;
}

function formatDate(value: string | null): string {
  if (value == null) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function formatDuration(value: number | null): string {
  if (value == null) return "-";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderBold(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    const start = text.indexOf("**", cursor);
    if (start === -1) {
      nodes.push(text.slice(cursor));
      break;
    }

    if (start > cursor) nodes.push(text.slice(cursor, start));
    const end = text.indexOf("**", start + 2);
    if (end === -1) {
      nodes.push(text.slice(start));
      break;
    }

    nodes.push(<strong key={`bold-${key++}`}>{text.slice(start + 2, end)}</strong>);
    cursor = end + 2;
  }

  return nodes;
}

function renderTinyMarkdown(markdown: string): React.ReactNode {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) return null;

  return paragraphs.map((paragraph, index) => (
    <p key={`${index}:${paragraph.slice(0, 16)}`} style={{ margin: index === 0 ? "0 0 10px" : "10px 0", lineHeight: 1.65 }}>
      {renderBold(paragraph)}
    </p>
  ));
}

function Badge({ text, fg, bg, bd }: { text: string; fg: string; bg: string; bd: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        color: fg,
        background: bg,
        border: `1px solid ${bd}`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div
      style={{
        flex: "1 1 150px",
        minWidth: 150,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        background: T.white,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, marginTop: 5, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 style={{ color: T.ink, fontSize: 17, fontWeight: 800, margin: "0 0 12px" }}>
      {title}
    </h2>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 150, flex: "1 1 150px" }}>
      <span style={{ color: T.ink3, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: `1px solid ${T.line}`,
          background: T.white,
          color: T.ink,
          borderRadius: 8,
          padding: "9px 10px",
          fontSize: 13,
          minWidth: 0,
        }}
      >
        {children}
      </select>
    </label>
  );
}

function StancePill({ stance }: { stance: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: T.ink2, fontSize: 13 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: stanceColor(stance), flex: "0 0 auto" }} />
      <span>{labelize(stance)}</span>
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return <Badge text={capitalize(type)} fg={T.ink2} bg={T.bg2} bd={T.line} />;
}

function rosterBadge(channel: InvestChannel): React.ReactNode {
  if (channel.on_roster) return <Badge text="On roster" fg={T.green} bg={T.greenSoft} bd={T.green} />;
  return <Badge text="Off-roster test" fg={T.ink3} bg={T.bg2} bd={T.line} />;
}

function buildChannelAggregate(channel: InvestChannel, videos: InvestVideo[], claims: InvestClaim[], videoById: Map<string, VideoMeta>): ChannelAggregate {
  const channelVideos = videos.filter((video) => video.channel_id === channel.id);
  const videoIds = new Set(channelVideos.map((video) => video.id));
  const stanceCounts = new Map<string, number>();
  let predictionCount = 0;
  let ownedPredictionCount = 0;

  for (const claim of claims) {
    const video = videoById.get(claim.video_id);
    if (video === undefined || video.channel_id !== channel.id || !videoIds.has(video.id)) continue;
    stanceCounts.set(claim.stance, (stanceCounts.get(claim.stance) ?? 0) + 1);
    if (claim.type === "prediction") {
      predictionCount += 1;
      if (claim.stance === "asserts") ownedPredictionCount += 1;
    }
  }

  return {
    videos: channelVideos,
    claimsTotal: channelVideos.reduce((sum, video) => sum + video.claims_total, 0),
    claimsValidated: channelVideos.reduce((sum, video) => sum + video.claims_validated, 0),
    predictionCount,
    ownedPredictionCount,
    stanceCounts,
  };
}

function stanceEntries(stanceCounts: Map<string, number>): Array<[string, number]> {
  const known = STANCE_ORDER.map((stance) => [stance, stanceCounts.get(stance) ?? 0] as [string, number]).filter(([, count]) => count > 0);
  const unknownTotal = Array.from(stanceCounts.entries())
    .filter(([stance]) => !STANCE_ORDER.includes(stance as (typeof STANCE_ORDER)[number]))
    .reduce((sum, [, count]) => sum + count, 0);
  return unknownTotal > 0 ? [...known, ["other", unknownTotal]] : known;
}

function AdvisorCard({
  channel,
  aggregate,
  isMobile,
}: {
  channel: InvestChannel;
  aggregate: ChannelAggregate;
  isMobile: boolean;
}) {
  const entries = stanceEntries(aggregate.stanceCounts);
  const stanceTotal = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div
      style={{
        flex: isMobile ? "1 1 100%" : "1 1 300px",
        minWidth: 0,
        border: `1px solid ${T.line}`,
        borderRadius: 12,
        background: T.white,
        padding: "16px 16px 15px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: T.ink, fontWeight: 800, fontSize: 15, overflowWrap: "anywhere", wordBreak: "break-word" }}>
            {channel.name}
          </div>
          <div style={{ color: T.ink2, fontSize: 12, marginTop: 3, overflowWrap: "anywhere", wordBreak: "break-word" }}>
            {channel.style ?? "-"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flex: "0 0 auto" }}>
          <Badge text={channel.jurisdiction ?? "-"} fg={T.ink3} bg={T.bg2} bd={T.line} />
          {rosterBadge(channel)}
        </div>
      </div>

      <div style={{ color: T.ink2, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
        {aggregate.videos.length} videos processed · {integerNumber(aggregate.claimsTotal)} total claims ·{" "}
        {percent(aggregate.claimsValidated, aggregate.claimsTotal)} validated
      </div>

      <div style={{ color: T.ink3, fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 7 }}>
        Stance profile
      </div>
      <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: T.bg2, marginBottom: 9 }}>
        {stanceTotal === 0 ? (
          <div style={{ width: "100%", background: T.bg2 }} />
        ) : (
          entries.map(([stance, count], index) => (
            <div
              key={`${channel.id}:${stance}`}
              style={{
                width: `${(count / stanceTotal) * 100}%`,
                background: stance === "other" ? T.ink3 : stanceColor(stance),
                borderRight: index === entries.length - 1 ? undefined : `2px solid ${T.white}`,
              }}
            />
          ))
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 12px", marginBottom: 12 }}>
        {entries.length === 0 ? (
          <span style={{ color: T.ink3, fontSize: 12 }}>No claims yet</span>
        ) : (
          entries.map(([stance, count]) => (
            <span key={`${channel.id}:${stance}:legend`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.ink2, fontSize: 12 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: stance === "other" ? T.ink3 : stanceColor(stance),
                  flex: "0 0 auto",
                }}
              />
              <span>
                {labelize(stance)} {count}
              </span>
            </span>
          ))
        )}
      </div>

      <div style={{ color: T.ink, fontSize: 14, fontWeight: 800, marginBottom: channel.notes ? 8 : 0 }}>
        {aggregate.predictionCount === 0
          ? "Predictions owned: — (no predictions yet)"
          : `Predictions owned: ${aggregate.ownedPredictionCount} of ${aggregate.predictionCount}`}
      </div>
      {channel.notes ? (
        <div style={{ color: T.ink3, fontSize: 12, lineHeight: 1.55, overflowWrap: "anywhere", wordBreak: "break-word" }}>
          {channel.notes}
        </div>
      ) : null}
    </div>
  );
}

function ClaimText({ claim }: { claim: InvestClaim }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: T.ink, fontSize: 13.5, fontWeight: 700, lineHeight: 1.45, overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {claim.claim}
      </div>
      {claim.quote ? (
        <div
          style={{
            color: T.ink3,
            fontSize: 12,
            fontStyle: "italic",
            lineHeight: 1.5,
            marginTop: 5,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          “{claim.quote}
        </div>
      ) : null}
    </div>
  );
}

function VideoLink({ video }: { video: InvestVideo | undefined }) {
  if (video === undefined) return <span style={{ color: T.ink3 }}>-</span>;
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noreferrer"
      style={{
        color: T.accent,
        fontSize: 13,
        fontWeight: 700,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minWidth: 0,
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      <span>{video.title}</span>
      <ExternalLink style={{ width: 13, height: 13, flex: "0 0 auto" }} />
    </a>
  );
}

function ValidationMark({ validated }: { validated: number }) {
  if (validated) return <span style={{ color: T.green, fontSize: 14, fontWeight: 900 }}>✓</span>;
  return <span style={{ color: T.amber, fontSize: 12, fontWeight: 800 }}>quarantined</span>;
}

function ClaimRowDesktop({ row }: { row: ClaimRow }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(260px, 2.1fr) 118px 135px 150px minmax(170px, 1.2fr) 96px",
        gap: 12,
        alignItems: "start",
        padding: "13px 16px",
        borderBottom: `1px solid ${T.line}`,
        background: T.white,
      }}
    >
      <ClaimText claim={row.claim} />
      <TypeBadge type={row.claim.type} />
      <StancePill stance={row.claim.stance} />
      <span style={{ color: T.ink2, fontSize: 13, overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {row.channel?.name ?? "-"}
      </span>
      <VideoLink video={row.video} />
      <ValidationMark validated={row.claim.validated} />
    </div>
  );
}

function ClaimMobileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: T.ink3, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function ClaimRowMobile({ row }: { row: ClaimRow }) {
  return (
    <div style={{ padding: 14, borderBottom: `1px solid ${T.line}`, background: T.white }}>
      <ClaimMobileField label="Claim">
        <ClaimText claim={row.claim} />
      </ClaimMobileField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 13 }}>
        <ClaimMobileField label="Type">
          <TypeBadge type={row.claim.type} />
        </ClaimMobileField>
        <ClaimMobileField label="Stance">
          <StancePill stance={row.claim.stance} />
        </ClaimMobileField>
        <ClaimMobileField label="Advisor">
          <span style={{ color: T.ink2, fontSize: 13, overflowWrap: "anywhere", wordBreak: "break-word" }}>
            {row.channel?.name ?? "-"}
          </span>
        </ClaimMobileField>
        <ClaimMobileField label="Status">
          <ValidationMark validated={row.claim.validated} />
        </ClaimMobileField>
      </div>
      <div style={{ marginTop: 13 }}>
        <ClaimMobileField label="Video">
          <VideoLink video={row.video} />
        </ClaimMobileField>
      </div>
    </div>
  );
}

function VideoDetails({ video }: { video: InvestVideo }) {
  return (
    <details
      key={video.id}
      style={{
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        background: T.white,
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "12px 14px",
          color: T.ink,
          fontSize: 13.5,
          fontWeight: 800,
          lineHeight: 1.5,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {video.title} · {compactNumber(video.views)} views · {video.claims_validated}/{video.claims_total}
        {video.words == null ? "" : ` · ${integerNumber(video.words)} words`}
      </summary>
      <div style={{ padding: "0 14px 14px", color: T.ink2, fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", color: T.ink3, fontSize: 12, marginBottom: 10 }}>
          <span>Uploaded {formatDate(video.upload_date)}</span>
          <span>Duration {formatDuration(video.duration_s)}</span>
        </div>
        {video.summary_md ? (
          <div style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{renderTinyMarkdown(video.summary_md)}</div>
        ) : (
          <div style={{ color: T.ink3, marginBottom: 10 }}>No summary yet.</div>
        )}
        <a
          href={video.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: T.accent, fontWeight: 800, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          Watch on YouTube
          <ExternalLink style={{ width: 13, height: 13 }} />
        </a>
      </div>
    </details>
  );
}

export function InvestPage() {
  const api = useApi();
  const isMobile = useIsMobile();
  const [data, setData] = useState<InvestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [advisorFilter, setAdvisorFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stanceFilter, setStanceFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/invest");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as InvestResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invest");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const channels = data?.channels ?? [];
  const videos = data?.videos ?? [];
  const claims = data?.claims ?? [];

  const videoById = useMemo(() => {
    const map = new Map<string, VideoMeta>();
    for (const video of videos) {
      map.set(video.id, video);
    }
    return map;
  }, [videos]);

  const channelById = useMemo(() => {
    const map = new Map<string, InvestChannel>();
    for (const channel of channels) map.set(channel.id, channel);
    return map;
  }, [channels]);

  const claimRows = useMemo<ClaimRow[]>(() => {
    return claims.map((claim) => {
      const video = videoById.get(claim.video_id);
      const channel = video === undefined ? undefined : channelById.get(video.channel_id);
      return { claim, video, channel };
    });
  }, [claims, channelById, videoById]);

  const channelAggregates = useMemo(() => {
    const map = new Map<string, ChannelAggregate>();
    for (const channel of channels) {
      map.set(channel.id, buildChannelAggregate(channel, videos, claims, videoById));
    }
    return map;
  }, [channels, claims, videoById, videos]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return claimRows.filter((row) => {
      if (advisorFilter !== "all" && row.channel?.id !== advisorFilter) return false;
      if (typeFilter !== "all" && row.claim.type !== typeFilter) return false;
      if (stanceFilter !== "all" && row.claim.stance !== stanceFilter) return false;
      if (q.length === 0) return true;
      return row.claim.claim.toLowerCase().includes(q) || (row.claim.quote ?? "").toLowerCase().includes(q);
    });
  }, [advisorFilter, claimRows, search, stanceFilter, typeFilter]);

  const totals = useMemo(() => {
    const totalClaims = videos.reduce((sum, video) => sum + video.claims_total, 0);
    const validatedClaims = videos.reduce((sum, video) => sum + video.claims_validated, 0);
    const predictionClaims = claims.filter((claim) => claim.type === "prediction");
    const ownedPredictions = predictionClaims.filter((claim) => claim.stance === "asserts").length;
    return {
      totalClaims,
      validatedClaims,
      predictionClaims: predictionClaims.length,
      ownedPredictions,
    };
  }, [claims, videos]);

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        boxSizing: "border-box",
        padding: isMobile ? "20px 14px 60px" : "36px 44px 80px",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, marginBottom: 8, textTransform: "uppercase" }}>
            My Dashboard · Research
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <h1
                style={{
                  fontSize: isMobile ? 24 : 32,
                  fontWeight: 800,
                  color: T.ink,
                  margin: 0,
                  letterSpacing: "-0.02em",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <TrendingUp style={{ width: isMobile ? 22 : 28, height: isMobile ? 22 : 28, color: T.skyDark }} />
                Invest — Advisor Corpus
              </h1>
              <p style={{ color: T.ink2, fontSize: 14, lineHeight: 1.55, margin: "9px 0 0", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                What investment YouTubers actually claim — extracted, quote-verified, stance-tagged.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: `1px solid ${T.line}`,
                background: T.white,
                color: T.ink2,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: loading ? "default" : "pointer",
                flex: "0 0 auto",
              }}
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ padding: "16px 20px", color: T.red, background: T.redSoft, border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        ) : null}

        {data === null ? (
          <div style={{ padding: 20, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading…
          </div>
        ) : channels.length === 0 ? (
          <div
            style={{
              border: `1px solid ${T.line}`,
              borderRadius: 12,
              background: T.white,
              padding: isMobile ? "42px 18px" : "58px 24px",
              textAlign: "center",
              color: T.ink2,
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            Corpus is empty — run the pipeline and push.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
              <StatTile label="Advisors" value={channels.length} accent={T.ink} />
              <StatTile label="Videos" value={videos.length} accent={T.skyDark} />
              <StatTile label="Claims" value={`${integerNumber(totals.validatedClaims)} / ${integerNumber(totals.totalClaims)}`} accent={T.ink} />
              <StatTile label="Validation rate" value={percent(totals.validatedClaims, totals.totalClaims)} accent={T.green} />
              <StatTile label="Owned predictions" value={`${totals.ownedPredictions} / ${totals.predictionClaims}`} accent={T.plum} />
            </div>

            <section style={{ marginBottom: 26 }}>
              <SectionTitle title="Advisor stance profiles" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                {channels.map((channel) => (
                  <AdvisorCard
                    key={channel.id}
                    channel={channel}
                    aggregate={channelAggregates.get(channel.id) ?? buildChannelAggregate(channel, videos, claims, videoById)}
                    isMobile={isMobile}
                  />
                ))}
              </div>
            </section>

            <section style={{ marginBottom: 28 }}>
              <SectionTitle title="Claims explorer" />
              <div
                style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 12,
                  background: T.white,
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: 14, borderBottom: `1px solid ${T.line}`, background: T.bg2 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
                    <SelectField label="Advisor" value={advisorFilter} onChange={setAdvisorFilter}>
                      <option value="all">All advisors</option>
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField label="Type" value={typeFilter} onChange={setTypeFilter}>
                      <option value="all">All types</option>
                      {CLAIM_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {capitalize(type)}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField label="Stance" value={stanceFilter} onChange={setStanceFilter}>
                      <option value="all">All stances</option>
                      {STANCE_ORDER.map((stance) => (
                        <option key={stance} value={stance}>
                          {labelize(stance)}
                        </option>
                      ))}
                    </SelectField>
                    <label style={{ display: "grid", gap: 5, minWidth: 220, flex: "2 1 220px" }}>
                      <span style={{ color: T.ink3, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        Search
                      </span>
                      <span style={{ position: "relative", display: "block" }}>
                        <Search style={{ position: "absolute", left: 10, top: 10, width: 14, height: 14, color: T.ink3 }} />
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search claims + quotes"
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            border: `1px solid ${T.line}`,
                            background: T.white,
                            color: T.ink,
                            borderRadius: 8,
                            padding: "9px 10px 9px 31px",
                            fontSize: 13,
                            minWidth: 0,
                          }}
                        />
                      </span>
                    </label>
                  </div>
                </div>

                {!isMobile && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(260px, 2.1fr) 118px 135px 150px minmax(170px, 1.2fr) 96px",
                      gap: 12,
                      padding: "11px 16px",
                      borderBottom: `1px solid ${T.line}`,
                      background: T.bg2,
                      color: T.ink3,
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    <span>Claim</span>
                    <span>Type</span>
                    <span>Stance</span>
                    <span>Advisor</span>
                    <span>Video</span>
                    <span>✓</span>
                  </div>
                )}

                {filteredRows.length === 0 ? (
                  <div style={{ padding: 24, color: T.ink3, fontSize: 14 }}>No claims match these filters.</div>
                ) : isMobile ? (
                  filteredRows.map((row) => <ClaimRowMobile key={row.claim.id} row={row} />)
                ) : (
                  filteredRows.map((row) => <ClaimRowDesktop key={row.claim.id} row={row} />)
                )}
                <div style={{ padding: "11px 16px", color: T.ink3, fontSize: 12, fontWeight: 700, background: T.bg2 }}>
                  Showing {filteredRows.length} of {claims.length} claims
                </div>
              </div>
            </section>

            <section>
              <SectionTitle title="Video summaries" />
              <div style={{ display: "grid", gap: 16 }}>
                {channels.map((channel) => {
                  const channelVideos = videos.filter((video) => video.channel_id === channel.id);
                  if (channelVideos.length === 0) return null;
                  return (
                    <div key={`${channel.id}:videos`} style={{ display: "grid", gap: 8 }}>
                      <h3 style={{ color: T.ink, fontSize: 15, fontWeight: 800, margin: "4px 0 2px", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {channel.name}
                      </h3>
                      {channelVideos.map((video) => (
                        <VideoDetails key={video.id} video={video} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

(InvestPage as unknown as { path: string }).path = "/invest";
