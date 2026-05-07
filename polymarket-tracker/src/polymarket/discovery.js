// Auto-discovers the rolling pool of top Polymarket traders by pulling
// lb-api.polymarket.com's public profit/volume rankings across every native
// window (1d, 7d, 30d, all). Each unique wallet is upserted into the pool
// with metadata we can later use for ranking and display.
//
// The pool is the source of truth for "who to track" — no manual seeding
// required. Users may still pin extra wallets via data/candidates.json.

import { log } from '../log.js';
import { getRemoteLeaderboard } from './api.js';

const NATIVE_WINDOWS = ['1d', '7d', '30d', 'all'];
const METRICS = ['profit', 'volume'];

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function walletOf(row) {
  // lb-api uses proxyWallet; defend against alternate names just in case.
  const w = row.proxyWallet ?? row.wallet ?? row.address ?? row.user;
  return w ? String(w).toLowerCase() : null;
}

export async function discoverPoolEntries({ limit = 100 } = {}) {
  const entries = new Map(); // wallet -> { username, xUsername, profileImage, nativePnl: { window: pnl }, nativeVol: { window: vol } }
  for (const metric of METRICS) {
    for (const window of NATIVE_WINDOWS) {
      let rows;
      try {
        rows = await getRemoteLeaderboard(metric, window, { limit });
      } catch (err) {
        log.warn(`lb-api ${metric}/${window} failed: ${err.message}`);
        continue;
      }
      log.debug(`lb-api ${metric}/${window}: ${rows.length} rows`);
      for (const r of rows) {
        const w = walletOf(r);
        if (!w || !/^0x[0-9a-f]{40}$/.test(w)) continue;
        const cur = entries.get(w) ?? {
          username: null,
          xUsername: null,
          profileImage: null,
          verifiedBadge: false,
          nativePnl: {},
          nativeVol: {},
        };
        cur.username = r.userName ?? r.username ?? cur.username;
        cur.xUsername = r.xUsername ?? cur.xUsername;
        cur.profileImage = r.profileImage ?? cur.profileImage;
        cur.verifiedBadge = Boolean(r.verifiedBadge ?? cur.verifiedBadge);
        if (metric === 'profit') cur.nativePnl[window] = num(r.pnl);
        if (metric === 'volume') cur.nativeVol[window] = num(r.vol ?? r.volume);
        entries.set(w, cur);
      }
    }
  }
  return entries;
}
