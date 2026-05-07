import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, WINDOWS } from '../config.js';
import { log } from '../log.js';
import { loadState } from '../store.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function runDashboard() {
  const app = express();
  app.use(express.static(path.join(here, 'public')));

  app.get('/api/leaderboards', async (_req, res) => {
    const state = await loadState();
    res.json({
      updatedAt: state.leaderboardsUpdatedAt,
      poolSize: Object.keys(state.pool || {}).length,
      poolUpdatedAt: state.poolUpdatedAt || 0,
      windows: WINDOWS,
      leaderboards: state.leaderboards,
    });
  });

  app.get('/api/recent-trades', async (_req, res) => {
    const state = await loadState();
    const last = Object.entries(state.lastSeenTradeTs).map(([wallet, ts]) => ({
      wallet,
      ts,
    }));
    last.sort((a, b) => b.ts - a.ts);
    res.json({ lastSeen: last.slice(0, 50) });
  });

  app.get('/api/mirrored', async (_req, res) => {
    const state = await loadState();
    res.json({
      openMirroredUsdc: state.openMirroredUsdc,
      mirroredTrades: state.mirroredTrades.slice(-50).reverse(),
    });
  });

  app.listen(config.dashboard.port, () => {
    log.info(`dashboard at http://localhost:${config.dashboard.port}`);
  });
}
