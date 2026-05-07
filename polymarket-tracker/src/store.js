import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const CANDIDATES_PATH = path.join(DATA_DIR, 'candidates.json');

const DEFAULT_STATE = {
  lastSeenTradeTs: {}, // { walletAddress: unixSeconds }
  leaderboards: {}, // { windowId: [{ wallet, pnl, ... }] }
  leaderboardsUpdatedAt: 0,
  mirroredTrades: [], // { srcWallet, srcTradeId, ourOrderId, marketId, side, size, price, ts }
  openMirroredUsdc: 0,
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

export const paths = { ROOT, DATA_DIR, STATE_PATH, CANDIDATES_PATH };
