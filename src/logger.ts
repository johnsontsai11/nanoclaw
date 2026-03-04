import pino from 'pino';

// Decouple from config.js to avoid circular dependency
const DEFAULT_LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level: DEFAULT_LOG_LEVEL,
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
