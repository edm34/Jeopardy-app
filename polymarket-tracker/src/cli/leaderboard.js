import { WINDOWS, config } from '../config.js';
import { log } from '../log.js';
import { rankPool } from '../polymarket/leaderboard.js';
import { discoverPoolEntries } from '../polymarket/discovery.js';
import { loadCandidates, loadState, saveState, upsertPool } from '../store.js';

function fmtUsd(n) {
  const sign = n < 0 ? '-' : ' ';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function printTable(windowLabel, rows) {
  console.log(`\n=== ${windowLabel} ===`);
  if (!rows.length) {
    console.log('(no data)');
    return;
  }
  console.log('rank  pnl              source     wallet                                       handle');
  rows.forEach((r, i) => {
    const handle = r.username ? `@${r.username}` : '';
    console.log(
      `${String(i + 1).padStart(3)}.  ${fmtUsd(r.pnl).padStart(13)}    ${r.source.padEnd(8)} ${r.wallet}  ${handle}`,
    );
  });
}

// Refreshes the rolling pool from lb-api, merges in any pinned wallets from
// data/candidates.json, recomputes leaderboards across all six windows, and
// persists. Returns the leaderboards so callers can print or expose them.
export async function refreshLeaderboards({ computeNonNative = true } = {}) {
  log.info(`discovering pool from ${config.api.leaderboard}...`);
  const discovered = await discoverPoolEntries({ limit: 100 });
  log.info(`discovered ${discovered.size} unique wallets across native windows`);

  const pinned = await loadCandidates();
  for (const w of pinned) {
    if (!discovered.has(w)) {
      discovered.set(w, {
        username: null,
        xUsername: null,
        profileImage: null,
        verifiedBadge: false,
        nativePnl: {},
        nativeVol: {},
      });
    }
  }
  if (pinned.length) log.info(`+ ${pinned.length} pinned wallets from data/candidates.json`);

  if (!discovered.size) {
    throw new Error(
      `lb-api returned no wallets. Check connectivity to ${config.api.leaderboard} or override LEADERBOARD_API_BASE in .env.`,
    );
  }

  let state = await loadState();
  state = upsertPool(state, discovered);
  await saveState(state);

  const leaderboards = await rankPool(state.pool, {
    topN: config.poll.topN,
    computeNonNative,
  });

  state.leaderboards = leaderboards;
  state.leaderboardsUpdatedAt = Math.floor(Date.now() / 1000);
  await saveState(state);
  return leaderboards;
}

export async function runLeaderboard() {
  const args = process.argv.slice(3);
  const fast = args.includes('--fast'); // skip the 60d/90d/6m/12m local compute
  const lbs = await refreshLeaderboards({ computeNonNative: !fast });
  for (const w of WINDOWS) {
    if (fast && !['30d', 'all'].includes(w.id)) continue;
    printTable(w.label, lbs[w.id] || []);
  }
  if (fast) {
    console.log('\n(--fast: only native lb-api windows shown. Run without --fast for 60d/90d/6m/12m.)');
  }
}
