#!/usr/bin/env node
import fs from "fs";
import path from "path";
import https from "https";
import { execSync, spawnSync } from "child_process";
import readline from "readline";

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

const repoRoot = getRepoRoot();
const configPath = path.join(repoRoot, ".open-linear-sync", "config.json");
const config = readConfig(configPath);

const apiKey = process.env.LINEAR_API_KEY || config.apiKey;

const handlers = {
  init: runInit,
  install: runInstall,
  sync: runSync,
  help: showHelp,
};

const run = handlers[command || "help"] || showHelp;

Promise.resolve(run()).catch((error) => {
  console.error("[open-linear-sync] error:", error.message || error);
  process.exitCode = 1;
});

async function runInit() {
  ensureTty();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const next = { ...config };

  if (!next.apiKey) {
    next.apiKey = await ask(rl, "Linear API key: ");
  }

  if (!next.apiKey) {
    rl.close();
    throw new Error("API key is required.");
  }

  const teams = await listTeams(next.apiKey);
  const team = await chooseFromList(
    rl,
    "Select a team",
    teams,
    (item) => `${item.name} (${item.key})`,
  );

  const projects = await listProjects(next.apiKey, team?.id);
  const project = await chooseFromList(
    rl,
    "Select a project",
    projects,
    (item) => `${item.name}${item.state ? ` [${item.state}]` : ""}`,
  );

  const users = await listUsers(next.apiKey, team?.id);
  const assignee = await chooseFromList(
    rl,
    "Select an assignee (owner)",
    users,
    (item) => item.name,
  );

  next.teamId = team?.id || next.teamId;
  next.projectId = project?.id || next.projectId;
  next.assigneeId = assignee?.id || next.assigneeId;

  rl.close();

  writeConfig(configPath, next);
  console.log("[open-linear-sync] config saved.");
}

async function runInstall() {
  const huskyDir = path.join(repoRoot, ".husky");
  const huskyInternal = path.join(huskyDir, "_");
  const githubWorkflow = path.join(
    repoRoot,
    ".github",
    "workflows",
    "open-linear-sync.yml",
  );

  fs.mkdirSync(huskyInternal, { recursive: true });
  fs.mkdirSync(path.dirname(githubWorkflow), { recursive: true });

  writeFileIfMissing(path.join(huskyInternal, "husky.sh"), huskyShim());
  writeFileIfMissing(path.join(huskyDir, "post-push"), hookScript("post-push"));
  writeFileIfMissing(
    path.join(huskyDir, "post-checkout"),
    hookScript("post-checkout"),
  );
  writeFileIfMissing(
    path.join(huskyDir, "post-merge"),
    hookScript("post-merge"),
  );

  fs.chmodSync(path.join(huskyInternal, "husky.sh"), 0o755);
  fs.chmodSync(path.join(huskyDir, "post-push"), 0o755);
  fs.chmodSync(path.join(huskyDir, "post-checkout"), 0o755);
  fs.chmodSync(path.join(huskyDir, "post-merge"), 0o755);

  writeFileIfMissing(githubWorkflow, workflowTemplate());
  ensureGitignoreEntry(".open-linear-sync/");

  console.log("[open-linear-sync] hooks and workflow installed.");
}

async function runSync() {
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY is missing. Run open-linear-sync init.");
  }

  const mode = args.mode || "manual";
  const autoNext = process.env.LINEAR_AUTO_NEXT !== "0";

  if (mode === "ci-pr") {
    await syncFromCiEvent(apiKey);
    return;
  }

  if (!hasGh()) {
    console.warn("[open-linear-sync] gh is not available.");
    return;
  }

  const pr = getPrForBranch();
  if (pr) {
    await syncIssueWithPr(apiKey, pr);
  } else if (mode === "post-push") {
    await maybeCreatePr();
  }

  if (autoNext && pr && pr.state === "MERGED") {
    await handleMergedPr(apiKey, pr);
  }
}

function showHelp() {
  console.log(`open-linear-sync

Commands:
  init        interactive setup (team/project/assignee)
  install     install hooks + GitHub Action
  sync        sync Linear with PR state
`);
}

