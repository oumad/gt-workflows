# Workflows-repo guard (install in the WORKFLOWS repo, not coffee-maker)

These files belong in the **workflows GitHub repo** — the standalone repo that
holds the workflow folders. They keep env-specific server URLs out of git and
make each workflow self-managing for **every** client (Coffee Maker, Workflow
Studio, or a plain `git` user). All the logic lives here, in the repo — CM only
*installs* it (sets the local git config) and triggers plain git.

## What's in `.githooks/`

| File | Role |
| --- | --- |
| `server-filter.mjs` | clean/smudge **filter**. clean (→ git): record the real `serverUrl` to the gitignored `workflow-envtable.json` (keyed by the workflow's `metadata.json` id, verbatim) and emit `http://127.0.0.1:8188`. smudge (→ working tree): restore it. So git is always sanitized, the working tree always real, and `git status` stays clean. |
| `wf-hooks.mjs` | id maintenance: every workflow gets a stable `metadata.json` uuid; a filesystem-level duplicate (copied folder) gets a fresh uuid so both stay independent. |
| `validate-workflows.mjs` | the validator (CI + `pre-push`): fails if any committed `serverUrl` isn't the placeholder, and posts Discord when `DISCORD_WEBHOOK_URL` is set. |
| `pre-commit` | ensure ids + dedupe, staged into the commit. |
| `post-merge` / `post-checkout` | ensure ids + dedupe after a pull/checkout (serverUrl restore is automatic via smudge). |
| `pre-push` | local belt: run the validator before pushing. |

## Install in the workflows repo (one-time)

Commit, at the repo root:

1. The whole **`.githooks/`** directory (keep the hook files executable).
2. `.gitattributes` containing:
   ```gitattributes
   params.json filter=cmserver
   ```
3. `.gitignore` containing:
   ```gitignore
   workflow-envtable.json
   ```
4. `validate-workflows.github-actions.yml` → `.github/workflows/validate-workflows.yml`;
   mark the `validate` job a **required status check** and enable **branch
   protection on `main`/`preprod`**. Add a repo secret `DISCORD_WEBHOOK_URL`.

Then **each clone** wires the integration into its local git config (the
definitions are local config, never committed):

```bash
git config core.hooksPath .githooks
git config filter.cmserver.clean  "node .githooks/server-filter.mjs clean %f"
git config filter.cmserver.smudge "node .githooks/server-filter.mjs smudge %f"
git checkout -- .   # re-smudge existing files now that the filter is wired
```

**Coffee Maker does this automatically** (`installGitIntegration`, at boot and
before every git op). A clone that skips it commits real URLs unchanged — which
the CI guard then rejects.

## How the criteria map

- **Stable id / rename / duplicate** — `wf-hooks.mjs` via `pre-commit` +
  `post-merge`/`post-checkout` (and CM's own `reconcileWorkflowIds` for the
  running app). The id lives in the folder, so a rename keeps it.
- **Sanitize on push / restore on pull / no leakage / multiple servers** —
  `server-filter.mjs` (handles a string or an array of servers, literal or
  `<globalEnv.x>`). git only ever stores `http://127.0.0.1:8188`.
- **CI rejection + Discord** — `validate-workflows.mjs`, required check + branch
  protection. Private URLs never appear in the notice (only workflow names).
- **Works via CM / WS / local** — everything above is in the repo, not in CM.

## Local checks

```bash
node .githooks/validate-workflows.mjs .          # exits 1 on any violation
node .githooks/validate-workflows.mjs --selftest
node .githooks/wf-hooks.mjs --selftest
node validate-workflows.test.mjs                 # validator + Discord-format test
node server-filter.test.mjs                      # clean/smudge round-trip
node wf-hooks.test.mjs                            # id stability / rename / dedupe
```
