# Git-managed workflows — operator guide

Workflows live as folders on disk (`WORKFLOWS_DIR`). With this feature on, that
directory is a **git repo** (the Workflow Studio repo) shared across
environments. Keeping real per-env server URLs out of git is **entirely the WS
repo's job**, via its own committed hooks — CM does none of that. CM just reads
and edits `params.json`, runs plain git, and resolves `globalEnv.<key>` tokens
for display. This guide covers turning it on, the repo setup, the branch model,
and how server URLs work.

## The workflows repo must be its OWN clone

`WORKFLOWS_DIR` must point at a **separate git checkout of the WS repo**, not at
a folder nested inside Coffee Maker's own checkout. CM refuses to operate unless
the resolved repo carries the WS hook script (`.githooks/server-urls.mjs`) —
this guard stops it from ever touching the wrong repo (e.g. CM's own checkout).
If git status reports *"WORKFLOWS_DIR is not a configured workflows git repo"*,
the directory isn't a WS-repo checkout.

Workflows may live at the repo root or under a **`workflows/` subfolder**; point
`WORKFLOWS_DIR` at wherever the workflow folders are (e.g.
`/srv/cm-workflows/workflows`). CM resolves the repo root + subdir from git and
scopes all operations to that subtree — it never touches the repo's other files.

## Enabling

Off by default — set these on the **api** container (see `api/.env.example`):

| Var | Meaning |
| --- | --- |
| `GIT_WORKFLOWS_ENABLED` | Master flag. `false` → pure-FS, none of the below is read. |
| `GIT_REMOTE` | Tokenless GitHub HTTPS URL of the **WS** repo, e.g. `https://github.com/<owner>/<repo>.git`. |
| `GIT_TOKEN` | GitHub PAT (**Contents: read/write**). Injected into the remote at call time as `x-access-token:<PAT>@…`, **never** written to `.git/config`. |
| `GIT_SSL_NO_VERIFY` | Set to `1` if the remote uses a self-signed / corporate CA the container doesn't trust (git inherits it from the process env). |
| `GIT_WORK_BRANCH` | Default `test`. Where agents/MCP and the app publish. |
| `GIT_DEFAULT_BRANCH` | Default `main`. Promotion target; agents can't push here. |
| `GIT_STAGING_BRANCH` | Optional, e.g. `preprod` (3-branch flow). |

No serverUrl config on CM: the WS repo's smudge filter restores the real URL into
the working tree, so CM reads it straight from `params.json`.

The checkout must have the branches (`test`/`main`/`preprod`) created locally.
`git` is in the api image.

## Repo setup (the WS repo owns it)

ALL the serverUrl logic lives in the **WS repo**, so it works the same via CM, WS,
or a plain `git` user. See [`workflow-studio/README.md`](../workflow-studio/README.md)
for the one-time setup: the committed `.githooks/server-urls.mjs` clean/smudge
filter + `pre-commit` id hook, the `.gitattributes` (`params.json filter=cmserver`)
and the `.gitignore` (`workflow-envmap.json`), plus the per-clone activation.

**CM activates the integration automatically** (`installGitIntegration` sets
`core.hooksPath` **and** the `filter.cmserver.clean`/`.smudge` config at boot and
before every git op). Without that filter config the hooks don't run — CM would
commit real URLs and never restore them. A clone that skips activation commits
real URLs unchanged, which the WS repo's CI guard catches.

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
  The smudge filter restores your real serverUrls from `workflow-envmap.json` as
  the tree is rewritten. Never merges.
- **Publish** — squashes your changes into one commit, fast-forward pushes. The
  clean filter swaps every serverUrl to the localhost placeholder (recording the
  real URL into `workflow-envmap.json`) as it commits, so no real URL ever reaches
  git. Refused when you're behind — the banner shows **Update** (not Publish).
- **Discard** — throw away all local changes (snapshotted to History first),
  back to the last commit. Doesn't pull.

There is **no edit lock**: workflows are files edited concurrently from CM, MCP,
and the git repo directly. Last save wins, the other refreshes. Conflicts are
prevented at **publish** (refused when behind), not by locking edits.

## Server URLs

CM always reads, shows, and writes the **real URL** straight from
`params.json` — the WS repo's smudge filter has already restored it into the
working tree. There is no token/resolution layer in CM. Keeping the URL out of
git is entirely the WS repo's clean/smudge filter:

- git always stores the localhost placeholder;
- your real URL lives in the gitignored `workflow-envmap.json`, keyed by the
  workflow's `metadata.json` id;
- **editing a serverUrl is not a publishable change** — the clean filter masks it,
  so it never appears in `git diff`/status and CM's dirty count ignores it.

Set a workflow's server in the editor's server picker: pick a registered server
or type a URL. CM writes the real URL into `params.json`; the filter records it
into the envmap on the next git op. A workflow still on the placeholder (fresh
clone) is flagged by the "N need a server" nudge.

## Repo-side guard (the non-CM path)

Commits made straight to the repo by **other** clients (a user's clone, Claude
editing the checkout) bypass CM. The guard for those lives in the **WS repo
itself**: a GitHub Actions check that fails if any committed `serverUrl` is a
real URL rather than the placeholder — i.e. the filter wasn't active on that
clone. Make it a required check with branch protection on `main`/`preprod`. See
[`workflow-studio/README.md`](../workflow-studio/README.md).
