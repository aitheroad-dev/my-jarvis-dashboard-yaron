import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CreditCard, Loader2, RefreshCw, Wallet } from "lucide-react";
import { useApi } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

type ConnectionStatus = "connected" | "degraded" | "no-cred" | "no-api";
type StatusFilter = "all" | ConnectionStatus;

type SpendService = {
  key: string;
  vendor: string | null;
  product: string | null;
  category: string | null;
  scope: string | null;
  plan_type: string | null;
  billing_model: string | null;
  est_monthly_eur: number | null;
  currency_hint: string | null;
  usage_source: string | null;
  billing_source: string | null;
  connection_status: string | null;
  connection_detail: string | null;
  active: boolean;
};

type SpendCharge = {
  id: string;
  service_key: string | null;
  date: string | null;
  amount: number | null;
  currency: string | null;
  source: string | null;
  period: string | null;
  payee_raw: string | null;
  confidence: string | null;
};

type SpendAlert = {
  id: string;
  type: string | null;
  severity: string | null;
  service_key: string | null;
  detail: string | null;
  period: string | null;
  acknowledged: boolean;
};

type SpendTotal = {
  period: string;
  eur_total: number | null;
  usd_total: number | null;
  captured_at: string | null;
};

type SpendSummary = {
  currentPeriod: string;
  eurMonthly: number;
  usdMonthly: number;
  byConnectionStatus: Record<ConnectionStatus, number>;
  unpaidInvoiceCount: number;
  lastSync: string;
};

type SpendResponse = {
  services: SpendService[];
  charges: SpendCharge[];
  alerts: SpendAlert[];
  totals: SpendTotal[];
  summary: SpendSummary;
};

const STATUSES: ConnectionStatus[] = ["connected", "degraded", "no-cred", "no-api"];

function euro(v: number | null): string {
  if (v == null) return "-";
  return "€" + Math.round(v).toLocaleString("nl-NL");
}

function usd(v: number | null): string {
  if (v == null) return "-";
  return "$" + Math.round(v).toLocaleString("en-US");
}

function nativeMoney(v: number | null, currency: string | null): string {
  if (v == null) return "-";
  const normalized = (currency ?? "EUR").toUpperCase();
  if (normalized === "EUR") return euro(v);
  if (normalized === "USD") return usd(v);
  return `${normalized} ${Math.round(v).toLocaleString("nl-NL")}`;
}

function lastSyncText(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: string | null): string {
  if (status === "no-cred") return "No cred";
  if (status === "no-api") return "No API";
  return status ?? "Unknown";
}

function serviceTitle(s: SpendService): string {
  return s.vendor?.trim() || s.product?.trim() || s.key;
}

function Badge({ text, fg, bg, bd }: { text: string; fg: string; bg: string; bd: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        color: fg,
        background: bg,
        border: `1px solid ${bd}`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
        textTransform: "capitalize",
      }}
    >
      {text}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "connected") return <Badge text="Connected" fg={T.green} bg={T.greenSoft} bd={T.green} />;
  if (status === "degraded") return <Badge text="Degraded" fg={T.amber} bg={T.amberSoft} bd={T.amber} />;
  if (status === "no-cred") return <Badge text="No cred" fg={T.red} bg={T.redSoft} bd={T.red} />;
  return <Badge text={statusLabel(status)} fg={T.ink3} bg={T.bg2} bd={T.line} />;
}

function SummaryCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 120,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        background: T.white,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, marginTop: 4, letterSpacing: "0.02em" }}>
        {label}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? T.skyDark : T.line}`,
        background: active ? T.skySoft : T.white,
        color: active ? T.skyDark : T.ink2,
        borderRadius: 999,
        padding: "6px 14px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ListingRow({
  service,
  lastCharge,
  isMobile,
}: {
  service: SpendService;
  lastCharge: string | null;
  isMobile: boolean;
}) {
  if (isMobile) {
    return (
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.line}`, background: T.white }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div style={{ color: T.ink, fontWeight: 700, fontSize: 14, lineHeight: 1.35, wordBreak: "break-word" }}>
            {serviceTitle(service)}
          </div>
          <div style={{ fontWeight: 800, color: T.ink, whiteSpace: "nowrap" }}>
            {nativeMoney(service.est_monthly_eur, service.currency_hint)}
          </div>
        </div>
        <div style={{ color: T.ink2, fontSize: 12, marginTop: 4 }}>
          {service.plan_type ?? "-"} · {service.category ?? "-"} · {service.scope ?? "-"}
        </div>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <StatusBadge status={service.connection_status} />
          <span style={{ color: T.ink3, fontSize: 11, fontWeight: 700 }}>{lastCharge ?? "-"}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(160px, 1.4fr) 100px minmax(110px, 1fr) 90px 105px 95px",
        gap: 12,
        alignItems: "center",
        padding: "12px 18px",
        borderBottom: `1px solid ${T.line}`,
        background: T.white,
      }}
    >
      <span style={{ color: T.ink, fontWeight: 700, fontSize: 13.5, wordBreak: "break-word" }}>
        {serviceTitle(service)}
      </span>
      <span style={{ color: T.ink2, fontSize: 13 }}>{service.plan_type ?? "-"}</span>
      <span style={{ color: T.ink2, fontSize: 13 }}>{service.category ?? "-"}</span>
      <span style={{ color: T.ink2, fontSize: 13 }}>{service.scope ?? "-"}</span>
      <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>
        {nativeMoney(service.est_monthly_eur, service.currency_hint)}
      </span>
      <span style={{ color: T.ink3, fontSize: 12, fontWeight: 700 }}>{lastCharge ?? "-"}</span>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ color: T.skyDark, display: "inline-flex" }}>{icon}</span>
      <h2 style={{ color: T.ink, fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h2>
    </div>
  );
}

