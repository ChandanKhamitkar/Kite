import { execFile } from "node:child_process";

import type { Tool } from "../types.ts";
import { optBool, optNumber, optString, reqString, truncate } from "./util.ts";

function git(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: process.cwd(), maxBuffer: 10_000_000, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim()));
        else resolve(truncate(stdout.trimEnd()) || "(no output)");
      },
    );
  });
}

export const gitStatusTool: Tool = {
  name: "git_status",
  risk: "read",
  description: "Show the working tree status (short format with branch).",
  parameters: { type: "object", properties: {} },
  execute: () => git(["status", "--short", "--branch"]),
};

export const gitDiffTool: Tool = {
  name: "git_diff",
  risk: "read",
  description: "Show changes. Set staged=true for staged changes; optionally limit to one path.",
  parameters: {
    type: "object",
    properties: {
      staged: { type: "boolean", description: "Diff the index instead of the working tree" },
      path: { type: "string", description: "Limit to this path" },
    },
  },
  execute(args) {
    const cmd = ["diff"];
    if (optBool(args, "staged")) cmd.push("--staged");
    const path = optString(args, "path");
    if (path) cmd.push("--", path);
    return git(cmd);
  },
};

export const gitLogTool: Tool = {
  name: "git_log",
  risk: "read",
  description: "Show recent commits, one per line.",
  parameters: {
    type: "object",
    properties: {
      count: { type: "number", description: "How many commits (default 10, max 100)" },
    },
  },
  execute(args) {
    const n = Math.min(Math.max(Math.floor(optNumber(args, "count") ?? 10), 1), 100);
    return git(["log", "--oneline", "--decorate", `-n${n}`]);
  },
};

export const gitCommitTool: Tool = {
  name: "git_commit",
  risk: "exec",
  description:
    "Stage the given paths (or everything if none given) and create a commit with the message.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message" },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Paths to stage; omit to stage all changes",
      },
    },
    required: ["message"],
  },
  async execute(args) {
    const message = reqString(args, "message");
    if (!message.trim()) throw new Error("commit message must not be empty");
    const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
    await git(paths.length ? ["add", "--", ...paths] : ["add", "-A"]);
    return git(["commit", "-m", message]);
  },
};
