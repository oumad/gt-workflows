# Git-managed workflows — operator guide

Workflows live as folders on disk (`WORKFLOWS_DIR`). With this feature on, that
directory is a **git repo** shared across environments, and per-env server URLs
are kept out of git via **globalEnv tokens**. This guide covers turning it on,
the branch model, tokens, the one-time migration, and the repo-side guard.

## Enabling

Off by default — set these on the **api** container (see `api/.env.example`):

| Var | Meaning |
| --- | --- |
| `GIT_WORKFLOWS_ENABLED` | Master flag. `false` → pure-FS, none of the below is read. |
| `GIT_REMOTE` | Tokenless remote URL, e.g. `https://git.host/group/workflows.git`. |
| `GIT_TOKEN` | Scoped push token. Injected into the remote at call time as `oauth2:<token>@…`, **never** written to `.git/config`. One token per scope. |
| `GIT_WORK_BRANCH` | Default `test`. Where agents/MCP and the app publish. |
| `GIT_DEFAULT_BRANCH` | Default `main`. Promotion target; agents can't push here. |
| `GIT_STAGING_BRANCH` | Optional, e.g. `preprod` (3-branch flow). |
| `WS_CONFIG_PATH` | Path to Workflow Studio's config file holding `workflowStudio.globalEnv`. External to the repo, per-env. |

`WORKFLOWS_DIR` must be a git checkout of `GIT_REMOTE` with the branch set
(`test`/`main`/`preprod`) already created locally. `git` is in the api image.

## Branch model

A small fixed set: `test → (preprod) → main`. **Agents are pinned to `test`** —
the MCP `switch_branch` tool refuses anything else and `publish` only ever
targets the work branch, so an agent can never reach `main`/`preprod`. Humans
promote between branches through the git host (merge request), then **Update**
in the app to pull. Publishing is squash + fast-forward-only; it never merges.

## Save / Update / Publish (no git vocabulary surfaced)

- **Save** — writes the workflow's files locally (your working copy).
- **Update** — pulls the latest. Conflict-free and recoverable: your changed
  workflows are snapshotted to History first, the tree is reset to the latest,
  then your edits to files the remote didn't touch are restored. Never merges.
- **Publish** — validates, squashes your changes into one commit, fast-forward
  pushes. Refused when you're behind — the banner shows **Update** (not Publish)
  in that case: pull the latest (your version stays in History), or fix it with
  git directly.
- **Discard** — throw away all local changes (snapshotted to History first),
  back to the last commit. Doesn't pull.

There is **no edit lock**: workflows are files edited concurrently from CM, MCP,
and the git repo directly. Two people editing the exact same workflow at the
same instant is rare — last save wins, the other refreshes. Conflicts are
prevented at **publish** (refused when behind), not by locking edits.

## Server bindings (globalEnv)

Committed `params.json` never contains a real server URL. It holds either a
`globalEnv.<key>` token or the `127.0.0.1:8188` placeholder. The real URL for
each key lives in `WS_CONFIG_PATH` (`workflowStudio.globalEnv`, a flat
`key → url | url[]` map; an array is a pool). On every Update, missing keys are
**additively** created defaulted to `127.0.0.1:8188` (existing keys are never
touched) — the app then nudges "N workflows need a server". Bind them via the
server picker in the workflow editor.

**serverUrl is env-local.** Git only ever stores the token: on **Publish** any
literal/localhost you set is canonicalized to the workflow's `globalEnv.url_<id>`
(the literal is lifted into this env's gitignored binding, not lost). On
**Update** your pre-pull serverUrl is re-applied from the History snapshot, so
your local server choice (custom URL, localhost, or a different binding) survives
a pull. Point a workflow anywhere locally — it never leaks into git, and a
colleague's pull never clobbers it.

## One-time tokenization migration

Lifts existing literal URLs out of `params.json` into globalEnv:

```bash
# in api/ — dry-run first, always:
npx tsx scripts/migrate-tokenize.ts
# then, with WS_CONFIG_PATH pointing at this env's WS config:
WS_CONFIG_PATH=/path/to/ws-config.json npx tsx scripts/migrate-tokenize.ts --apply
```

For each workflow with a literal real URL it creates a `url_<camelCaseId>` key
(shared across workflows pointing at the same server set) and rewrites the
workflow's `serverUrl` to the token. Localhost placeholders and already-tokenized
refs are left alone. The git diff is the safety net — review before publishing.

## Repo-side guard (Claude-direct path)

The app validates on Publish, but commits made straight to the repo (e.g. an
agent operating on the git checkout) bypass that. `git-hooks/validate-workflows.mjs`
re-checks every `params.json` — rejecting literal non-loopback URLs and invalid
JSON. Wire it as a **pre-receive hook** (self-hosted git) or a **required CI
check + branch protection on `main`/`preprod`** (GitHub). See
[`git-hooks/README.md`](../git-hooks/README.md).
