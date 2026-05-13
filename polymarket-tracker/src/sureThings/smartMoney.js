// Smart-money overlay: for a candidate market and our pool of top traders,
// compute who in the pool has been trading this market in the last lookback
// hours, and on which side. Output is a per-candidate signal that the scanner
// converts into green / amber / red.

import { getMarketTrades } from '../polymarket/api.js';
import { log } from '../log.js';

const HOUR_SEC = 3600;

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function tradeWallet(t) {
  const w = t.proxyWallet ?? t.user ?? t.maker ?? t.taker ?? t.wallet;
  return w ? String(w).toLowerCase() : null;
}

function tradeTs(t) {
  return num(t.timestamp ?? t.ts ?? t.time ?? t.createdAt);
}

// Returns "YES" or "NO" or null. Polymarket trades report `outcome` ("Yes"/
// "No") + `side` (BUY/SELL). A BUY on "Yes" is bullish on YES; a SELL on
// "No" is also bullish on YES (closing a no-shares short). For simplicity we
// only count opens (BUYs) — closes don't represent fresh smart-money belief.
function tradeBullishSide(t) {
  const side = String(t.side ?? t.action ?? '').toUpperCase();
  if (side !== 'BUY' && side !== 'BID') return null;
  const outcome = String(t.outcome ?? '').toLowerCase();
  if (outcome === 'yes') return 'YES';
  if (outcome === 'no') return 'NO';
  return null;
}

function tradeUsdc(t) {
  return num(t.usdcSize ?? t.notional ?? t.usdc ?? (num(t.size) * num(t.price)));
}

/**
 * @param {object} market    Normalized market from markets.js
 * @param {Set<string>}  pool   Set of lowercased wallets we consider "smart"
 * @param {object} opts
 * @param {number} opts.lookbackHours
 */
export async function smartMoneyForMarket(market, pool, { lookbackHours = 24 } = {}) {
  const sinceTs = Math.floor(Date.now() / 1000) - lookbackHours * HOUR_SEC;
  let trades;
  try {
    trades = await getMarketTrades(market.conditionId, { limit: 500 });
  } catch (err) {
    log.debug(`getMarketTrades(${market.conditionId}) failed: ${err.message}`);
    return emptySignal();
  }

  let yesUsdc = 0;
  let noUsdc = 0;
  const yesWallets = new Set();
  const noWallets = new Set();
  for (const t of trades) {
    if (tradeTs(t) < sinceTs) continue;
    const w = tradeWallet(t);
    if (!w || !pool.has(w)) continue;
    const side = tradeBullishSide(t);
    if (!side) continue;
    const usdc = tradeUsdc(t);
    if (side === 'YES') {
      yesUsdc += usdc;
      yesWallets.add(w);
    } else {
      noUsdc += usdc;
      noWallets.add(w);
    }
  }
  return {
    yesUsdc,
    noUsdc,
    yesWallets: [...yesWallets],
    noWallets: [...noWallets],
    walletCount: yesWallets.size + noWallets.size,
  };
}

function emptySignal() {
  return { yesUsdc: 0, noUsdc: 0, yesWallets: [], noWallets: [], walletCount: 0 };
}

// Maps a raw smart-money signal + a candidate's "sure side" into one of:
//   green  — pool is net-buying on the cheap (97%+) side ⇒ confirms the price
//   amber  — no pool activity either way ⇒ no signal
//   red    — pool is net-buying the OTHER side ⇒ flashing warning
export function scoreSignal(signal, sureSide) {
  const { yesUsdc, noUsdc, walletCount } = signal;
  if (walletCount === 0) return 'amber';
  const sureUsdc = sureSide === 'YES' ? yesUsdc : noUsdc;
  const oppUsdc = sureSide === 'YES' ? noUsdc : yesUsdc;
  if (oppUsdc > sureUsdc * 1.5 && oppUsdc > 100) return 'red';
  if (sureUsdc > oppUsdc && sureUsdc > 50) return 'green';
  return 'amber';
}
