/* AES-256-GCM envelope encryption for at-rest secrets (e.g. credential
 * passwords). Single master key, read once at module load time from
 * `CREDENTIALS_MASTER_KEY` — a base64-encoded 32-byte buffer.
 *
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Threat model: a database snapshot leak shouldn't yield plaintext
 * passwords without also leaking the master key. The master key lives
 * outside the DB (env var / Docker secret), so the two compromises are
 * decoupled.
 *
 * Storage format (one self-describing string per ciphertext):
 *   v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>
 *
 * `v1` is reserved for future algorithm rotation — decryption checks the
 * prefix so an old ciphertext can keep being read while new writes use a
 * newer scheme. */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const KEY_BYTES = 32 // AES-256
const IV_BYTES = 12 // GCM-recommended IV length

let _key: Buffer | null = null

/** Resolve and cache the master key. Throws on first call when the env var
 *  isn't set so the caller (an HTTP handler) can return a clear 500. */
function key(): Buffer {
  if (_key) return _key
  const raw = process.env['CREDENTIALS_MASTER_KEY']
  if (!raw) {
    throw new Error(
      'CREDENTIALS_MASTER_KEY env var is required. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== KEY_BYTES) {
    throw new Error(`CREDENTIALS_MASTER_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length})`)
  }
  _key = buf
  return buf
}

/** Encrypt a UTF-8 string into the v1 envelope format. */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

/** Decrypt a v1 envelope back to a UTF-8 string. Throws on tampering
 *  (GCM auth-tag mismatch) or unsupported version prefix. */
export function decrypt(blob: string): string {
  const parts = blob.split(':')
  if (parts.length !== 4) throw new Error('Malformed ciphertext (expected 4 parts)')
  const [v, ivB64, tagB64, encB64] = parts as [string, string, string, string]
  if (v !== 'v1') throw new Error(`Unsupported ciphertext version: ${v}`)
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const enc = Buffer.from(encB64, 'base64')
  const decipher = createDecipheriv(ALGO, key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

/** True when an env var is set and well-formed — handy for /health-style
 *  endpoints that want to surface "credentials feature enabled". */
export function isEncryptionAvailable(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}
