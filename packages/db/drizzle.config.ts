import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 *
 * `schema`     — glob matching every table file. Drizzle introspects these to
 *                generate migrations.
 * `out`        — where generated migrations land. Committed to git; never
 *                edited once merged (ground rule: forward-only migrations).
 * `dialect`    — `postgresql` (we pin Postgres 16 in Railway).
 *
 * The CLI reads DATABASE_URL from process.env at runtime for `migrate` and
 * `studio` — generation itself does not need a live database.
 */
export default defineConfig({
  // Explicit list of table files. Keep in sync as tables are added in Phase 1+.
  // The barrel `./src/schema/index.ts` is deliberately excluded because
  // drizzle-kit loads schema files via its own CJS resolver, which cannot
  // follow the `.js` extensions that tsc's NodeNext mode requires.
  schema: [
    './src/schema/tenants.ts',
    './src/schema/permissions.ts',
    './src/schema/auth.ts',
    './src/schema/users.ts',
    './src/schema/groups.ts',
    './src/schema/sites.ts',
    './src/schema/accessRules.ts',
    './src/schema/templates.ts',
    './src/schema/globalResponseSets.ts',
    './src/schema/inspections.ts',
    './src/schema/actions.ts',
    './src/schema/schedules.ts',
  ],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/forma360',
  },
  strict: true,
  verbose: true,
});
