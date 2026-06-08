# Database migrations

Authored .sql migration files produced by `drizzle-kit generate` against
[`../src/db/schema.ts`](../src/db/schema.ts). Applied automatically at API
startup by [`../src/db/migrate.ts`](../src/db/migrate.ts).

## Authoring a schema change

```bash
# 1. Edit api/src/db/schema.ts.
# 2. Generate the SQL:
cd api
npm run db:generate

# 3. Review the new file under api/drizzle/. Commit BOTH:
#      - The .sql file
#      - The updated meta/_journal.json and meta/####_snapshot.json
#    Migration generation is deterministic; the same schema state always
#    produces the same output, so a reviewer can re-run db:generate locally
#    to confirm.

# 4. Optional: rename the auto-generated tag to something more descriptive
#    than `0001_curious_robin.sql`. If you do, also update the matching
#    `tag` field in meta/_journal.json — drizzle-kit looks it up by tag,
#    not by filename, so the two MUST agree.
```

## Apply migrations

**At runtime** — the API does this automatically on startup via
`applyMigrations()` in `src/db/migrate.ts`. No action needed in deployment.
The first boot creates the `__drizzle_migrations` tracking table; subsequent
boots only apply migrations whose hash isn't recorded there yet.

**Manually** (e.g. CI seed jobs, local DB reset):

```bash
cd api
DATABASE_URL=postgresql://... npm run db:migrate
```

## Other commands

```bash
npm run db:studio   # Drizzle Studio in the browser — view + edit data
npm run db:check    # Verify migrations are consistent with snapshots
```

## What NOT to do

- **Don't use `db:push`** (`drizzle-kit push`) outside throwaway local
  experiments. The script is renamed `_db:push:DANGEROUS` in package.json
  to make this obvious. Push applies schema diffs WITHOUT generating a
  reviewable migration, which is exactly the problem the migrations
  workflow exists to prevent.
- **Don't hand-edit applied migration files.** Once a migration is
  committed to main and applied to any environment, the SQL is permanent
  history. Fix mistakes with a follow-up migration.
- **Don't reorder migrations.** Drizzle hashes the migration list; changing
  the order or content of an already-applied file makes the runtime refuse
  to apply newer ones.

## How rollback works

Drizzle doesn't generate down-migrations. To revert:

1. Write a **new** migration that undoes the change you want to roll back.
2. Generate / commit / deploy it through the normal flow.

If a migration causes catastrophic damage and the system is unusable,
restore the DB from the most recent `pg_dump` backup (see the prod runbook)
and then deploy the corrected migration.
