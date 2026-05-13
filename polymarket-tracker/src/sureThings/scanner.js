// Sure-thing scanner. Produces today's list of candidate markets:
//   * binary
//   * resolves within `withinHours` (default 24)
//   * one outcome priced >= `threshold` (default 0.97) on the orderbook
// Then layers in the smart-money signal and applies the SMART_MONEY_RULE gate.

import { config } from '../config.js';
import { log } from '../log.js';
import { fetchBookQuotes, fetchMarketsEndingSoon } from '../polymarket/markets.js';
import { scoreSignal, smartMoneyForMarket } from './smartMoney.js';
import { getWalletHitRates } from './hitRate.js';

// Slow this down — we don't want to hammer gamma + clob.
const MAX_BOOKS_IN_FLIGHT = 8;

async function inBatches(items, batchSize, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(fn));
  }
}

function poolWallets(state) {
  // Anything in the rolling pool counts as smart money. The pool is already
  // restricted to lb-api top-100 across native windows + auto-promoted top
  // wallets, so membership alone is a meaningful filter.
  return new Set(Object.keys(state.pool || {}));
}

// Compute hit-rate-weighted score for the wallets that contributed to a
// market's smart-money signal. Falls back to 0 if no resolved-trade data yet.
function hitRateContext(signal, hitRates) {
  const allWallets = [...signal.yesWallets, ...signal.noWallets];
  if (!allWallets.length) return { avgHitRate: null, sampled: 0 };
  let sum = 0;
  let n = 0;
  for (const w of allWallets) {
    const stats = hitRates[w];
    if (stats && Number.isFinite(stats.hitRate) && stats.total >= 5) {
      sum += stats.hitRate;
      n++;
    }
  }
  return { avgHitRate: n > 0 ? sum / n : null, sampled: n };
}

export async function scanSureThings(state) {
  const threshold = config.sureThing.threshold;
  const withinHours = config.sureThing.maxHours;
  const lookbackHours = config.sureThing.smartLookbackHours;

  log.info(
    `sure-thing scan: threshold=${threshold} within=${withinHours}h ` +
      `rule=${config.sureThing.smartMoneyRule} exec=${config.sureThing.execMode}`,
  );

  const markets = await fetchMarketsEndingSoon({ withinHours });
  log.info(`sure-thing: ${markets.length} markets resolve within ${withinHours}h`);
  if (!markets.length) {
    return { all: [], gated: [], updatedAt: Math.floor(Date.now() / 1000) };
  }

  const pool = poolWallets(state);
  const hitRates = getWalletHitRates(state);
  const candidates = [];

  await inBatches(markets, MAX_BOOKS_IN_FLIGHT, async (m) => {
    const quotes = await fetchBookQuotes(m);
    // We look at the bid side: highest someone is willing to pay. If best bid
    // for YES >= 0.97 the market is pricing YES near certain. Same for NO.
    // For the execution price we'd use the ask, but for *classification* the
    // bid is the conservative read.
    const yesPrice = quotes.yes.bid ?? m.gammaYesPrice;
    const noPrice = quotes.no.bid ?? m.gammaNoPrice;
    let sureSide = null;
    let surePrice = null;
    let sureAsk = null;
    if (yesPrice !== null && yesPrice >= threshold) {
      sureSide = 'YES';
      surePrice = yesPrice;
      sureAsk = quotes.yes.ask;
    } else if (noPrice !== null && noPrice >= threshold) {
      sureSide = 'NO';
      surePrice = noPrice;
      sureAsk = quotes.no.ask;
    }
    if (!sureSide) return;

    const signal = await smartMoneyForMarket(m, pool, { lookbackHours });
    const score = scoreSignal(signal, sureSide);
    const hr = hitRateContext(signal, hitRates);
    candidates.push({
      conditionId: m.conditionId,
      slug: m.slug,
      question: m.question,
      endSec: m.endSec,
      sureSide,
      surePrice,
      sureAsk,
      yesTokenId: m.yesTokenId,
      noTokenId: m.noTokenId,
      smartMoney: {
        ...signal,
        score, // 'green' | 'amber' | 'red'
      },
      hitRateContext: hr,
    });
  });

  // Apply the gating rule.
  const rule = config.sureThing.smartMoneyRule;
  const gated = candidates.filter((c) => {
    if (rule === 'required') return c.smartMoney.score === 'green';
    if (rule === 'veto') return c.smartMoney.score !== 'red';
    return true; // 'advisory'
  });

  // Sort: green > amber > red, then by closest-to-resolution.
  const scoreOrder = { green: 0, amber: 1, red: 2 };
  gated.sort((a, b) => {
    const s = scoreOrder[a.smartMoney.score] - scoreOrder[b.smartMoney.score];
    if (s !== 0) return s;
    return a.endSec - b.endSec;
  });

  log.info(`sure-thing: ${candidates.length} priced candidates, ${gated.length} pass rule=${rule}`);
  return { all: candidates, gated, updatedAt: Math.floor(Date.now() / 1000) };
}
