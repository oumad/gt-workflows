/**
 * Repository for the credentials + credential_servers tables.
 *
 * Owns every DB call for this resource — nothing above this layer should be
 * importing drizzle directly for credentials. Methods return rows / null
 * exactly as drizzle produces them; mapping to wire DTOs is the service's
 * job (so the repository stays useful for non-HTTP callers too).
 */
import { eq } from 'drizzle-orm'
import { db, credentials, credentialServers } from '../db/index.js'
import type { Credential } from '../db/schema.js'

export async function findAll(): Promise<Credential[]> {
  return db.query.credentials.findMany({
    orderBy: (cr, { asc }) => asc(cr.name),
  })
}

export async function findById(id: string): Promise<Credential | undefined> {
  return db.query.credentials.findFirst({
    where: (cr, { eq }) => eq(cr.id, id),
  })
}

/** Returns `credentialId → serverId[]` for every link in the junction table. */
export async function loadServerIdsByCredential(): Promise<Map<string, string[]>> {
  const links = await db.select().from(credentialServers)
  const m = new Map<string, string[]>()
  for (const l of links) {
    const list = m.get(l.credentialId) ?? []
    list.push(l.serverId)
    m.set(l.credentialId, list)
  }
  return m
}

export async function insert(
  values: typeof credentials.$inferInsert,
): Promise<Credential | undefined> {
  const [row] = await db.insert(credentials).values(values).returning()
  return row
}

export async function update(
  id: string,
  values: Partial<typeof credentials.$inferInsert>,
): Promise<void> {
  await db.update(credentials).set(values).where(eq(credentials.id, id))
}

export async function remove(id: string): Promise<boolean> {
  const rows = await db
    .delete(credentials)
    .where(eq(credentials.id, id))
    .returning({ id: credentials.id })
  return rows.length > 0
}

/** Replace every link for one credential with the given set of server ids.
 *  `serverIds = []` clears all links. */
export async function replaceServerLinks(credentialId: string, serverIds: string[]): Promise<void> {
  await db.delete(credentialServers).where(eq(credentialServers.credentialId, credentialId))
  if (serverIds.length === 0) return
  await db
    .insert(credentialServers)
    .values(serverIds.map((sid) => ({ credentialId, serverId: sid })))
    .onConflictDoNothing()
}

/** Return the first credential linked to `serverId`, or `undefined` when no
 *  link exists. Used by the RDP-connect endpoint to resolve which login to
 *  use for a given host. When multiple credentials link to the same server,
 *  the most recently updated one wins — a deterministic tiebreaker so the
 *  feature behaves predictably without exposing a credential picker. */
export async function findCredentialForServer(serverId: string): Promise<Credential | undefined> {
  const link = await db.query.credentialServers.findFirst({
    where: (cs, { eq }) => eq(cs.serverId, serverId),
  })
  if (!link) return undefined
  return db.query.credentials.findFirst({
    where: (cr, { eq }) => eq(cr.id, link.credentialId),
  })
}
