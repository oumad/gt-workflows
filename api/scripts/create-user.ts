// Create or update a local user (username + password auth).
// Usage: tsx scripts/create-user.ts --username jdoe --password secret --name "Jane Doe" [--admin]
//
// Run migrations first:
//   psql $DATABASE_URL -f src/db/migrations/0000_init.sql
//   psql $DATABASE_URL -f src/db/migrations/0001_add_password_hash.sql
//   psql $DATABASE_URL -f src/db/migrations/0002_add_username.sql

import 'dotenv/config'
import { parseArgs } from 'node:util'
import { db, users } from '../src/db/index.js'
import { hashPassword } from '../src/lib/password.js'
import { eq } from 'drizzle-orm'

const { values } = parseArgs({
  options: {
    username: { type: 'string'  },
    password: { type: 'string'  },
    name:     { type: 'string'  },
    admin:    { type: 'boolean' },
  },
})

if (!values.username || !values.password || !values.name) {
  console.error('Usage: tsx scripts/create-user.ts --username <username> --password <password> --name <name> [--admin]')
  process.exit(1)
}

const username = values.username.toLowerCase().trim()
const isAdmin  = values.admin ?? false
const hash     = await hashPassword(values.password)

const existing = await db.query.users.findFirst({ where: eq(users.username, username) })

if (existing) {
  await db.update(users)
    .set({ name: values.name, isAdmin, passwordHash: hash, lastSeenAt: new Date() })
    .where(eq(users.username, username))
  console.log(`Updated user: ${username} (admin: ${isAdmin})`)
} else {
  await db.insert(users).values({
    externalId:   `local:${username}`,
    username,
    name:         values.name,
    authType:     'local',
    isAdmin,
    roles:        [],
    passwordHash: hash,
  })
  console.log(`Created user: ${username} (admin: ${isAdmin})`)
}

process.exit(0)
