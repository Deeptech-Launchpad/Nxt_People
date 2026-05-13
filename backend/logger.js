/**
 * Application logger.
 *
 * Production: emits JSON to stdout (ingestable by Loki / CloudWatch / etc.).
 * Development: pretty-printed colour output via pino-pretty.
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info({ employeeId }, 'check-in succeeded');
 *   logger.error({ err }, 'failed to send reset email');
 */
const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  // Redact obvious sensitive fields if anyone ever logs an entire request.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.api_key',
    ],
    censor: '[redacted]',
  },
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});

module.exports = logger;
