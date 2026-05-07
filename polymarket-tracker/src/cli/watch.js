import { config } from '../config.js';
import { log } from '../log.js';
import { fetchNewTrades } from '../polymarket/activity.js';
import { mirrorTrade } from '../polymarket/trader.js';
import { buildNotifiers, formatTrade, notifyAll } from '../notify/index.js';
import { loadState, saveState } from '../store.js';
import { refreshLeaderboards } from './leaderboard.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function trackedWallets(state) {
  // Union the top-N across every window so we catch a trader who only ranks
  // on, say, the all-time board but is currently active.
  const set = new Set();
  for (const rows of Object.values(state.leaderboards || {})) {
    for (const r of rows) set.add(r.wallet);
  }
  return [...set];
}

function rankFor(state, wallet) {
  // Best (lowest) rank across windows; just for nicer alert formatting.
  let best = null;
  for (const rows of Object.values(state.leaderboards || {})) {
    const i = rows.findIndex((r) => r.wallet === wallet);
    if (i >= 0 && (best === null || i + 1 < best)) best = i + 1;
  }
  return best;
}

export async function runWatch() {
  const notifiers = buildNotifiers();
  log.info(`notifiers: ${notifiers.map((n) => n.name).join(', ')}`);
  log.info(`auto-execute: ${config.execute.enabled ? 'ENABLED' : 'disabled'}`);

  let state = await loadState();
  let lastLeaderboardRefresh = 0;

  // Mark "now" as the cutoff for already-known trades on first run, so we
  // don't spam notifications with backfilled history.
  const bootTs = Math.floor(Date.now() / 1000);

  while (true) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - lastLeaderboardRefresh >= config.poll.leaderboardRefreshSec) {
      try {
        await refreshLeaderboards();
        state = await loadState();
        lastLeaderboardRefresh = nowSec;
        log.info(`leaderboards refreshed; tracking ${trackedWallets(state).length} wallets`);
      } catch (err) {
        log.warn(`leaderboard refresh failed: ${err.message}`);
      }
    }

    const wallets = trackedWallets(state);
    for (const w of wallets) {
      const since = state.lastSeenTradeTs[w] ?? bootTs;
      let fresh = [];
      try {
        fresh = await fetchNewTrades(w, since);
      } catch (err) {
        log.warn(`activity fetch failed for ${w}: ${err.message}`);
        continue;
      }
      for (const t of fresh) {
        const rank = rankFor(state, w);
        const text = formatTrade(t, rank);
        await notifyAll(notifiers, text);
        if (config.execute.enabled) {
          const result = await mirrorTrade(t);
          if (result.placed) log.info(`mirrored ${t.id} -> order ${result.ourOrderId} ($${result.sizeUsdc.toFixed(2)})`);
          else if (result.error) log.error(`mirror error: ${result.error}`);
          else log.debug(`mirror skipped: ${result.skipped}`);
        }
        state.lastSeenTradeTs[w] = Math.max(state.lastSeenTradeTs[w] ?? 0, t.ts);
      }
      if (fresh.length) await saveState(state);
    }

    await sleep(config.poll.intervalSec * 1000);
  }
}
