# Workflows repo guard

`validate-workflows.mjs` is the **repo-side** secrets/JSON guard for the
**Claude-direct git path** — when an agent (or a person) commits straight to the
workflows repo, bypassing Coffee Maker's in-app validate-on-publish. It mirrors
the in-app check, so the two can't drift.

It rejects, in any workflow's `params.json`:

- a `comfyui_config.serverUrl` that is a **literal, non-loopback URL/IP** — real
  server URLs are env-specific and must be bound to a `globalEnv.<key>` token;
  `127.0.0.1` / `localhost` are allowed as unbound placeholders;
- **invalid JSON** in `params.json` or `workflow.json`.

```bash
node validate-workflows.mjs <repo-checkout-dir>   # exits 1 on any violation
node validate-workflows.mjs --selftest            # built-in sanity checks
node validate-workflows.test.mjs                  # fixture-based test
```

## Wiring

The check belongs on the **workflows** repo, not on coffee-maker. Copy
`validate-workflows.mjs` into that repo (or vendor it) and pick the path that
matches the host.

### Self-hosted git (GitLab, Gitea, bare repo): pre-receive hook

Server-side, so it blocks the push to **every** branch — including the agents'
work branch. Install `pre-receive.sample` as the bare repo's
`hooks/pre-receive` (and `chmod +x`), editing the path to the validator.

### GitHub: required CI check + branch protection

GitHub has no server-side pre-receive, so it can't block the push to `test`
itself — but it **gates the merge**. Add `validate-workflows.github-actions.yml`
under `.github/workflows/`, then in repo settings mark the job a **required
status check** and enable **branch protection on `main` and `preprod`**. A
commit with a literal URL then can never reach `main`/`preprod` — the
acceptance guarantee — even though it may briefly land on `test`.
