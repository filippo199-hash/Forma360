import { createAuth } from '@forma360/auth/server';
import { db } from './db';
import { sendEmail } from './email';
import { env } from './env';
import { redis } from './redis';

export const auth = createAuth({
  db,
  redis,
  sendEmail: async (email) => {
    await sendEmail(email);
  },
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  nodeEnv: env.NODE_ENV,
});
