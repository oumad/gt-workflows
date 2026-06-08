/**
 * Minimal pure-Node ZIP encoder (DEFLATE compression).
 *
 * Built directly against the PKZIP APPNOTE so we don't pull a transitive
 * dep tree for what is essentially: walk folder → deflate each file → wrap
 * each in a local header → emit a central directory + EOCD. The output
 * unzips cleanly with macOS Archive Utility, Windows Explorer, 7-Zip,
 * `unzip`, and Python's `zipfile`.
 *
 * Limits (none likely to bite for workflow folders):
 *   - ZIP64 not implemented → individual files capped at ~4 GiB
 *   - Entries are simple files only; symlinks are followed by readFileSync
 *   - Filenames are stored as UTF-8 with the language-encoding flag set
 */

import { deflateRawSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/* CRC-32 (IEEE 802.3 polynomial) — table built once at module load. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0
  }
  return (c ^ 0xffffffff) >>> 0
}

/* DOS date/time encoding (mtime). */
function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear())
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    (Math.floor(d.getSeconds() / 2) & 0x1f)
  const date =
    (((y - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

type ZipEntry = { name: string; data: Buffer; mtime: Date }

function collectFiles(baseDir: string, dir: string = baseDir): ZipEntry[] {
  const out: ZipEntry[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectFiles(baseDir, abs))
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const data = readFileSync(abs)
      const rel = relative(baseDir, abs).split(sep).join('/') // ZIP uses '/'
      const mtime = statSync(abs).mtime
      out.push({ name: rel, data, mtime })
    }
  }
  return out
}

/**
 * Build a ZIP archive from a directory tree.
 *
 *   zipDirectory('/srv/workflows/my-wf', 'my-wf')
 *
 * places every file under a `my-wf/` prefix inside the archive, so the user
 * gets a single top-level folder when they extract. Pass `''` for a flat zip.
 */
export function zipDirectory(dir: string, archiveRoot: string = ''): Buffer {
  const entries = collectFiles(dir)
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = archiveRoot ? `${archiveRoot}/${entry.name}` : entry.name
    const nameBuf = Buffer.from(name, 'utf-8')
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)
    const { time, date } = dosDateTime(entry.mtime)

    // Local file header
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: bit 11 = UTF-8 names
    local.writeUInt16LE(8, 8) // compression: deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18) // compressed size
    local.writeUInt32LE(entry.data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length

    localChunks.push(local, nameBuf, compressed)

    // Central directory entry
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // signature
    central.writeUInt16LE(0x031e, 4) // version made by (3=unix, 30=3.0)
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8) // flags: UTF-8
    central.writeUInt16LE(8, 10) // compression
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // external attrs: regular file 0644
    central.writeUInt32LE(offset, 42) // local header offset

    centralChunks.push(central, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }

  // End of central directory
  const centralSize = centralChunks.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with central
  eocd.writeUInt16LE(entries.length, 8) // entries on disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(centralSize, 12) // central dir size
  eocd.writeUInt32LE(offset, 16) // central dir offset
  eocd.writeUInt16LE(0, 20) // archive comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd])
}
