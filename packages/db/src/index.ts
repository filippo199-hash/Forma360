/**
 * @forma360/db — public entry point.
 *
 * Re-exports the schema + client helpers. Consumers should import from the
 * subpath exports (`@forma360/db/client`, `@forma360/db/schema`) where
 * possible to keep bundle boundaries explicit.
 */
export * from './schema/index.js';
export { createDb, db, getDb, type Database } from './client.js';