async function syncFromCiEvent(key) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.warn("[open-linear-sync] GITHUB_EVENT_PATH is missing.");
    return;
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const pr = payload.pull_request;
  if (!pr) {
    console.warn("[open-linear-sync] No pull_request payload.");
    return;
  }

  const identifier = extractIdentifier(`${pr.title} ${pr.head?.ref || ""}`);
  if (!identifier) {
    console.warn(
      "[open-linear-sync] No Linear identifier found in PR title or branch.",
    );
    return;
  }

  const issue = await findIssueByIdentifier(key, identifier);
  if (!issue) {
    console.warn(`[open-linear-sync] Linear issue ${identifier} not found.`);
    return;
  }

  await addPrComment(key, issue.id, {
    url: pr.html_url,
    state: pr.merged ? "MERGED" : pr.state.toUpperCase(),
    title: pr.title,
    branch: pr.head?.ref || "",
    base: pr.base?.ref || "",
  });
}

async function syncIssueWithPr(key, pr) {
  const identifier = extractIdentifier(`${pr.title} ${pr.headRefName}`);
  if (!identifier) {
    console.warn(
      "[open-linear-sync] No Linear identifier found in PR title or branch.",
    );
    return;
  }

  const issue = await findIssueByIdentifier(key, identifier);
  if (!issue) {
    console.warn(`[open-linear-sync] Linear issue ${identifier} not found.`);
    return;
  }

  await addPrComment(key, issue.id, {
    url: pr.url,
    state: pr.state,
    title: pr.title,
    branch: pr.headRefName,
    base: pr.baseRefName,
  });
}

async function handleMergedPr(key, pr) {
  const identifier = extractIdentifier(`${pr.title} ${pr.headRefName}`);
  if (!identifier) {
    console.warn(
      "[open-linear-sync] No Linear identifier found for merged PR.",
    );
    return;
  }

  const issue = await findIssueByIdentifier(key, identifier);
  if (!issue) {
    console.warn(`[open-linear-sync] Linear issue ${identifier} not found.`);
    return;
  }

  const nextTitle =
    process.env.LINEAR_NEXT_TITLE || `Follow-up: ${issue.title}`;
  const nextIssue = await createFollowUpIssue(key, issue, nextTitle);
  if (!nextIssue) {
    return;
  }

  const baseBranch = pr.baseRefName || getDefaultBranch();
  const newBranch = createNewBranch(nextIssue.identifier, baseBranch);
  if (!newBranch) {
    return;
  }

  await maybeCreatePr();
}

async function createFollowUpIssue(key, issue, title) {
  const input = {
    title,
    teamId: issue.team?.id || config.teamId || process.env.LINEAR_TEAM_ID,
    projectId:
      issue.project?.id || config.projectId || process.env.LINEAR_PROJECT_ID,
    assigneeId:
      issue.assignee?.id || config.assigneeId || process.env.LINEAR_ASSIGNEE_ID,
    description: `Auto-created after merge of ${issue.identifier}.`,
  };

  if (!input.teamId || !input.projectId || !input.assigneeId) {
    console.warn(
      "[open-linear-sync] Missing team/project/assignee for follow-up issue.",
    );
    return null;
  }

  const result = await linearRequest(
    key,
    `mutation IssueCreate($input: IssueCreateInput!) {\n` +
      `  issueCreate(input: $input) {\n` +
      `    issue { id identifier title }\n` +
      `  }\n` +
      `}`,
    { input },
  );

  return result?.issueCreate?.issue || null;
}

