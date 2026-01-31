import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "src", "cli.js");
const nodeBin = process.execPath;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "open-linear-sync-"));
}

function runCli(args, options = {}) {
  const result = spawnSync(nodeBin, [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

test("init requires a TTY", () => {
  const cwd = makeTempDir();
  const result = runCli(["init"], { cwd });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Init requires a TTY/);
});

test("install writes hooks and workflow", () => {
  const cwd = makeTempDir();
  const result = runCli(["install"], { cwd });

  assert.equal(result.status, 0);

  const huskyShim = path.join(cwd, ".husky", "_", "husky.sh");
  const postPush = path.join(cwd, ".husky", "post-push");
  const postCheckout = path.join(cwd, ".husky", "post-checkout");
  const postMerge = path.join(cwd, ".husky", "post-merge");
  const workflow = path.join(
    cwd,
    ".github",
    "workflows",
    "open-linear-sync.yml",
  );
  const gitignore = path.join(cwd, ".gitignore");

  assert.ok(fs.existsSync(huskyShim));
  assert.ok(fs.existsSync(postPush));
  assert.ok(fs.existsSync(postCheckout));
  assert.ok(fs.existsSync(postMerge));
  assert.ok(fs.existsSync(workflow));
  assert.ok(fs.existsSync(gitignore));
  assert.match(fs.readFileSync(gitignore, "utf8"), /\.open-linear-sync\//);
});

test("sync ci-pr mode warns on missing identifier", () => {
  const cwd = makeTempDir();
  const eventPath = path.join(cwd, "event.json");

  fs.writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: {
        title: "chore: update docs",
        head: { ref: "feature/no-identifier" },
        base: { ref: "main" },
        html_url: "https://example.com/pr/1",
        state: "open",
      },
    }),
  );

  const result = runCli(["sync", "--mode=ci-pr"], {
    cwd,
    env: {
      LINEAR_API_KEY: "test-key",
      GITHUB_EVENT_PATH: eventPath,
    },
  });

  assert.equal(result.status, 0);
  assert.match(
    result.stderr,
    /No Linear identifier found in PR title or branch/,
  );
});
