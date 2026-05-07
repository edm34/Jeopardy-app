import { WINDOWS } from '../config.js';
import { log } from '../log.js';
import { getPositions, getTrades } from './api.js';

const nowSec = () => Math.floor(Date.now() / 1000);

// ---- Field normalizers ------------------------------------------------------
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const tradeTimestamp = (t) =>
  num(t.timestamp ?? t.ts ?? t.time ?? t.matchTime ?? t.createdAt);
const tradeSide = (t) => String(t.side ?? t.action ?? t.type ?? '').toUpperCase();
const tradePrice = (t) => num(t.price ?? t.matchPrice ?? t.fillPrice);
const tradeSize = (t) => num(t.size ?? t.shares ?? t.amount ?? t.filledSize);
const positionPnl = (p) => {
  if (p.cashPnl !== undefined) return num(p.cashPnl);
  return num(p.realizedPnl) + num(p.unrealizedPnl);
};

// Maps a user-requested window id to the lb-api native window if one exists.
// 60d/90d/6m/12m have no native equivalent and must be computed locally.
const NATIVE_WINDOW_FOR = {
  '30d': '30d',
  all: 'all',
};

function realizedFromTrades(trades, sinceSec) {
  const groups = new Map();
  for (const t of trades) {
    const ts = tradeTimestamp(t);
    if (!ts) continue;
    const market = t.market ?? t.marketId ?? t.conditionId ?? t.eventSlug ?? 'unknown';
    const outcome = t.outcome ?? t.outcomeIndex ?? t.tokenId ?? 'unknown';
    const key = `${market}::${outcome}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  let realized = 0;
  for (const fills of groups.values()) {
    fills.sort((a, b) => tradeTimestamp(a) - tradeTimestamp(b));
    let qty = 0;
    let avg = 0;
    for (const f of fills) {
      const side = tradeSide(f);
      const sz = tradeSize(f);
      const px = tradePrice(f);
      if (sz <= 0 || !Number.isFinite(px)) continue;
      const ts = tradeTimestamp(f);
      const isBuy = side === 'BUY' || side === 'BID' || side === 'OPEN';
      if (isBuy) {
        const newQty = qty + sz;
        avg = newQty > 0 ? (avg * qty + px * sz) / newQty : 0;
        qty = newQty;
      } else {
        const closeSz = Math.min(qty, sz);
        const pnl = (px - avg) * closeSz;
        if (sinceSec === null || ts >= sinceSec) realized += pnl;
        qty -= closeSz;
        if (qty <= 0) {
          qty = 0;
          avg = 0;
        }
      }
    }
  }
  return realized;
}

function unrealizedFromPositions(positions, sinceSec) {
  let unreal = 0;
  for (const p of positions) {
    const entry = num(p.entryTime ?? p.firstTradeTs ?? p.createdAt);
    if (sinceSec !== null && (!entry || entry < sinceSec)) continue;
    const u = p.unrealizedPnl !== undefined ? num(p.unrealizedPnl) : positionPnl(p);
    unreal += u;
  }
  return unreal;
}

// Computes only the windows that don't have a native lb-api equivalent.
async function computeNonNativeWindows(wallet) {
  const [positions, trades] = await Promise.all([
    getPositions(wallet),
    getTrades(wallet, { limit: 1000 }),
  ]);
  const pnl = {};
  for (const w of WINDOWS) {
    if (NATIVE_WINDOW_FOR[w.id]) continue;
    const since = w.days === null ? null : nowSec() - w.days * 86400;
    pnl[w.id] = realizedFromTrades(trades, since) + unrealizedFromPositions(positions, since);
  }
  const lastTradeTs = trades.reduce((m, t) => Math.max(m, tradeTimestamp(t)), 0);
  return { pnl, lastTradeTs };
}

// Builds the per-window leaderboards from the discovered pool. For windows
// lb-api supports natively, we just trust its `pnl` field — that matches what
// polymarket.com/leaderboard displays exactly. For 60d/90d/6m/12m we compute.
export async function rankPool(pool, { topN = 10, computeNonNative = true } = {}) {
  const wallets = Object.entries(pool);
  const computed = {};
  if (computeNonNative) {
    log.info(`computing non-native PnL windows for ${wallets.length} wallets...`);
    const batchSize = 4;
    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize);
      const rows = await Promise.all(
        batch.map(async ([w]) => {
          try {
            const r = await computeNonNativeWindows(w);
            return [w, r];
          } catch (err) {
            log.warn(`pnl failed for ${w}: ${err.message}`);
            return [w, { pnl: {}, lastTradeTs: 0 }];
          }
        }),
      );
      for (const [w, r] of rows) computed[w] = r;
    }
  }

  const leaderboards = {};
  for (const w of WINDOWS) {
    const native = NATIVE_WINDOW_FOR[w.id];
    const rows = wallets.map(([wallet, meta]) => {
      const pnl = native
        ? num(meta.nativePnl?.[native])
        : num(computed[wallet]?.pnl?.[w.id]);
      return {
        wallet,
        username: meta.username || null,
        xUsername: meta.xUsername || null,
        verifiedBadge: Boolean(meta.verifiedBadge),
        pnl,
        source: native ? 'lb-api' : 'computed',
        lastTradeTs: computed[wallet]?.lastTradeTs ?? 0,
      };
    });
    rows.sort((a, b) => b.pnl - a.pnl);
    leaderboards[w.id] = rows.slice(0, topN);
  }
  return leaderboards;
}
