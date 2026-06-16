import type { HeadsUpsRouterDeps } from '@forma360/api';
import { env } from './env';
import { sendTemplatedEmail } from './email';

export const headsUpsDeps: HeadsUpsRouterDeps = {
  sendEmail: sendTemplatedEmail,
  appUrl: env.APP_URL,
};
