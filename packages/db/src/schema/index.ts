/**
 * Drizzle schema barrel.
 *
 * Explicitly re-exports every table so drizzle-kit can discover them when
 * generating migrations and so the database client gets full typed schema.
 */
export * from './tenants';
export * from './auth';
