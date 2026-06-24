# Git-managed workflows — operator guide

Workflows live as folders on disk (`WORKFLOWS_DIR`). With this feature on, that
directory is a **git repo** shared across environments. Per-env server URLs are
kept out of git by a git **clean/smudge filter**: git only ever stores the
`http://127.0.0.1:8188` placeholder, while each env's real bindings live in a
gitignored `workflow-envtable.json`. This guide covers turning it on, the repo
setup, the branch model, and how server bindings work.

## The workflows repo must be its OWN clone

`WORKFLOWS_DIR` must point at a **separate git checkout of the workflows repo**,
not at a folder nested inside Coffee Maker's own checkout. CM refuses to operate
unless the resolved repo carries the committed filter script
(`.githooks/server-filter.mjs`) — this guard stops it from ever configuring the
filter or pushing against the wrong repo (e.g. CM's own checkout). If git status
reports *"WORKFLOWS_DIR is not a configured workflows git repo"*, the directory
isn't a workflows-repo checkout or the repo guard isn't installed (below).

Workflows may live at the repo root or under a **`workflows/` subfolder**; point
`WORKFLOWS_DIR` at wherever the workflow folders are (e.g.
`/srv/cm-workflows/workflows`). CM resolves the repo root + subdir from git and
scopes all operations to that subtree — it never touches the repo's other files.

## Enabling

Off by default — set these on the **api** container (see `api/.env.example`):

| Var | Meaning |
| --- | --- |
| `GIT_WORKFLOWS_ENABLED` | Master flag. `false` → pure-FS, none of the below is read. |
| `GIT_REMOTE` | Tokenless GitHub HTTPS URL of the **workflows** repo, e.g. `https://github.com/<owner>/<repo>.git`. |
| `GIT_TOKEN` | GitHub PAT (**Contents: read/write**). Injected into the remote at call time as `x-access-token:<PAT>@…`, **never** written to `.git/config`. |
| `GIT_WORK_BRANCH` | Default `test`. Where agents/MCP and the app publish. |
| `GIT_DEFAULT_BRANCH` | Default `main`. Promotion target; agents can't push here. |
| `GIT_STAGING_BRANCH` | Optional, e.g. `preprod` (3-branch flow). |
| `WS_CONFIG_PATH` | Workflow Studio's config holding `workflowStudio.globalEnv`. **Read-only** — CM resolves `<globalEnv.key>` expressions against it but never writes it. |

The checkout must have the branches (`test`/`main`/`preprod`) created locally.
`git` is in the api image.

## Repo setup (hooks + clean/smudge filter + CI guard)

ALL the git-side logic lives in the **workflows repo**, so it works the same via
CM, WS, or a plain `git` user. Commit (one-time) the
[`workflows-repo-guard/`](../workflows-repo-guard/README.md) files: the whole
`.githooks/` dir (the clean/smudge filter `server-filter.mjs`, the id-maintenance
`wf-hooks.mjs`, the `validate-workflows.mjs` validator, and the `pre-commit` /
`pre-push` / `post-merge` / `post-checkout` hooks), plus `.gitattributes`
(`params.json filter=cmserver`), `.gitignore` (`workflow-envtable.json`), and the
CI action.

Each clone then activates them with local git config: `core.hooksPath .githooks`
+ `filter.cmserver.clean`/`.smudge`. **CM does this automatically**
(`installGitIntegration`) at boot and before every git op — this is the "CM
initializes hooks before working with the WF repo" step. A clone that skips it
commits real URLs unchanged, which the CI guard catches (and pings Discord). CM
runs no bespoke sanitize/restore of its own — `git add`/`commit`/`pull` simply
trigger the repo's hooks + filter.

## Branch model

A small fixed set: `test → (preprod) → main`. **Agents are pinned to `test`** —
the MCP `switch_branch` tool refuses anything else and `publish` only ever
targets the work branch, so an agent can never reach `main`/`preprod`. Humans
promote between branches through the git host (merge request), then **Update**
in the app to pull. Publishing is squash + fast-forward-only; it never merges.

## Save / Update / Publish (no git vocabulary surfaced)

- **Save** — writes the workflow's files locally (your working copy).
- **Update** — pulls the latest. Conflict-free and recoverable: your changed
  workflows are snapshotted to History first, the tree is reset to the latest.
  As the working tree is rewritten the smudge filter re-applies each workflow's
  env-local serverUrl from the envtable, so your server bindings survive. Never
  merges.
- **Publish** — squashes your changes into one commit, fast-forward pushes. The
  clean filter strips every serverUrl to the placeholder as it stages, so no
  real URL ever reaches git. Refused when you're behind — the banner shows
  **Update** (not Publish) in that case.
- **Discard** — throw away all local changes (snapshotted to History first),
  back to the last commit. Doesn't pull.

There is **no edit lock**: workflows are files edited concurrently from CM, MCP,
and the git repo directly. Two people editing the exact same workflow at the
same instant is rare — last save wins, the other refreshes. Conflicts are
prevented at **publish** (refused when behind), not by locking edits.

## Server bindings

Committed `params.json` always holds `serverUrl: "http://127.0.0.1:8188"`. A
workflow's real binding lives in two places this env owns:

- **`workflow-envtable.json`** (gitignored, at the workflows root) — keyed by
  the workflow's `metadata.json` id (committed, shared across clones), storing
  the binding **verbatim**: either a literal URL or a `<globalEnv.key>`
  expression. The clean filter records it on commit; the smudge filter restores
  it on checkout/update. A missing entry → the workflow falls back to the
  placeholder in git.
- **`WS_CONFIG_PATH`** (`workflowStudio.globalEnv`, a flat `key → url | url[]`
  map) — where a `<globalEnv.key>` expression resolves to a real URL or pool.
  Operator-maintained in Workflow Studio; **CM only reads it.**

Bind a workflow's server in the editor's server picker: pick an existing
globalEnv key (writes the `<globalEnv.key>` expression) or type a literal URL /
pick a registered server. CM never creates globalEnv keys — define new pools in
WS config. `GET /api/global-env/block` shows the snippet of keys your workflows
reference, to paste into WS config.

## Repo-side guard (the non-CM path)

Commits made straight to the repo by **other** clients (a user's clone, Claude
editing the checkout) bypass CM. The guard for those lives in the **workflows
repo itself**: a GitHub Actions check running `validate-workflows.mjs`, which
fails (and posts a Discord notice when `DISCORD_WEBHOOK_URL` is set) if any
committed `serverUrl` isn't the placeholder — i.e. the clean filter wasn't
configured on that clone. Make it a required check with branch protection on
`main`/`preprod`. The ready-to-install artifacts + instructions are in
[`workflows-repo-guard/`](../workflows-repo-guard/README.md).