export function SpendPage() {
  const api = useApi();
  const isMobile = useIsMobile();
  const [data, setData] = useState<SpendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/spend");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SpendResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load spend");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const services = data?.services ?? [];
  const alerts = data?.alerts ?? [];
  const totals = data?.totals ?? [];
  const s = data?.summary;
  const lastChargeByService = useMemo(() => {
    const byService = new Map<string, string>();
    for (const charge of data?.charges ?? []) {
      if (charge.service_key === null || charge.date === null) continue;
      const existing = byService.get(charge.service_key);
      if (existing === undefined || charge.date > existing) {
        byService.set(charge.service_key, charge.date);
      }
    }
    return byService;
  }, [data?.charges]);

  const filteredServices = services.filter((service) => {
    if (statusFilter === "all") return true;
    return service.connection_status === statusFilter;
  });
  const unpaidAlerts = alerts.filter((alert) => alert.type === "unpaid_invoice");
  const changeAlerts = alerts.filter(
    (alert) => alert.type === "new_charge" || alert.type === "price_change" || alert.type === "free_to_paid",
  );

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        boxSizing: "border-box",
        padding: isMobile ? "20px 14px 60px" : "36px 44px 80px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, marginBottom: 8 }}>
            PAI SPEND
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: "-0.02em" }}>
              Spend mirror
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: T.ink3, fontWeight: 600 }}>
                Updated {s ? lastSyncText(s.lastSync) : "-"}
              </span>
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
                }}
              >
                <RefreshCw className={loading ? "animate-spin" : undefined} style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
          <SummaryCard label={`${s?.currentPeriod ?? "CURRENT"} EUR`} value={s ? euro(s.eurMonthly) : "-"} accent={T.ink} />
          <SummaryCard label={`${s?.currentPeriod ?? "CURRENT"} USD`} value={s ? usd(s.usdMonthly) : "-"} accent={T.skyDark} />
          <SummaryCard label="UNPAID" value={s?.unpaidInvoiceCount ?? "-"} accent={T.red} />
          <SummaryCard label="CONNECTED" value={s?.byConnectionStatus.connected ?? "-"} accent={T.green} />
          <SummaryCard label="NEEDS ATTENTION" value={(s?.byConnectionStatus.degraded ?? 0) + (s?.byConnectionStatus["no-cred"] ?? 0)} accent={T.amber} />
        </div>

        {error ? (
          <div style={{ padding: "16px 20px", color: T.red, background: T.redSoft, border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        ) : null}

        <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.line}`, background: T.bg2 }}>
            <SectionTitle icon={<Wallet style={{ width: 16, height: 16 }} />} title="Connection matrix" />
          </div>
          {data === null ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading...
            </div>
          ) : services.length === 0 ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3 }}>No spend services yet.</div>
          ) : (
            STATUSES.map((status) => {
              const rows = services.filter((service) => service.connection_status === status);
              return (
                <div key={status} style={{ borderBottom: `1px solid ${T.line}` }}>
                  <div style={{ padding: "10px 16px", background: T.white, display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusBadge status={status} />
                    <span style={{ color: T.ink3, fontSize: 12, fontWeight: 700 }}>{rows.length}</span>
                  </div>
                  {rows.length === 0 ? (
                    <div style={{ padding: "0 16px 12px", color: T.ink3, fontSize: 13 }}>No services.</div>
                  ) : (
                    rows.map((service) => (
                      <div
                        key={service.key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: isMobile ? "1fr" : "minmax(150px, 1fr) 120px 120px minmax(220px, 1.4fr)",
                          gap: isMobile ? 4 : 12,
                          padding: "10px 16px",
                          borderTop: `1px solid ${T.line}`,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>{serviceTitle(service)}</span>
                        <span style={{ color: T.ink2, fontSize: 13 }}>{service.category ?? "-"}</span>
                        <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>
                          {nativeMoney(service.est_monthly_eur, service.currency_hint)}
                        </span>
                        <span style={{ color: T.ink3, fontSize: 12 }}>{service.connection_detail ?? "-"}</span>
                      </div>
                    ))
                  )}
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
          <FilterChip label={`All${s ? ` (${services.length})` : ""}`} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          {STATUSES.map((status) => (
            <FilterChip
              key={status}
              label={`${statusLabel(status)}${s ? ` (${s.byConnectionStatus[status]})` : ""}`}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            />
          ))}
        </div>

        <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, overflow: "hidden", marginBottom: 24 }}>
          {!isMobile && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(160px, 1.4fr) 100px minmax(110px, 1fr) 90px 105px 95px",
                gap: 12,
                padding: "11px 18px",
                borderBottom: `1px solid ${T.line}`,
                background: T.bg2,
                fontSize: 11,
                fontWeight: 700,
                color: T.ink3,
                letterSpacing: "0.03em",
              }}
            >
              <span>SERVICE</span>
              <span>PLAN</span>
              <span>CATEGORY</span>
              <span>SCOPE</span>
              <span>MONTHLY</span>
              <span>LAST CHARGE</span>
            </div>
          )}

          {data === null ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading...
            </div>
          ) : filteredServices.length === 0 ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3 }}>No services for this filter.</div>
          ) : (
            filteredServices.map((service) => (
              <ListingRow
                key={service.key}
                service={service}
                lastCharge={lastChargeByService.get(service.key) ?? null}
                isMobile={isMobile}
              />
            ))
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.line}`, background: T.bg2 }}>
              <SectionTitle icon={<AlertTriangle style={{ width: 16, height: 16 }} />} title="Unpaid / forgotten" />
            </div>
            {data === null ? (
              <div style={{ padding: 20, fontSize: 14, color: T.ink3 }}>Loading...</div>
            ) : unpaidAlerts.length === 0 ? (
              <div style={{ padding: 20, fontSize: 14, color: T.ink3 }}>No unpaid invoices.</div>
            ) : (
              unpaidAlerts.map((alert) => (
                <div key={alert.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${T.line}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>{alert.service_key ?? "unknown"}</span>
                    <Badge text={alert.severity ?? "alert"} fg={T.red} bg={T.redSoft} bd={T.red} />
                  </div>
                  <div style={{ color: T.ink2, fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{alert.detail ?? "-"}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.line}`, background: T.bg2 }}>
              <SectionTitle icon={<CreditCard style={{ width: 16, height: 16 }} />} title="Changes feed" />
            </div>
            {data === null ? (
              <div style={{ padding: 20, fontSize: 14, color: T.ink3 }}>Loading...</div>
            ) : changeAlerts.length === 0 ? (
              <div style={{ padding: 20, fontSize: 14, color: T.ink3 }}>No change alerts.</div>
            ) : (
              changeAlerts.map((alert) => (
                <div key={alert.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${T.line}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>{alert.type ?? "change"}</span>
                    <span style={{ color: T.ink3, fontSize: 12, fontWeight: 700 }}>{alert.period ?? "-"}</span>
                  </div>
                  <div style={{ color: T.ink2, fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{alert.detail ?? "-"}</div>
                </div>
              ))
            )}
            <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.line}`, background: T.bg2 }}>
              <div style={{ color: T.ink, fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Monthly totals</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 90px",
                  gap: 10,
                  color: T.ink3,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  marginBottom: 6,
                }}
              >
                <span>PERIOD</span>
                <span>EUR</span>
                <span>USD</span>
              </div>
              {totals.length === 0 ? (
                <div style={{ color: T.ink3, fontSize: 13 }}>No totals history.</div>
              ) : (
                totals.map((total) => (
                  <div
                    key={total.period}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 90px 90px",
                      gap: 10,
                      padding: "6px 0",
                      borderTop: `1px solid ${T.line}`,
                      color: T.ink2,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: 700, color: T.ink }}>{total.period}</span>
                    <span>{euro(total.eur_total)}</span>
                    <span>{usd(total.usd_total)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: T.ink3 }}>
          Showing {filteredServices.length} of {services.length} active spend services.
        </div>
      </div>
    </div>
  );
}

(SpendPage as unknown as { path: string }).path = "/spend";
