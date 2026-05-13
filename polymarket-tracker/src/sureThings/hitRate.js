// Per-trader hit-rate tracker.
//
// Records every observed pool-wallet trade as a "position" entry, then sweeps
// resolved markets on a slower cadence and marks each position W/L. From this
// we compute a rolling hit rate per wallet that the dashboard surfaces beside
// the existing PnL leaderboards.
//
// On day 1 this table is empty, so the scanner falls back to "is the wallet in
// any leaderboard top-N" as the smart-money proxy. After a few days of running
// the resolved-trade win % becomes the more reliable signal.

import { getMarket } from '../polymarket/api.js';
import { log } from '../log.js';

// Append a position record from an observed trade. Side ('YES'/'NO') is what
// the trader bought; entryPrice is what they paid. Both are required to score
// outcome later.
export function recordPosition(state, trade) {
  if (!trade?.market) return;
  const side = inferSide(trade);
  if (!side) return;
  state.hitRate ??= { positions: [], wallets: {} };
  state.hitRate.positions.push({
    wallet: trade.wallet,
    market: trade.market,
    side,
    entryPrice: trade.price,
    sizeUsdc: trade.usdc || trade.size * trade.price,
    openedTs: trade.ts,
    resolved: false,
    won: null,
  });
  // Cap memory: keep at most ~20k positions globally.
  if (state.hitRate.positions.length > 20000) {
    state.hitRate.positions = state.hitRate.positions.slice(-20000);
  }
}

function inferSide(trade) {
  const side = String(trade.side ?? '').toUpperCase();
  if (side !== 'BUY' && side !== 'BID') return null; // only score opens
  const outcome = String(trade.outcome ?? '').toLowerCase();
  if (outcome === 'yes' || trade.outcome === 0) return 'YES';
  if (outcome === 'no' || trade.outcome === 1) return 'NO';
  return null;
}

// Periodic sweep: for each unresolved position, look up the market. If gamma
// reports it as resolved (`closed=true` + a clearly-set winning outcome),
// mark the position W or L. Cheap: positions over the same market dedupe to
// one HTTP call.
export async function sweepResolutions(state) {
  state.hitRate ??= { positions: [], wallets: {} };
  const pending = state.hitRate.positions.filter((p) => !p.resolved);
  if (pending.length === 0) return { resolved: 0 };
  const markets = new Map(); // marketId -> gamma response
  for (const p of pending) {
    if (markets.has(p.market)) continue;
    try {
      const m = await getMarket(p.market);
      markets.set(p.market, m);
    } catch (err) {
      log.debug(`sweepResolutions: getMarket(${p.market}) failed: ${err.message}`);
      markets.set(p.market, null);
    }
  }
  let resolved = 0;
  for (const p of pending) {
    const m = markets.get(p.market);
    if (!m) continue;
    const winner = winningSide(m);
    if (!winner) continue;
    p.resolved = true;
    p.won = winner === p.side;
    p.resolvedTs = Math.floor(Date.now() / 1000);
    resolved++;
  }
  if (resolved > 0) recomputeWallets(state);
  return { resolved };
}

function winningSide(market) {
  if (!market) return null;
  if (!market.closed) return null;
  // Polymarket exposes the resolved outcome a few different ways depending on
  // endpoint version. Cover the common ones.
  const idx =
    market.resolvedOutcomeIndex ??
    market.umaResolvedOutcomeIndex ??
    market.winningOutcomeIndex ??
    null;
  if (idx === 0) return 'YES';
  if (idx === 1) return 'NO';
  const name = String(market.resolvedOutcome ?? market.winningOutcome ?? '').toLowerCase();
  if (name === 'yes') return 'YES';
  if (name === 'no') return 'NO';
  return null;
}

function recomputeWallets(state) {
  const agg = {};
  for (const p of state.hitRate.positions) {
    if (!p.resolved) continue;
    const w = (agg[p.wallet] ??= { wins: 0, losses: 0, wonUsdc: 0, lostUsdc: 0 });
    if (p.won) {
      w.wins++;
      w.wonUsdc += p.sizeUsdc * (1 - p.entryPrice);
    } else {
      w.losses++;
      w.lostUsdc += p.sizeUsdc;
    }
  }
  for (const v of Object.values(agg)) {
    const total = v.wins + v.losses;
    v.total = total;
    v.hitRate = total > 0 ? v.wins / total : null;
    v.netUsdc = v.wonUsdc - v.lostUsdc;
  }
  state.hitRate.wallets = agg;
}

// Pull the cached hit-rate dict (wallet -> stats) for use in the scanner /
// dashboard. Returns {} if no resolved positions yet.
export function getWalletHitRates(state) {
  return state.hitRate?.wallets ?? {};
}
