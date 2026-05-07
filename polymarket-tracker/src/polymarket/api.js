import { config } from '../config.js';
import { log } from '../log.js';

const DEFAULT_TIMEOUT_MS = 15_000;

async function request(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      if (!res.ok) {
        // 4xx other than 429 -> don't retry, just return null so callers can
        // treat the wallet as "no data".
        log.debug('non-retryable HTTP', res.status, url);
        return null;
      }
      return await res.json();
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      const wait = 500 * 2 ** attempt;
      log.debug(`fetch failed (attempt ${attempt + 1}): ${err.message}; retry in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

// ---- Data API ---------------------------------------------------------------
// These endpoints are publicly documented on docs.polymarket.com under the
// "Data API". Shapes are as of late-2025; if Polymarket changes them, the
// downstream normalization in leaderboard.js / activity.js is the only place
// you need to adjust.

export async function getPositions(wallet, { limit = 500 } = {}) {
  const url = `${config.api.data}/positions${qs({ user: wallet, limit })}`;
  const json = await request(url);
  if (!json) return [];
  return Array.isArray(json) ? json : json.data ?? [];
}

export async function getActivity(wallet, { limit = 200, type = 'TRADE' } = {}) {
  const url = `${config.api.data}/activity${qs({ user: wallet, limit, type })}`;
  const json = await request(url);
  if (!json) return [];
  return Array.isArray(json) ? json : json.data ?? [];
}

export async function getTrades(wallet, { limit = 500 } = {}) {
  // Some Polymarket deployments expose /trades; we fall back to /activity.
  const url = `${config.api.data}/trades${qs({ user: wallet, limit })}`;
  try {
    const json = await request(url, { retries: 1 });
    if (json) return Array.isArray(json) ? json : json.data ?? [];
  } catch (_) {
    /* fall through */
  }
  return getActivity(wallet, { limit, type: 'TRADE' });
}

// ---- Gamma API --------------------------------------------------------------

export async function getMarket(slugOrId) {
  // Try by id, then by slug.
  const byId = `${config.api.gamma}/markets/${encodeURIComponent(slugOrId)}`;
  let json = await request(byId, { retries: 1 });
  if (json) return json;
  const bySlug = `${config.api.gamma}/markets${qs({ slug: slugOrId })}`;
  json = await request(bySlug);
  if (Array.isArray(json) && json.length) return json[0];
  return null;
}

// ---- Leaderboard (lb-api.polymarket.com) ------------------------------------
// The public ranking API. Returns an array of:
//   { rank, proxyWallet, userName, vol, pnl, profileImage, xUsername, ... }
// Supported windows on the upstream API are: 1d, 7d, 30d, all.

export async function getRemoteLeaderboard(metric, window, { limit = 100 } = {}) {
  if (!config.api.leaderboard) return [];
  const path = metric === 'volume' ? 'volume' : 'profit';
  const url = `${config.api.leaderboard}/${path}${qs({ window, limit })}`;
  const json = await request(url);
  if (!json) return [];
  return Array.isArray(json) ? json : json.data ?? [];
}
