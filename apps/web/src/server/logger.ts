import { createLogger } from '@forma360/shared/logger';
import { env } from './env';

export const logger = createLogger({
  service: 'web',
  level: env.LOG_LEVEL,
  nodeEnv: env.NODE_ENV,
});
