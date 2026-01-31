#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "src", "cli.js");

if (!fs.existsSync(cliPath)) {
  console.error("[verify] Missing src/cli.js");
  process.exit(1);
}

const result = spawnSync("node", [cliPath, "help"], { stdio: "inherit" });
process.exit(result.status ?? 1);
