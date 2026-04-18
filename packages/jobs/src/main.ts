/**
 * Binary entry point for the Railway `worker` service.
 *
 * `pnpm --filter @forma360/jobs start` runs this file via tsx. Registers
 * SIGTERM/SIGINT handlers so Railway's graceful shutdown drains in-flight
 * jobs instead of killing them mid-query.
 */
import { createLogger } from '@forma360/shared/logger';
import * as Sentry from '@sentry/node';
import { initSentry } from './sentry';
import { startWorker } from './worker';

// Sentry initialises before any handler imports so instrumentation wraps
// the BullMQ connection and queue state.
initSentry();

const logger = createLogger({ service: 'worker', level: 'info', nodeEnv: 'production' });

startWorker({ logger })
  .then(({ shutdown }) => {
    const onSignal = (signal: string): void => {
      logger.info({ signal }, '[worker] signal received');
      shutdown()
        .catch((err: unknown) => {
          logger.error({ err }, '[worker] shutdown error');
          Sentry.captureException(err);
        })
        .finally(() => {
          void Sentry.close(2_000).finally(() => process.exit(0));
        });
    };
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
  })
  .catch((err: unknown) => {
    logger.error({ err }, '[worker] failed to boot');
    Sentry.captureException(err);
    process.exitCode = 1;
  });
