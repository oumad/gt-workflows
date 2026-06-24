/**
 * seed-workflows.ts
 *
 * Scans the /workflows directory and upserts each folder as a workflow row.
 * Safe to re-run — uses onConflictDoUpdate so it won't duplicate rows.
 *
 * Usage:
 *   npm run seed:workflows
 */

import 'dotenv/config'
import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { db, workflows } from '../src/db/index.js'
import { ensureWorkflowUuid } from '../src/services/workflows.js'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const WORKFLOWS_DIR = resolve(
  process.env['WORKFLOWS_DIR'] ?? join(import.meta.dirname, '../../workflows')
)

if (!existsSync(WORKFLOWS_DIR)) {
  console.error(`[seed] workflows dir not found: ${WORKFLOWS_DIR}`)
  process.exit(1)
}

const entries = readdirSync(WORKFLOWS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'script')

console.log(`[seed] found ${entries.length} workflow folders in ${WORKFLOWS_DIR}`)

let count = 0

for (const entry of entries) {
  const name = entry.name
  const id   = slugify(name)
  const path = join(WORKFLOWS_DIR, name)
  // Mirror the folder's stable metadata.json uuid (mint if absent) into PG.
  const uuid = ensureWorkflowUuid(path)

  await db
    .insert(workflows)
    .values({ id, uuid, name, path, serverIds: [] })
    .onConflictDoUpdate({
      target: workflows.id,
      set: { uuid, name, path, updatedAt: new Date() },
    })

  console.log(`  ${name}`)
  count++
}

console.log(`\n[seed] done — ${count} workflows upserted`)
process.exit(0)
