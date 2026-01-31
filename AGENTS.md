# AGENTS.md

This repository is a small Node.js CLI + OpenCode plugin. Keep changes minimal and aligned with existing JS style.

## Quick orientation

- Entry points: `src/cli.js` (CLI) and `src/index.js` (OpenCode plugin export).
- Verification: `npm run verify` runs `scripts/verify.js` which calls `node src/cli.js help`.
- Runtime: Node.js >= 18, ES modules (`"type": "module"` in `package.json`).

## Build / lint / test commands

There is no build step and no lint config. Tests run with Node.js built-in test runner.

- Verify (only provided script):
  - `npm run verify`
  - Script: `scripts/verify.js` (spawns `node src/cli.js help`).
- Tests:
  - `npm test` (runs `node --test`)

### Single test execution

- Run a single file: `node --test test/cli.test.js`
- Filter by name: `node --test --test-name-pattern="sync"`

## Code style and conventions

### Language and modules

- JavaScript (ESM). Use `import`/`export` and keep `"type": "module"` semantics.
- Prefer `async/await` for async flows; return Promises explicitly when needed.

### Imports

- Use ES module imports: `import fs from "fs"`.
- Prefer Node core imports first, then third-party, then local.
- Do not introduce `require`.

### Formatting

- Use double quotes for strings.
- Use semicolons.
- Include trailing commas in multiline object/array literals and function calls.
- Keep lines readable; wrap long template strings with concatenation where appropriate.

### Naming

- `camelCase` for variables and functions.
- `PascalCase` for exported plugin factory (see `OpenLinearSyncPlugin`).
- Constants are `const` by default; use `let` only when reassigned.
- Prefer descriptive names (`configPath`, `repoRoot`, `handleMergedPr`).

### Functions and structure

- Keep functions small and single-purpose; helpers live in the same file.
- Prefer pure helpers when possible (e.g., `extractIdentifier`, `shellQuote`).
- Favor early returns for error conditions.

### Error handling and logging

- Use `try/catch` only where needed; surface errors with context.
- Log with explicit prefixes (`[open-linear-sync]`, `[verify]`).
- For user-facing failures, set `process.exitCode = 1` or `process.exit(1)` as in `src/cli.js`.
- Avoid silent failures; use `console.warn` for non-fatal warnings.

### CLI behavior

- Keep CLI commands idempotent when possible (`install` should be safe to re-run).
- Follow current argument parsing style (`--mode=` only) unless expanding intentionally.
- Ensure CLI keeps working without `gh` available; it should warn and exit gracefully.

## Repo-specific behavior notes

- `open-linear-sync init` stores config in `.open-linear-sync/config.json` (gitignored).
- `open-linear-sync install` creates `.husky/` scripts and `.github/workflows/open-linear-sync.yml`.
- `open-linear-sync sync` supports `--mode=ci-pr` and hook modes.

## Local development workflow

- Run `node src/cli.js help` to sanity check the CLI entry point.
- Prefer `npm run verify` before handing off changes.
- There is no dev server or build pipeline; edits are used directly by Node.

## Configuration and data files

- Per-repo settings live at `.open-linear-sync/config.json`.
- The config file stores `apiKey`, `teamId`, `projectId`, and `assigneeId`.
- The config directory is gitignored; do not commit secrets.

## Environment variables

- `LINEAR_API_KEY` overrides config `apiKey`.
- `LINEAR_TEAM_ID`, `LINEAR_PROJECT_ID`, `LINEAR_ASSIGNEE_ID` can override config.
- `LINEAR_AUTO_NEXT=0` disables follow-up issue creation.
- `LINEAR_NEXT_TITLE` overrides the follow-up issue title.

## Git and GitHub integration

- CLI shells out to `git` and `gh` via `execSync`/`spawnSync`.
- If `gh` is missing, commands should warn and exit gracefully.
- When creating PRs, respect the current base branch and avoid force pushes.

## Linear API usage

- API calls use `https.request` with GraphQL payloads.
- Keep queries/mutations inlined as template strings; avoid new dependencies.
- Reject on GraphQL errors and surface the first error message.

## Data formatting and output

- CLI output uses plain text with explicit prefixes.
- Keep messages short and actionable; use `console.warn` for non-fatal states.
- Preserve existing output wording where possible to avoid breaking scripts.

## Files to check when editing

- `src/cli.js`: main logic, Linear API requests, git/gh integrations.
- `src/index.js`: OpenCode plugin (system transform).
- `scripts/verify.js`: validation hook for CI/local verification.

## Change safety notes

- Avoid refactors while fixing bugs; keep diffs minimal.
- Do not introduce new CLI flags unless requested.
- Preserve `--mode=` parsing style to avoid breaking hooks.
- Keep hooks and workflow templates idempotent.

## Cursor / Copilot rules

- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` found in this repo.
- If any are added later, incorporate them here and follow them.

## Contributing guardrails for agents

- Keep changes minimal and avoid refactors when fixing bugs.
- Do not add dependencies unless required.
- Do not add TypeScript or a build step without explicit request.
- Do not change the CLI command interface unless requested.
- Update `README.md` if user-visible behavior changes.

## Suggested verification flow

1. `npm run verify`
2. Manual sanity check: `node src/cli.js help`

## Notes on environment

- Requires `gh` CLI for PR integration; handle missing `gh` gracefully.
- Linear API key is required via `LINEAR_API_KEY` or stored config.
