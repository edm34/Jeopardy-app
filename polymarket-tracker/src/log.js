import { config } from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const should = (level) => LEVELS[level] <= (LEVELS[config.log.level] ?? 2);

const ts = () => new Date().toISOString();

const fmt = (level, args) =>
  `${ts()} [${level.toUpperCase()}] ` +
  args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');

export const log = {
  error: (...a) => should('error') && console.error(fmt('error', a)),
  warn: (...a) => should('warn') && console.warn(fmt('warn', a)),
  info: (...a) => should('info') && console.log(fmt('info', a)),
  debug: (...a) => should('debug') && console.log(fmt('debug', a)),
};
