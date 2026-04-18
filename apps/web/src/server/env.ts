/**
 * Boot-time env parse. Importing this module forces the env to validate
 * before any request is served. If anything is missing or invalid the
 * process exits with a clear error listing every failing variable.
 */
import { parseServerEnv } from '@forma360/shared/env';

export const env = parseServerEnv();
