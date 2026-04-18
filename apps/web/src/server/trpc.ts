import { createContextFactory } from '@forma360/api/context';
import { auth } from './auth';
import { db } from './db';
import { logger } from './logger';

export const createContext = createContextFactory({ db, auth, logger });
