import { log } from '../log.js';
import { getActivity } from './api.js';

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function normalizeTrade(wallet, t) {
  const ts = num(t.timestamp ?? t.ts ?? t.time ?? t.matchTime ?? t.createdAt);
  return {
    id: t.id ?? t.txHash ?? t.transactionHash ?? `${wallet}-${ts}-${t.market ?? ''}-${t.side ?? ''}`,
    wallet,
    ts,
    market: t.market ?? t.marketId ?? t.conditionId ?? t.eventSlug ?? null,
    marketTitle: t.marketTitle ?? t.title ?? t.eventTitle ?? null,
    outcome: t.outcome ?? t.outcomeIndex ?? null,
    tokenId: t.asset ?? t.tokenId ?? null,
    side: String(t.side ?? t.action ?? t.type ?? '').toUpperCase(),
    price: num(t.price ?? t.matchPrice ?? t.fillPrice),
    size: num(t.size ?? t.shares ?? t.amount ?? t.filledSize),
    usdc: num(t.usdcSize ?? t.notional ?? t.usdc),
    raw: t,
  };
}

export async function fetchNewTrades(wallet, sinceTs) {
  const raw = await getActivity(wallet, { limit: 100, type: 'TRADE' });
  const trades = raw.map((t) => normalizeTrade(wallet, t));
  const fresh = trades.filter((t) => t.ts > sinceTs);
  fresh.sort((a, b) => a.ts - b.ts);
  log.debug(`${wallet}: ${fresh.length} new trades since ${sinceTs}`);
  return fresh;
}
