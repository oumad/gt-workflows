/**
 * Apply pending Drizzle migrations on startup.
 *
 * Replaces the previous `push.ts` (which shelled out to `drizzle-kit push
 * --force` and applied schema-diff DDL). That approach was unreviewable —
 * any schema change in schema.ts landed at the next boot, including
 * destructive ones, with no PR history.
 *
 * New flow:
 *   1. Author edits src/db/schema.ts.
 *   2. `npm run db:generate` produces a numbered SQL file in api/drizzle/.
 *   3. The file is committed + reviewed in the PR.
 *   4. On boot we call migrate() below, which:
 *        - Creates a `__drizzle_migrations` tracking table if it doesn't
 *          exist (a single hash per applied migration).
 *        - Looks up which migrations have already run.
 *        - Applies any new ones in lexical/timestamp order, in a
 *          transaction.
 *      Idempotent — boots after the first do nothing.
 *
 * Why a separate connection pool: the long-lived app pool (services/db/index)
 * uses prepare:false + max:15 — fine for the app but the migrator wants a
 * single connection that can run DDL outside the app pool's prepared-
 * statement contract. We open a 1-connection pool just for migration and
 * close it before the app pool comes up.
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config/index.js'

/** Find the drizzle/ folder relative to this file. Works for both:
 *   - Dev (`tsx watch src/index.ts`):  ../../drizzle  (from src/db/migrate.ts)
 *   - Prod (`node dist/index.js`):     ../../drizzle  (from dist/db/migrate.js)
 *  Both layouts put `dist`/`src` one level under the api package root, so
 *  walking up twice lands at the package root where drizzle/ lives. */
function findMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../drizzle'),
    resolve(here, '../../../drizzle'),
    resolve(process.cwd(), 'drizzle'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // Fall through to the conventional path so the migrator's error is clearer.
  return resolve(process.cwd(), 'drizzle')
}

export async function applyMigrations(): Promise<void> {
  const folder = findMigrationsFolder()
  console.log(`[migrate] applying from ${folder}…`)

  // Single-connection pool — migrate() will use it for the duration and we
  // explicitly close it before returning so the app pool can take over on
  // the same DATABASE_URL without contention.
  const client = postgres(config.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  })
  const db = drizzle(client)
  try {
    await migrate(db, { migrationsFolder: folder })
    console.log('[migrate] up to date')
  } finally {
    await client.end({ timeout: 5 })
  }
}
