import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

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

  it('attaches no transport in production, so no worker thread is spawned', () => {
    // The pretty transport runs in a worker thread via `thread-stream`. A
    // production process must never start one: it costs a thread, and when
    // the host bundles the code the worker's file path stops resolving —
    // which is exactly how the Next server lost every log line and threw
    // `the worker thread exited` at boot.
    const logger = createLogger({ service: 'api', nodeEnv: 'production' });
    // pino's stream symbol is a documented export; there is no public
    // accessor for the destination, and the destination is the thing under
    // test.
    const stream = (logger as unknown as Record<symbol, unknown>)[pino.symbols.streamSym];
    expect(stream).toBeDefined();
    expect('worker' in Object(stream)).toBe(false);
  });
});