async function maybeCreatePr() {
  if (!hasGh()) {
    return;
  }

  const existing = getPrForBranch();
  if (existing) {
    return;
  }

  const branch = git("rev-parse --abbrev-ref HEAD");
  const baseBranch = getDefaultBranch();
  const aheadCount = Number(git(`rev-list --count ${baseBranch}..${branch}`));
  if (!aheadCount) {
    console.warn(
      "[open-linear-sync] No commits ahead of base. PR creation deferred.",
    );
    return;
  }

  const identifier = extractIdentifier(branch);
  const issueTitle = identifier
    ? `${identifier} follow-up`
    : `Follow-up ${branch}`;
  const prTitle = identifier ? `${identifier} ${issueTitle}` : issueTitle;

  try {
    gh(
      `pr create --title ${shellQuote(prTitle)} --body ${shellQuote("Auto-created PR.")} --base ${shellQuote(
        baseBranch,
      )} --head ${shellQuote(branch)}`,
    );
  } catch {
    console.warn("[open-linear-sync] Failed to create PR.");
  }
}

function createNewBranch(identifier, baseBranch) {
  if (!identifier) {
    console.warn("[open-linear-sync] Missing identifier for new branch.");
    return null;
  }

  let branch = `linear/${identifier}`;
  let suffix = 1;

  while (branchExists(branch)) {
    suffix += 1;
    branch = `linear/${identifier}-${suffix}`;
  }

  try {
    git(`checkout ${shellQuote(baseBranch)}`);
    git(`checkout -b ${shellQuote(branch)}`);
    return branch;
  } catch {
    console.warn("[open-linear-sync] Failed to create branch.");
    return null;
  }
}

function getPrForBranch() {
  try {
    const output = gh(
      "pr view --json number,state,mergedAt,url,title,headRefName,baseRefName --jq .",
    );
    const pr = JSON.parse(output);
    return {
      number: pr.number,
      state: pr.mergedAt ? "MERGED" : (pr.state || "").toUpperCase(),
      url: pr.url,
      title: pr.title,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
    };
  } catch {
    return null;
  }
}

function getDefaultBranch() {
  try {
    const ref = git("symbolic-ref --short refs/remotes/origin/HEAD");
    return ref.replace("origin/", "");
  } catch {
    return "main";
  }
}

async function findIssueByIdentifier(key, identifier) {
  const result = await linearRequest(
    key,
    `query IssueByIdentifier($identifier: String!) {\n` +
      `  issues(filter: { identifier: { eq: $identifier } }) {\n` +
      `    nodes { id identifier title team { id } project { id } assignee { id } }\n` +
      `  }\n` +
      `}`,
    { identifier },
  );

  return result?.issues?.nodes?.[0] || null;
}

async function addPrComment(key, issueId, details) {
  const body = [
    "PR update",
    `- URL: ${details.url}`,
    `- State: ${details.state}`,
    `- Title: ${details.title}`,
    `- Branch: ${details.branch}`,
    `- Base: ${details.base}`,
  ].join("\n");

  await linearRequest(
    key,
    `mutation CommentCreate($input: CommentCreateInput!) {\n` +
      `  commentCreate(input: $input) {\n` +
      `    comment { id }\n` +
      `  }\n` +
      `}`,
    { input: { issueId, body } },
  );
}

async function listTeams(key) {
  const result = await linearRequest(
    key,
    `query Teams { teams { nodes { id name key } } }`,
    {},
  );
  return result?.teams?.nodes || [];
}

async function listProjects(key, teamId) {
  if (teamId) {
    try {
      const result = await linearRequest(
        key,
        `query TeamProjects($teamId: String!) {\n` +
          `  team(id: $teamId) {\n` +
          `    projects {\n` +
          `      nodes { id name state }\n` +
          `    }\n` +
          `  }\n` +
          `}`,
        { teamId },
      );
      return result?.team?.projects?.nodes || [];
    } catch (error) {
      console.warn(
        "[open-linear-sync] Failed to filter projects by team. Listing all projects.",
      );
    }
  }

  const result = await linearRequest(
    key,
    `query Projects {\n` +
      `  projects {\n` +
      `    nodes { id name state }\n` +
      `  }\n` +
      `}`,
    {},
  );
  return result?.projects?.nodes || [];
}

