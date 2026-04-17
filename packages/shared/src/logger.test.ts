import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('returns a pino instance with the requested level', () => {
    const logger = createLogger({ service: 'test', level: 'warn', nodeEnv: 'production' });
    expect(logger.level).toBe('warn');
  });

  it('emits the service field on every log line', () => {
    const logger = createLogger({ service: 'backup-worker', nodeEnv: 'production' });
    expect((logger.bindings() as { service?: string }).service).toBe('backup-worker');
  });

  it('defaults to info level', () => {
    const logger = createLogger({ service: 'api', nodeEnv: 'production' });
    expect(logger.level).toBe('info');
  });

  it('child loggers inherit and extend bindings', () => {
    const logger = createLogger({ service: 'api', nodeEnv: 'production' });
    const requestLogger = logger.child({ request_id: 'req-123' });
    const bindings = requestLogger.bindings() as { service?: string; request_id?: string };
    expect(bindings.service).toBe('api');
    expect(bindings.request_id).toBe('req-123');
  });
});
