/**
 * Business logic for credentials. Anything the route handler used to "do"
 * (encrypt the password, replace server links, project a row to a DTO) lives
 * here so the route is just an HTTP-to-service adapter.
 *
 * Errors are thrown as `HttpError` from lib/httpError; the route translates
 * via `httpErrorResponse()`. This keeps HTTP concerns out of the service and
 * lets us reuse it from non-HTTP callers (CLI scripts, future workers).
 */
import * as repo from '../repositories/credentials.js'
import { encrypt, isEncryptionAvailable } from '../lib/crypto.js'
import { HttpError, notFound, internalError } from '../lib/httpError.js'
import type { CredentialDto, CredentialsListResponse } from '../models/credentials.js'
import type { CreateCredentialInput, PatchCredentialInput } from '../validators/credentials.js'
import type { Credential } from '../db/schema.js'

function toDto(row: Credential, serverIds: string[]): CredentialDto {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    username: row.username,
    description: row.description,
    hasPassword: !!row.passwordEnc,
    serverIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function list(): Promise<CredentialsListResponse> {
  const [rows, links] = await Promise.all([repo.findAll(), repo.loadServerIdsByCredential()])
  return {
    items: rows.map((r) => toDto(r, links.get(r.id) ?? [])),
    encryption: { available: isEncryptionAvailable() },
  }
}

export async function create(input: CreateCredentialInput): Promise<CredentialDto> {
  let passwordEnc: string
  try {
    passwordEnc = encrypt(input.password)
  } catch (err) {
    throw new HttpError(
      500,
      'encryption_failed',
      err instanceof Error ? err.message : 'Encryption failed',
    )
  }

  const row = await repo.insert({
    name: input.name.trim(),
    domain: input.domain.trim(),
    username: input.username.trim(),
    passwordEnc,
    description: input.description ?? null,
  })
  if (!row) throw internalError('Insert failed')

  if (input.serverIds.length > 0) {
    await repo.replaceServerLinks(row.id, input.serverIds)
  }

  return toDto(row, input.serverIds)
}

export async function patch(id: string, input: PatchCredentialInput): Promise<void> {
  const existing = await repo.findById(id)
  if (!existing) throw notFound('Credential not found')

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) updates['name'] = input.name.trim()
  if (input.domain !== undefined) updates['domain'] = input.domain.trim()
  if (input.username !== undefined) updates['username'] = input.username.trim()
  if (input.description !== undefined) updates['description'] = input.description
  if (input.password !== undefined) {
    try {
      updates['passwordEnc'] = encrypt(input.password)
    } catch (err) {
      throw new HttpError(
        500,
        'encryption_failed',
        err instanceof Error ? err.message : 'Encryption failed',
      )
    }
  }
  await repo.update(id, updates)

  if (input.serverIds !== undefined) {
    await repo.replaceServerLinks(id, input.serverIds)
  }
}

export async function remove(id: string): Promise<void> {
  const ok = await repo.remove(id)
  if (!ok) throw notFound('Credential not found')
}
