import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const CANDIDATES_PATH = path.join(DATA_DIR, 'candidates.json');

const DEFAULT_STATE = {
  lastSeenTradeTs: {}, // { walletAddress: unixSeconds }
  leaderboards: {}, // { windowId: [{ wallet, pnl, source, username }] }
  leaderboardsUpdatedAt: 0,
  pool: {}, // { walletAddress: { firstSeen, lastSeen, username, xUsername, profileImage, verifiedBadge, nativePnl, nativeVol } }
  poolUpdatedAt: 0,
  mirroredTrades: [], // { srcWallet, srcTradeId, ourOrderId, marketId, side, size, price, ts }
  openMirroredUsdc: 0,
  // Latest sure-thing scanner output. Refreshed every SURE_THING_SCAN_INTERVAL_SEC.
  sureThings: { updatedAt: 0, gated: [], all: [] },
  // Sure-thing buys we've placed. Separate from `mirroredTrades` so each
  // strategy's lineage stays distinct.
  sureThingTrades: [],
  // Hit-rate tracker: every observed open from a pool wallet gets a position
  // record; once the market resolves we mark it W/L and recompute per-wallet
  // aggregates in hitRate.wallets.
  hitRate: { positions: [], wallets: {} },
  hitRateUpdatedAt: 0,
};

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_STATE };
    throw err;
  }
}

export async function saveState(state) {
  await ensureDir();
  const tmp = STATE_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, STATE_PATH);
}

export async function loadCandidates() {
  try {
    const raw = await fs.readFile(CANDIDATES_PATH, 'utf8');
    const json = JSON.parse(raw);
    const wallets = Array.isArray(json.wallets) ? json.wallets : [];
    return wallets
      .map((w) => String(w).toLowerCase().trim())
      .filter((w) => /^0x[0-9a-f]{40}$/.test(w));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveCandidates(wallets) {
  await ensureDir();
  const dedup = Array.from(new Set(wallets.map((w) => String(w).toLowerCase())));
  await fs.writeFile(
    CANDIDATES_PATH,
    JSON.stringify({ wallets: dedup }, null, 2),
  );
}

// Merge auto-discovered entries into the rolling pool. Existing wallets get
// fresh metadata + bumped lastSeen; new wallets get firstSeen=now.
export function upsertPool(state, entries, { ttlDays = 180 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSec = ttlDays * 86400;
  const pool = state.pool ?? {};
  for (const [wallet, meta] of entries.entries()) {
    const prev = pool[wallet] ?? { firstSeen: now };
    pool[wallet] = {
      ...prev,
      ...meta,
      lastSeen: now,
    };
  }
  // Drop wallets that haven't appeared in any leaderboard for ttlDays.
  for (const [wallet, meta] of Object.entries(pool)) {
    if (!entries.has(wallet) && meta.lastSeen && now - meta.lastSeen > ttlSec) {
      delete pool[wallet];
    }
  }
  state.pool = pool;
  state.poolUpdatedAt = now;
  return state;
}

export const paths = { ROOT, DATA_DIR, STATE_PATH, CANDIDATES_PATH };
