import { WINDOWS, config } from '../config.js';
import { log } from '../log.js';
import { rankCandidates } from '../polymarket/leaderboard.js';
import { loadCandidates, loadState, saveState } from '../store.js';

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
  console.log('rank  pnl              wallet');
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(3)}.  ${fmtUsd(r.pnl).padStart(13)}    ${r.wallet}`,
    );
  });
}

export async function refreshLeaderboards() {
  const candidates = await loadCandidates();
  if (!candidates.length) {
    throw new Error(
      'No candidate wallets. Copy data/candidates.example.json to data/candidates.json and add wallet addresses, or run `pm-tracker seed --wallets 0x...,0x...`.',
    );
  }
  log.info(`ranking ${candidates.length} candidate wallets...`);
  const leaderboards = await rankCandidates(candidates, { topN: config.poll.topN });
  const state = await loadState();
  state.leaderboards = leaderboards;
  state.leaderboardsUpdatedAt = Math.floor(Date.now() / 1000);
  await saveState(state);
  return leaderboards;
}

export async function runLeaderboard() {
  const lbs = await refreshLeaderboards();
  for (const w of WINDOWS) printTable(w.label, lbs[w.id] || []);
}
