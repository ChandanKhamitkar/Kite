import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { truncate } from "../tools/util.ts";

const INSTRUCTION_FILES = ["KITE.md", "AGENTS.md"];

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function gitSummary(cwd: string): string {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return "not a git repository";
  const changed = git(cwd, ["status", "--short"]);
  const count = changed ? changed.split("\n").length : 0;
  return `branch ${branch}, ${count === 0 ? "clean" : `${count} changed file${count === 1 ? "" : "s"}`}`;
}

export type PromptOptions = {
  cwd?: string;
  /** Extra instructions from config. */
  extra?: string;
  now?: Date;
};

export function buildSystemPrompt(opts: PromptOptions = {}): string {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? new Date();

  const parts = [
    `You are Kite, a coding agent running in the user's terminal. You help with software engineering tasks by reading, searching and editing files and by running commands, using the tools provided.

Guidelines:
- Explore before acting: use ls, find and grep instead of guessing paths. Read a file before editing it.
- Prefer \`edit\` over \`write\` for existing files, and make the smallest change that solves the task.
- Verify your work when you can (run the tests or the build with bash).
- The user may deny a tool call. If so, do not retry the same call; explain or choose another approach.
- Be concise. Say what you did and anything the user needs to decide.`,
    `Environment:
- Working directory: ${cwd}
- Platform: ${process.platform}
- Date: ${now.toISOString().slice(0, 10)}
- Git: ${gitSummary(cwd)}`,
  ];

  for (const name of INSTRUCTION_FILES) {
    const file = join(cwd, name);
    if (existsSync(file)) {
      parts.push(`Project instructions (${name}):\n${truncate(readFileSync(file, "utf-8").trim(), 8000)}`);
      break;
    }
  }
  if (opts.extra?.trim()) parts.push(opts.extra.trim());
  return parts.join("\n\n");
}
