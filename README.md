# open-linear-sync

A per-project OpenCode companion that stores your Linear selections locally, then syncs Linear and GitHub automatically via git hooks and CI: hooks update Linear on local PR activity, and the GitHub Action updates Linear on PR events, with merged PRs creating follow-up issues and branches.

## What it does

- Interactive init: choose team, project, assignee from your Linear account.
- Local hooks + GitHub Actions keep Linear updated with PR status.
- Merged PRs trigger a follow-up issue and a new branch (PR created once commits exist).

## Install

```bash
npm install -g open-linear-sync
```

## Initialize (per project)

```bash
open-linear-sync init
```

This stores a per-project config in `.open-linear-sync/config.json` (gitignored).

## Install hooks and CI

```bash
open-linear-sync install
```

This will:

- Create `.husky/` hooks that call `open-linear-sync sync`.
- Create `.github/workflows/open-linear-sync.yml` for PR events.

## Manual sync

```bash
open-linear-sync sync
```

## Environment variables

- `LINEAR_API_KEY` (required unless stored in config)
- `LINEAR_PROJECT_ID`
- `LINEAR_TEAM_ID`
- `LINEAR_ASSIGNEE_ID`
- `LINEAR_AUTO_NEXT=0` to disable auto follow-up issues

## OpenCode plugin

Add the plugin file to your OpenCode config:

```json
"plugin": [
  "open-linear-sync"
]
```

Then place `open-linear-sync` in your OpenCode plugins directory or use a local file path.
