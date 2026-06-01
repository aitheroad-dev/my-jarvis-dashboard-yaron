-- 013_portfolio.sql — Portfolio domain (mirror of local pai-portfolio CLI).
-- NOTE: v1 of /api/portfolio serves an embedded snapshot (no DB dependency)
-- because this tenant's Neon mirror isn't reachable yet. When it is, apply this
-- and switch functions/api/portfolio/index.ts to SELECT from portfolio_holdings.
-- Base reporting currency: EUR. fx.rate_to_base = value of 1 unit of ccy in EUR.

CREATE TABLE IF NOT EXISTS portfolio_fx (
  ccy          TEXT PRIMARY KEY,
  rate_to_base NUMERIC NOT NULL,
  as_of        DATE
);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id           SERIAL PRIMARY KEY,
  ticker       TEXT NOT NULL,
  name         TEXT NOT NULL,
  exchange     TEXT,
  currency     TEXT NOT NULL,
  qty          NUMERIC NOT NULL,
  price_native NUMERIC NOT NULL,
  cluster      TEXT,
  flags        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, exchange)
);

INSERT INTO portfolio_fx (ccy, rate_to_base, as_of) VALUES
  ('EUR', 1.0,    '2026-05-31'),
  ('USD', 0.926,  '2026-05-31'),
  ('CAD', 0.671,  '2026-05-31'),
  ('SEK', 0.1002, '2026-05-31')
ON CONFLICT (ccy) DO UPDATE SET rate_to_base = EXCLUDED.rate_to_base, as_of = EXCLUDED.as_of;

INSERT INTO portfolio_holdings (ticker, name, exchange, currency, qty, price_native, cluster, flags) VALUES
  ('SLV',   'iShares Silver Trust',          'NYSE Arca',        'USD', 601,   68.42,  'metals',     NULL),
  ('GLDG',  'GoldMining Inc',                'NYSE American',    'USD', 20000, 1.17,   'metals',     NULL),
  ('PPG',   'PPG Industries',                'NYSE',             'USD', 200,   112.98, 'industrial', NULL),
  ('MBLY',  'Mobileye Global',               'Nasdaq',           'USD', 2100,  10.47,  'auto-tech',  NULL),
  ('STEX',  'Streamex (ex-BioSig)',          'Nasdaq',           'USD', 9500,  1.49,   'gold-rwa',   NULL),
  ('ODYS',  'Odysight.ai',                   'Nasdaq',           'USD', 2950,  4.58,   'medtech',    'price?'),
  ('TELIF', 'Telescope Innovations',         'US OTCQB',         'USD', 30000, 0.45,   'chem-tech',  NULL),
  ('CRDL',  'Cardiol Therapeutics',          'Toronto (TSX)',    'CAD', 8000,  1.69,   'biotech',    NULL),
  ('HELP',  'Helus Pharma (ex-Cybin)',       'Nasdaq',           'USD', 2000,  4.41,   'biotech',    NULL),
  ('GARLF', 'Roxmore Resources (ex-Axcap)',  'US OTCQX',         'USD', 3000,  2.89,   'resources',  NULL),
  ('DEFI',  'DeFi Technologies',             'Cboe Canada',      'CAD', 11100, 0.94,   'crypto',     NULL),
  ('DETX',  'Liberty Defense (Nasdaq)',      'Nasdaq',           'USD', 1330,  4.50,   'defense',    NULL),
  ('ARISE', 'Arise AB',                      'Nasdaq Stockholm', 'SEK', 1200,  44.60,  'energy',     NULL),
  ('AETH',  'Bitwise Ethereum Strategy ETF', 'NYSE Arca',        'USD', 86,    32.60,  'crypto',     'price?'),
  ('UUUFF', 'Uranium One Mining',            'US OTC',           'USD', 8600,  0.2892, 'uranium',    'ticker->UUUFD'),
  ('RBOHF', 'Humanoid Global Holdings',      'US OTC',           'USD', 7000,  0.2281, 'robotics',   NULL),
  ('SCAN',  'Liberty Defense (TSX-V)',       'TSX Venture',      'CAD', 222,   6.11,   'defense',    NULL)
ON CONFLICT (ticker, exchange) DO UPDATE SET
  name = EXCLUDED.name, currency = EXCLUDED.currency, qty = EXCLUDED.qty,
  price_native = EXCLUDED.price_native, cluster = EXCLUDED.cluster,
  flags = EXCLUDED.flags, updated_at = now();
