#!/usr/bin/env node
import { log } from './log.js';

const HELP = `
pm-tracker <command>

Commands:
  leaderboard            Compute and print top traders by PnL across all windows.
  watch                  Long-running daemon: refresh leaderboards, poll trades,
                         send notifications, optionally mirror trades.
  dashboard              Serve the web dashboard (read-only view of state.json).
  seed --wallets a,b,c   Append wallet addresses to data/candidates.json.
  help                   Show this message.

Configure via .env (copy .env.example).
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
