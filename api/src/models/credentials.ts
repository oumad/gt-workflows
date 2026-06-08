/**
 * Wire-format types for the credentials resource.
 *
 * Shapes returned to the client mirror the DB row minus the encrypted
 * password column — we expose `hasPassword: boolean` instead so the UI
 * can tell "set" vs "not set" without ever leaking ciphertext.
 */

export type CredentialDto = {
  id: string
  name: string
  domain: string
  username: string
  description: string | null
  hasPassword: boolean
  serverIds: string[]
  createdAt: string
  updatedAt: string
}

export type CredentialsListResponse = {
  items: CredentialDto[]
  encryption: { available: boolean }
}
