/**
 * Drizzle schema barrel.
 *
 * Explicitly re-exports every table so drizzle-kit can discover them when
 * generating migrations. New tables are added here as they're introduced.
 */
export * from './tenants.js';
