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
export * from './inspections';
export * from './actions';
export * from './schedules';
export * from './invitations';
export * from './issues';
export * from './heads-ups';
export * from './assets';
export * from './maintenancePrograms';
export * from './documents';
export * from './site-media';
export * from './site-plans';
export * from './contractors';
export * from './ai';
export * from './reference-counters';
export * from './risk-assessments';
export * from './coshh';
export * from './permits';
export * from './fire-safety';
export * from './incidents';
export * from './rams';
