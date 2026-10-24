import pino from 'pino';
import { pinoHttp } from 'pino-http';
import env from './env.js';

// Sensitive keys and nested paths to redact
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["supabase-key"]',
  'res.headers["set-cookie"]',
  'req.body.token',
  'req.body.access_token',
  'req.body.refresh_token',
  'req.body.password',
  'req.body.client_secret',
  'req.body.code',
  '*.authorization',
  '*.access_token',
  '*.refresh_token',
  '*.secret',
  '*.client_secret',
  '*.token',
  '*.password'
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]'
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode
      };
    },
    err: pino.stdSerializers.err
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: env.NODE_ENV !== 'test',
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  }
});

export default logger;
