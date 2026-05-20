import type { HeadsUpsRouterDeps } from '@forma360/api';
import { sendTemplatedEmail } from './email';

export const headsUpsDeps: HeadsUpsRouterDeps = {
  sendEmail: sendTemplatedEmail,
};
