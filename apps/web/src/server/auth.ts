import { createAuth } from '@forma360/auth/server';
import { isPasswordBreached } from '@forma360/shared/password';
import { db } from './db';
import { sendEmail, sendTemplatedEmail } from './email';
import { env } from './env';
import { logger } from './logger';
import { redis } from './redis';

export const auth = createAuth({
  db,
  redis,
  sendEmail: async (email) => {
    await sendEmail(email);
  },
  sendTemplatedEmail,
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  nodeEnv: env.NODE_ENV,
  checkPasswordBreached: (password) =>
    isPasswordBreached(password, { logger: logger.child({ component: 'password-breach' }) }),
});
