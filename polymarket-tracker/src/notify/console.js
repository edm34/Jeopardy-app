import { log } from '../log.js';

export function consoleNotifier() {
  return {
    name: 'console',
    async send(text) {
      log.info(`[ALERT] ${text}`);
    },
  };
}
