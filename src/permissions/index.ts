import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Tool, ToolCallBlock } from "../types.ts";
import { truncate } from "../tools/util.ts";

export type Verdict = "allow" | "deny" | "allow_session";
export type Decision = { allow: boolean; reason?: string };

/** Asks the human. Return "allow_session" to stop asking about this tool. */
export type Ask = (call: ToolCallBlock, tool: Tool) => Promise<Verdict>;
export type Authorizer = (call: ToolCallBlock, tool: Tool) => Promise<Decision>;

/**
 * Rule syntax: `tool` or `tool:pattern`, where `*` matches anything.
 * The pattern is tested against the call's main argument (see primaryArg).
 *   "bash:npm test*"   "edit:src/*"   "git_commit"
 */
export type Rules = { allow?: string[]; deny?: string[] };

export type AuthorizerOptions = {
  ask?: Ask;
  /** Skip prompts (deny rules still apply). */
  yes?: boolean;
  rules?: Rules;
};

export function primaryArg(call: ToolCallBlock): string {
  const a = call.arguments;
  for (const key of ["command", "path", "message"]) {
    if (typeof a[key] === "string") return a[key] as string;
  }
  return "";
}

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "s");
}

export function matchesRule(rule: string, call: ToolCallBlock): boolean {
  const colon = rule.indexOf(":");
  const name = colon === -1 ? rule : rule.slice(0, colon);
  if (name !== call.name) return false;
  if (colon === -1) return true;
  return wildcard(rule.slice(colon + 1)).test(primaryArg(call));
}

export function createAuthorizer(opts: AuthorizerOptions = {}): Authorizer {
  const { ask, yes = false, rules = {} } = opts;
  const sessionAllowed = new Set<string>();

  return async (call, tool) => {
    if (rules.deny?.some((r) => matchesRule(r, call)))
      return { allow: false, reason: "blocked by a deny rule in config" };

    // A tool with no declared risk is treated as the most dangerous kind.
    if ((tool.risk ?? "exec") === "read") return { allow: true };
    if (yes) return { allow: true };
    if (rules.allow?.some((r) => matchesRule(r, call))) return { allow: true };
    if (sessionAllowed.has(call.name)) return { allow: true };

    if (!ask)
      return {
        allow: false,
        reason: `${call.name} needs permission and no prompt is available (run interactively, or pass --yes)`,
      };

    const verdict = await ask(call, tool);
    if (verdict === "deny")
      return { allow: false, reason: "the user denied this tool call" };
    if (verdict === "allow_session") sessionAllowed.add(call.name);
    return { allow: true };
  };
}

/** Read `permissions: { allow, deny }` from <dir>/.kite.json (if present). */
export function loadRules(dir = process.cwd()): Rules {
  const file = join(dir, ".kite.json");
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    throw new Error(`could not parse ${file}: ${(error as Error).message}`);
  }
  const perms = (parsed as { permissions?: Record<string, unknown> })
    ?.permissions;
  const list = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === "string")
      ? (v as string[])
      : undefined;
  return { allow: list(perms?.allow), deny: list(perms?.deny) };
}

/** Human-readable summary of a call, for permission prompts. */
export function describeCall(call: ToolCallBlock): string {
  const a = call.arguments;
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const lines = (s: string, mark: string) =>
    truncate(s, 600)
      .split("\n")
      .map((l) => `    ${mark} ${l}`)
      .join("\n");

  switch (call.name) {
    case "bash":
      return `  $ ${str("command")}`;
    case "write":
      return `  ${str("path")} (${str("content").length} characters)`;
    case "edit":
      return `  ${str("path")}\n${lines(str("old_string"), "-")}\n${lines(str("new_string"), "+")}`;
    default:
      return `  ${truncate(JSON.stringify(a), 400)}`;
  }
}
