import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { config } from '../config/index.js'
import * as schema from './schema.js'

// Single connection pool shared across the entire process.
// max: 15 — sync uses up to 3 connections in parallel (WF + LoRA + health),
// and HTTP handlers can hold ≥1 each; 5 was easily saturated under load and
// would surface as "write CONNECT_TIMEOUT" from postgres-js.
const client = postgres(config.DATABASE_URL, {
  max: 15,
  idle_timeout: 120, // seconds — keep connections alive longer
  max_lifetime: 3600, // seconds — hard-recycle every hour
  connect_timeout: 30, // seconds — Docker Windows networking can be slow
  // TLS only when DATABASE_URL asks for it (?sslmode=require / verify-*) —
  // the compose postgres speaks no TLS, while managed providers demand it.
  ssl: /[?&]sslmode=(require|prefer|verify-ca|verify-full)/i.test(config.DATABASE_URL),
  prepare: false, // skip per-connection prepared statement round-trips
  onnotice: () => {}, // silence NOTICE messages in dev
})

export const db = drizzle(client, { schema })
export { client }

export type DB = typeof db

// Re-export everything so route files only need to import from here
export * from './schema.js'
// Named convenience re-exports so callers can do: import { db, users, clients, jobs } from '../db/index.js'
