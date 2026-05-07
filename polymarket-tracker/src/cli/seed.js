import { loadCandidates, saveCandidates } from '../store.js';
import { log } from '../log.js';

export async function runSeed(args) {
  const idx = args.indexOf('--wallets');
  if (idx === -1 || !args[idx + 1]) {
    console.log('usage: pm-tracker seed --wallets 0xabc...,0xdef...');
    process.exit(1);
  }
  const incoming = args[idx + 1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w));
  const existing = await loadCandidates();
  const merged = Array.from(new Set([...existing, ...incoming]));
  await saveCandidates(merged);
  log.info(`candidates: ${existing.length} -> ${merged.length} (added ${merged.length - existing.length})`);
}
