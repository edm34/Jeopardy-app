#!/usr/bin/env node
import { log } from './log.js';

const HELP = `
pm-tracker <command>

Commands:
  leaderboard [--fast]   Auto-discover top Polymarket traders from lb-api,
                         then print the top 10 PnL leaders across 30d / 60d /
                         90d / 6m / 12m / all-time. --fast skips the local
                         compute and prints only 30d + all-time.
  watch                  Long-running daemon: keeps the trader pool fresh,
                         polls each top-N wallet's trades, sends WhatsApp
                         alerts, optionally mirrors trades on Polymarket.
  dashboard              Web dashboard at http://localhost:8787.
  seed --wallets a,b,c   (Optional) Pin extra wallets that should always
                         live in the pool, even if they fall out of lb-api's
                         top 100s.
  help                   Show this message.

No manual setup is required for tracking. Configure WhatsApp / auto-execute
in .env (copy .env.example).
`;

async function main() {
  const [, , cmd = 'help', ...rest] = process.argv;
  switch (cmd) {
    case 'leaderboard': {
      const { runLeaderboard } = await import('./cli/leaderboard.js');
      await runLeaderboard();
      break;
    }
    case 'watch': {
      const { runWatch } = await import('./cli/watch.js');
      await runWatch();
      break;
    }
    case 'dashboard': {
      const { runDashboard } = await import('./dashboard/server.js');
      runDashboard();
      break;
    }
    case 'seed': {
      const { runSeed } = await import('./cli/seed.js');
      await runSeed(rest);
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.log(`unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
