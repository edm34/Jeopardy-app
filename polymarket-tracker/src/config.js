try {
  await import('dotenv/config');
} catch {
  // dotenv not installed yet (e.g. during `pm-tracker help` before npm install).
  // Real commands that need env vars will surface clear errors when those vars
  // are missing.
}

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  api: {
    gamma: process.env.GAMMA_API_BASE || 'https://gamma-api.polymarket.com',
    data: process.env.DATA_API_BASE || 'https://data-api.polymarket.com',
    clob: process.env.CLOB_API_BASE || 'https://clob.polymarket.com',
    leaderboard: process.env.LEADERBOARD_API_BASE || 'https://lb-api.polymarket.com',
  },
  poll: {
    intervalSec: num(process.env.POLL_INTERVAL_SEC, 20),
    leaderboardRefreshSec: num(process.env.LEADERBOARD_REFRESH_SEC, 900),
    topN: num(process.env.TOP_N, 10),
  },
  whatsapp: {
    sid: process.env.TWILIO_ACCOUNT_SID || '',
    token: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_WHATSAPP_FROM || '',
    to: list(process.env.WHATSAPP_TO),
    enabled() {
      return Boolean(this.sid && this.token && this.from && this.to.length);
    },
  },
  execute: {
    enabled: bool(process.env.AUTO_EXECUTE, false),
    privateKey: process.env.TRADER_PRIVATE_KEY || '',
    maxTradeUsdc: num(process.env.MAX_TRADE_USDC, 25),
    maxOpenUsdc: num(process.env.MAX_OPEN_USDC, 250),
    sizingMode: (process.env.SIZING_MODE || 'fixed').toLowerCase(),
    sizingPercent: num(process.env.SIZING_PERCENT, 1),
    maxTradeAgeSec: num(process.env.MAX_TRADE_AGE_SEC, 120),
  },
  dashboard: {
    port: num(process.env.DASHBOARD_PORT, 8787),
  },
  log: {
    level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  },
};

export const WINDOWS = [
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '60d', label: 'Last 60 days', days: 60 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: '6m', label: 'Last 6 months', days: 182 },
  { id: '12m', label: 'Last 12 months', days: 365 },
  { id: 'all', label: 'All time', days: null },
];
