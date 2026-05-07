// Combined entrypoint for hosted deploys (Railway, Render, Fly, etc.).
// Boots the dashboard HTTP server first (so the platform's healthcheck binds
// quickly), then enters the watch loop in the same process. Both share
// data/state.json on the local filesystem.

import { log } from '../log.js';
import { runDashboard } from '../dashboard/server.js';
import { runWatch } from './watch.js';

export async function runStart() {
  runDashboard();
  // Don't await runWatch's outer promise — it never resolves. Surface any
  // crash so the platform restarts the container.
  runWatch().catch((err) => {
    log.error(`watch loop crashed: ${err.stack || err.message}`);
    process.exit(1);
  });
}
