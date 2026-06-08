/**
 * drizzle-kit config — used by the CLI commands `db:generate`, `db:migrate`,
 * and `db:studio` at dev/CI time.
 *
 * `out: './drizzle'` puts generated migration .sql files at the api package
 * root (not under src/) so they're easy to find in PR reviews and the build
 * doesn't compile them. The runtime image copies that whole folder into
 * /app/drizzle and the in-process migrator reads from it on boot.
 *
 * `strict: true` makes drizzle-kit prompt before destructive changes when
 * generating; we want loud warnings so we don't accidentally ship a DROP.
 */
import { defineConfig } from 'drizzle-kit'
import { loadEnvFile } from 'node:process'

try {
  loadEnvFile('.env')
} catch {
  /* no .env locally — env vars come from the shell */
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
  verbose: true,
  strict: true,
})
