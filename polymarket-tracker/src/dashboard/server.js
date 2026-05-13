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

  app.get('/api/sure-things', async (_req, res) => {
    const state = await loadState();
    res.json({
      mode: {
        threshold: config.sureThing.threshold,
        maxHours: config.sureThing.maxHours,
        execMode: config.sureThing.execMode,
        smartMoneyRule: config.sureThing.smartMoneyRule,
      },
      updatedAt: state.sureThings?.updatedAt || 0,
      gated: state.sureThings?.gated || [],
      all: state.sureThings?.all || [],
      placed: (state.sureThingTrades || []).slice(-50).reverse(),
    });
  });

  app.get('/api/hit-rate', async (_req, res) => {
    const state = await loadState();
    const wallets = state.hitRate?.wallets || {};
    const rows = Object.entries(wallets)
      .map(([wallet, stats]) => ({ wallet, ...stats }))
      .filter((r) => r.total >= 3)
      .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0) || b.total - a.total)
      .slice(0, 50)
      .map((r) => ({
        ...r,
        username: state.pool?.[r.wallet]?.username || null,
      }));
    res.json({
      updatedAt: state.hitRateUpdatedAt || 0,
      totalPositions: state.hitRate?.positions?.length || 0,
      resolvedPositions: (state.hitRate?.positions || []).filter((p) => p.resolved).length,
      rows,
    });
  });

  // Bind to 0.0.0.0 so Railway / Render / Fly health checks can reach us.
  app.listen(config.dashboard.port, '0.0.0.0', () => {
    log.info(`dashboard listening on port ${config.dashboard.port}`);
  });
}
