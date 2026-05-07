import { WINDOWS } from '../config.js';
import { log } from '../log.js';
import { getPositions, getTrades } from './api.js';

const nowSec = () => Math.floor(Date.now() / 1000);

// ---- Field normalizers ------------------------------------------------------
// Polymarket's data API has shifted field names a few times. We try the
// known aliases and coerce to numbers.

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function tradeTimestamp(t) {
  return num(t.timestamp ?? t.ts ?? t.time ?? t.matchTime ?? t.createdAt);
}

function tradeSide(t) {
  return String(t.side ?? t.action ?? t.type ?? '').toUpperCase();
}

function tradePrice(t) {
  return num(t.price ?? t.matchPrice ?? t.fillPrice);
}

function tradeSize(t) {
  // Trade "size" in shares of the outcome token. USDC notional ~ size * price.
  return num(t.size ?? t.shares ?? t.amount ?? t.filledSize);
}

function tradeUsdc(t) {
  return num(t.usdcSize ?? t.notional ?? t.usdc ?? tradeSize(t) * tradePrice(t));
}

function positionPnl(p) {
  // Prefer cashPnl when present; otherwise sum realized + unrealized.
  if (p.cashPnl !== undefined) return num(p.cashPnl);
  return num(p.realizedPnl) + num(p.unrealizedPnl);
}

// ---- PnL computation per window --------------------------------------------
// Strategy: for each candidate wallet, fetch positions (current marks) and
// trade history. For windows that include "now", PnL is approximated as:
//   realized PnL from trades that closed within the window
// + mark-to-market unrealized PnL on positions opened within the window
// For the "all" window we just sum positionPnl across all positions.
//
// This is intentionally approximate. Polymarket's official numbers come from
// the same components but with proprietary fee accounting we don't have. The
// ranking, however, is robust against small absolute errors.

function realizedFromTrades(trades, sinceSec) {
  // Group fills by market+outcome, walk chronologically, track avg entry.
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
  // Use current cashPnl/unrealizedPnl, but only count positions whose first
  // fill (entryTime) is within the window. If no entry time is exposed, we
  // include the position only for the "all" window.
  let unreal = 0;
  for (const p of positions) {
    const entry = num(p.entryTime ?? p.firstTradeTs ?? p.createdAt);
    if (sinceSec !== null) {
      if (!entry || entry < sinceSec) continue;
    }
    const u = p.unrealizedPnl !== undefined ? num(p.unrealizedPnl) : positionPnl(p);
    unreal += u;
  }
  return unreal;
}

export async function computeWalletPnl(wallet) {
  const [positions, trades] = await Promise.all([
    getPositions(wallet),
    getTrades(wallet, { limit: 1000 }),
  ]);
  const out = {};
  for (const w of WINDOWS) {
    const since = w.days === null ? null : nowSec() - w.days * 86400;
    if (w.id === 'all') {
      const total = positions.reduce((s, p) => s + positionPnl(p), 0)
        + realizedFromTrades(trades, null) * 0; // realized already included in cashPnl
      out[w.id] = total;
    } else {
      const realized = realizedFromTrades(trades, since);
      const unreal = unrealizedFromPositions(positions, since);
      out[w.id] = realized + unreal;
    }
  }
  return {
    wallet,
    pnl: out,
    positionsCount: positions.length,
    tradesCount: trades.length,
    lastTradeTs: trades.reduce((m, t) => Math.max(m, tradeTimestamp(t)), 0),
  };
}

export async function rankCandidates(candidates, { topN = 10 } = {}) {
  const results = [];
  // Sequential fetch to be polite on rate limits; small batches in parallel.
  const batchSize = 4;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const rows = await Promise.all(
      batch.map(async (w) => {
        try {
          return await computeWalletPnl(w);
        } catch (err) {
          log.warn(`pnl failed for ${w}: ${err.message}`);
          return null;
        }
      }),
    );
    for (const r of rows) if (r) results.push(r);
  }
  const leaderboards = {};
  for (const w of WINDOWS) {
    leaderboards[w.id] = results
      .map((r) => ({ wallet: r.wallet, pnl: r.pnl[w.id], lastTradeTs: r.lastTradeTs }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, topN);
  }
  return leaderboards;
}
