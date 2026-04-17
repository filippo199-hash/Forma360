import { createDb } from '@forma360/db/client';
import { env } from './env';

const { pool, db } = createDb(env.DATABASE_URL);

export { db, pool };
