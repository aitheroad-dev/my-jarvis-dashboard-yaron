import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// Read-only mirror of the Mac-local pai-spend SQLite DB. The Mac pushes rows
// into the spend_* D1 tables; this endpoint only serves the current mirror.
// Charges are capped to the 500 most recent rows to keep the dashboard payload bounded.

type SpendServiceRow = {
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
  active: number;
  synced_at: string;
};

type SpendChargeRow = {
  id: string;
  service_key: string | null;
  date: string | null;
  amount: number | null;
  currency: string | null;
  source: string | null;
  period: string | null;
  payee_raw: string | null;
  confidence: string | null;
  synced_at: string;
};

type SpendAlertRow = {
  id: string;
  type: string | null;
  severity: string | null;
  service_key: string | null;
  detail: string | null;
  period: string | null;
  acknowledged: number;
  synced_at: string;
};

type SpendTotalRow = {
  period: string;
  eur_total: number | null;
  usd_total: number | null;
  captured_at: string | null;
  synced_at: string;
};

type SpendUsageRow = {
  service_key: string;
  metric: string;
  value: number | null;
  limit_value: number | null;
  pct: number | null;
  unit: string | null;
  captured_at: string | null;
  synced_at: string;
};

function numberOrNull(v: number | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numberOrZero(v: number | null): number {
  return numberOrNull(v) ?? 0;
}

function maxIso(current: string, next: string): string {
  return next > current ? next : current;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  try {
    const sql = getDb(env);
    const servicesRows = (await sql/* sql */ `
      SELECT key, vendor, product, category, scope, plan_type, billing_model,
             est_monthly_eur, currency_hint, usage_source, billing_source,
             connection_status, connection_detail, active, synced_at
        FROM spend_services
       ORDER BY active DESC, connection_status, scope, category, vendor
    `) as SpendServiceRow[];
    const chargeRows = (await sql/* sql */ `
      SELECT id, service_key, date, amount, currency, source, period, payee_raw,
             confidence, synced_at
        FROM spend_charges
       ORDER BY date DESC
       LIMIT 500
    `) as SpendChargeRow[];
    const alertRows = (await sql/* sql */ `
      SELECT id, type, severity, service_key, detail, period, acknowledged, synced_at
        FROM spend_alerts
       ORDER BY type, severity, service_key
    `) as SpendAlertRow[];
    const totalRows = (await sql/* sql */ `
      SELECT period, eur_total, usd_total, captured_at, synced_at
        FROM spend_totals
       ORDER BY period DESC
    `) as SpendTotalRow[];
    const usageRows = (await sql/* sql */ `
      SELECT service_key, metric, value, limit_value, pct, unit, captured_at, synced_at
        FROM spend_usage
       ORDER BY pct DESC, service_key, metric
    `) as SpendUsageRow[];

    const services = servicesRows.map((r) => ({
      key: r.key,
      vendor: r.vendor,
      product: r.product,
      category: r.category,
      scope: r.scope,
      plan_type: r.plan_type,
      billing_model: r.billing_model,
      est_monthly_eur: numberOrNull(r.est_monthly_eur),
      currency_hint: r.currency_hint,
      usage_source: r.usage_source,
      billing_source: r.billing_source,
      connection_status: r.connection_status,
      connection_detail: r.connection_detail,
      active: r.active === 1,
    }));

    const charges = chargeRows.map((r) => ({
      id: r.id,
      service_key: r.service_key,
      date: r.date,
      amount: numberOrNull(r.amount),
      currency: r.currency,
      source: r.source,
      period: r.period,
      payee_raw: r.payee_raw,
      confidence: r.confidence,
    }));

    const alerts = alertRows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      service_key: r.service_key,
      detail: r.detail,
      period: r.period,
      acknowledged: r.acknowledged === 1,
    }));

    const totals = totalRows.map((r) => ({
      period: r.period,
      eur_total: numberOrNull(r.eur_total),
      usd_total: numberOrNull(r.usd_total),
      captured_at: r.captured_at,
    }));

    const usage = usageRows.map((r) => ({
      service_key: r.service_key,
      metric: r.metric,
      value: numberOrNull(r.value),
      limit_value: numberOrNull(r.limit_value),
      pct: numberOrNull(r.pct),
      unit: r.unit,
      captured_at: r.captured_at,
    }));

    const currentPeriod = new Date().toISOString().slice(0, 7);
    const currentTotal = totalRows.find((r) => r.period === currentPeriod);
    const byConnectionStatus = {
      connected: services.filter((s) => s.connection_status === "connected").length,
      degraded: services.filter((s) => s.connection_status === "degraded").length,
      "no-cred": services.filter((s) => s.connection_status === "no-cred").length,
      "no-api": services.filter((s) => s.connection_status === "no-api").length,
    };
    const lastSync = [...servicesRows, ...chargeRows, ...alertRows, ...totalRows, ...usageRows].reduce(
      (m, r) => maxIso(m, r.synced_at),
      "",
    );

    const summary = {
      currentPeriod,
      eurMonthly: numberOrZero(currentTotal?.eur_total ?? null),
      usdMonthly: numberOrZero(currentTotal?.usd_total ?? null),
      byConnectionStatus,
      unpaidInvoiceCount: alertRows.filter((r) => r.type === "unpaid_invoice").length,
      usageOverLimitCount: usageRows.filter((r) => r.pct != null && r.pct > 80).length,
      lastSync,
    };

    return json({ services, charges, alerts, totals, usage, summary });
  } catch (err) {
    return json(
      {
        error: "spend fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
