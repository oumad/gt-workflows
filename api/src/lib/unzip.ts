/**
 * Minimal pure-Node ZIP decoder — counterpart to lib/zip.ts.
 *
 * Walks the central directory (authoritative sizes, even when local headers
 * defer them to a data descriptor), then inflates each entry. Supports STORE
 * (method 0) and DEFLATE (method 8) — everything our own encoder and the
 * common desktop archivers emit. ZIP64 is not handled (4 GiB cap), which is
 * irrelevant for workflow folders.
 */

import { inflateRawSync } from 'node:zlib'

const SIG_EOCD = 0x06054b50
const SIG_CDIR = 0x02014b50
const SIG_LOCAL = 0x04034b50

/** Decode a ZIP buffer into { entry path → file contents }. Directory
 *  entries (names ending in '/') are skipped. Throws on a malformed archive. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()

  // 1. Locate the End Of Central Directory record — near the tail, after an
  //    optional archive comment, so scan backwards for its signature.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record)')

  const entryCount = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16) // central directory offset

  // 2. Walk the central directory.
  for (let i = 0; i < entryCount; i++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== SIG_CDIR) {
      throw new Error('Corrupt ZIP central directory')
    }
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOff = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf-8', ptr + 46, ptr + 46 + nameLen)
    ptr += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // directory entry — no data

    // 3. Jump to the local header to find where the file data starts (the
    //    local name/extra lengths can differ from the central directory's).
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== SIG_LOCAL) {
      throw new Error(`Corrupt ZIP local header for "${name}"`)
    }
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)

    let data: Buffer
    if (method === 0)
      data = Buffer.from(raw) // STORE
    else if (method === 8)
      data = inflateRawSync(raw) // DEFLATE
    else throw new Error(`Unsupported ZIP compression method ${method} for "${name}"`)

    out.set(name, data)
  }

  return out
}
