/**
 * Safety check for the workflows-repo guard in services/git.ts. When
 * WORKFLOWS_DIR sits inside a git repo that is NOT the dedicated WS repo
 * (e.g. CM's own checkout — no .githooks/server-urls.mjs at the root), CM must
 * refuse every git op and never point core.hooksPath at that parent repo. Run
 * (DB/Redis/JWT dummies required by config):
 *   DATABASE_URL=x REDIS_URL=x JWT_SECRET=<32+ch> npx tsx scripts/check-git-guard.ts
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A "CM-like" parent repo with a nested workflows/ folder but NO filter marker.
const parent = mkdtempSync(join(tmpdir(), 'cm-like-'))
const g = (...args: string[]) => execFileSync('git', args, { cwd: parent, encoding: 'utf-8' })
g('init', '-q')
g('config', 'user.email', 't@t')
g('config', 'user.name', 't')
const wf = join(parent, 'workflows')
mkdirSync(wf, { recursive: true })
writeFileSync(join(wf, 'keep.txt'), 'x')
g('add', '-A')
g('commit', '-qm', 'init')

process.env.GIT_WORKFLOWS_ENABLED = 'true'
process.env.WORKFLOWS_DIR = wf // resolves toplevel to `parent` (the CM-like repo)

const git = await import('../src/services/git.js')

try {
  // status() must report the refusal, not silently treat the parent as the repo
  const st = await git.status()
  assert.equal(st.enabled, true)
  assert.ok(
    st.error && /not a configured workflows git repo/i.test(st.error),
    `status should refuse the parent repo, got: ${JSON.stringify(st)}`,
  )

  // publish() must throw before ever touching the parent repo's config
  await assert.rejects(
    () => git.publish(),
    (e: Error) => /not a configured workflows git repo/i.test(e.message),
    'publish should refuse the parent repo',
  )

  // CRITICAL: the parent repo's git config was never touched
  let hooksPath = ''
  try {
    hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: parent,
      encoding: 'utf-8',
    }).trim()
  } catch {
    hooksPath = '' // unset → git config exits non-zero
  }
  assert.equal(hooksPath, '', 'core.hooksPath must NOT be configured on the CM-like parent repo')

  console.log('check-git-guard: OK')
} finally {
  rmSync(parent, { recursive: true, force: true })
}
