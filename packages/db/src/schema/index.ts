/**
 * Drizzle schema barrel.
 *
 * Explicitly re-exports every table so drizzle-kit can discover them when
 * generating migrations and so the database client gets full typed schema.
 */
export * from './tenants';
export * from './permissions';
export * from './auth';
export * from './users';
export * from './groups';
export * from './sites';
export * from './accessRules';
export * from './templates';
export * from './globalResponseSets';