async function listUsers(key, teamId) {
  if (teamId) {
    try {
      const result = await linearRequest(
        key,
        `query TeamMembers($teamId: String!) {\n` +
          `  team(id: $teamId) {\n` +
          `    members {\n` +
          `      nodes { id name email }\n` +
          `    }\n` +
          `  }\n` +
          `}`,
        { teamId },
      );
      return result?.team?.members?.nodes || [];
    } catch {
      console.warn(
        "[open-linear-sync] Failed to filter users by team. Listing all users.",
      );
    }
  }

  const result = await linearRequest(
    key,
    `query Users {\n` +
      `  users {\n` +
      `    nodes { id name email }\n` +
      `  }\n` +
      `}`,
    {},
  );
  return result?.users?.nodes || [];
}

function linearRequest(key, query, variables) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables });
    const req = https.request(
      {
        hostname: "api.linear.app",
        path: "/graphql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: key,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.errors?.length) {
              reject(new Error(json.errors[0]?.message || "Linear API error"));
              return;
            }
            resolve(json.data || {});
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function writeConfig(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readConfig(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function ensureTty() {
  if (!process.stdin.isTTY) {
    throw new Error("Init requires a TTY.");
  }
}

function chooseFromList(rl, title, items, formatItem) {
  if (!items.length) {
    console.warn(`[open-linear-sync] ${title}: no options found.`);
    return Promise.resolve(null);
  }

  console.log(`\n${title}`);
  items.forEach((item, index) => {
    console.log(`${index + 1}. ${formatItem(item)}`);
  });

  return new Promise((resolve) => {
    const askLoop = async () => {
      const answer = await ask(rl, "Enter number: ");
      const choice = Number(answer);
      if (Number.isInteger(choice) && choice >= 1 && choice <= items.length) {
        resolve(items[choice - 1]);
        return;
      }
      console.log("Invalid selection.");
      askLoop();
    };
    askLoop();
  });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (arg.startsWith("--mode=")) {
      acc.mode = arg.split("=")[1];
    }
    return acc;
  }, {});
}

function extractIdentifier(text) {
  const match = text.match(/[A-Z]{2,10}-\d+/);
  return match ? match[0] : null;
}

function hasGh() {
  return spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
}

function git(command) {
  return execSync(`git ${command}`, { encoding: "utf8" }).trim();
}

function gh(command) {
  return execSync(`gh ${command}`, { encoding: "utf8" }).trim();
}

function branchExists(branch) {
  return (
    spawnSync("git", [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]).status === 0
  );
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function getRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
    }).trim();
  } catch {
    return process.cwd();
  }
}

function hookScript(mode) {
  return `#!/usr/bin/env sh\n. "$(dirname -- \"$0\")/_/husky.sh"\n\nopen-linear-sync sync --mode=${mode}\n`;
}

function huskyShim() {
  return `#!/usr/bin/env sh\nif [ -z \"\${HUSKY}\" ]; then\n  export HUSKY=1\nfi\n\nif [ \"\${HUSKY}\" = \"0\" ]; then\n  exit 0\nfi\n`;
}

function workflowTemplate() {
  return (
    `name: Open Linear Sync\n\n` +
    `on:\n  pull_request:\n    types: [opened, edited, synchronize, reopened, closed]\n\n` +
    `jobs:\n  linear-sync:\n    runs-on: ubuntu-latest\n    steps:\n` +
    `      - name: Checkout\n        uses: actions/checkout@v4\n\n` +
    `      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: '18'\n\n` +
    `      - name: Install open-linear-sync\n        run: npm install -g open-linear-sync\n\n` +
    `      - name: Sync Linear issue\n        env:\n          LINEAR_API_KEY: \${{ secrets.LINEAR_API_KEY }}\n        run: open-linear-sync sync --mode=ci-pr\n`
  );
}

function writeFileIfMissing(filePath, contents) {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.writeFileSync(filePath, contents);
}

function ensureGitignoreEntry(entry) {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";
  if (existing.split("\n").includes(entry)) {
    return;
  }
  const next = existing ? `${existing.trim()}\n${entry}\n` : `${entry}\n`;
  fs.writeFileSync(gitignorePath, next);
}
