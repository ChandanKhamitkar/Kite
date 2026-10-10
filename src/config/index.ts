import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseRules, type Rules } from "../permissions/index.ts";

export type Config = {
  provider: string;
  model?: string;
  maxTurns: number;
  /** Overrides the provider's own context window (tokens). */
  contextWindow?: number;
  /** Compact when the context passes this fraction of the window. */
  compactAt: number;
  /** Messages kept verbatim when compacting. */
  keepRecent: number;
  /** Extra instructions appended to the system prompt. */
  systemPrompt?: string;
  permissions: Rules;
};

export const DEFAULTS: Config = {
  provider: "anthropic-xkiro",
  maxTurns: 20,
  compactAt: 0.8,
  keepRecent: 6,
  permissions: {},
};

/** Where kite keeps global config and sessions. KITE_HOME overrides it. */
export function kiteHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.KITE_HOME || join(homedir(), ".kite");
}

type Layer = Partial<Omit<Config, "permissions">> & { permissions?: Rules };

function readLayer(file: string): Layer {
  if (!existsSync(file)) return {};
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    throw new Error(`invalid config ${file}: ${(error as Error).message}`);
  }
  return validate(raw, file);
}

function validate(raw: Record<string, unknown>, source: string): Layer {
  const layer: Layer = {};
  const str = (key: "provider" | "model" | "systemPrompt") => {
    if (raw[key] === undefined) return;
    if (typeof raw[key] !== "string")
      throw new Error(`invalid config ${source}: "${key}" must be a string`);
    layer[key] = raw[key] as string;
  };
  const num = (
    key: "maxTurns" | "contextWindow" | "compactAt" | "keepRecent",
    ok: (n: number) => boolean,
    hint: string,
  ) => {
    if (raw[key] === undefined) return;
    const n = raw[key];
    if (typeof n !== "number" || !Number.isFinite(n) || !ok(n))
      throw new Error(`invalid config ${source}: "${key}" must be ${hint}`);
    layer[key] = n;
  };

  str("provider");
  str("model");
  str("systemPrompt");
  num("maxTurns", (n) => Number.isInteger(n) && n > 0, "a positive integer");
  num("contextWindow", (n) => Number.isInteger(n) && n > 0, "a positive integer");
  num("compactAt", (n) => n > 0 && n <= 1, "a number between 0 and 1");
  num("keepRecent", (n) => Number.isInteger(n) && n >= 1, "an integer >= 1");
  if (raw.permissions !== undefined) layer.permissions = parseRules(raw.permissions);
  return layer;
}

function fromEnv(env: NodeJS.ProcessEnv): Layer {
  const raw: Record<string, unknown> = {};
  if (env.KITE_PROVIDER) raw.provider = env.KITE_PROVIDER;
  if (env.KITE_MODEL) raw.model = env.KITE_MODEL;
  if (env.KITE_MAX_TURNS) raw.maxTurns = Number(env.KITE_MAX_TURNS);
  if (env.KITE_CONTEXT_WINDOW) raw.contextWindow = Number(env.KITE_CONTEXT_WINDOW);
  return validate(raw, "environment (KITE_*)");
}

export type LoadOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Command-line flags; the highest priority. */
  flags?: Layer;
};

/**
 * Precedence, lowest to highest:
 *   defaults < ~/.kite/config.json < <cwd>/.kite.json < KITE_* env < flags
 * Scalars: the highest layer wins. Permission rules: lists are concatenated,
 * so a deny rule in any layer always applies.
 */
export function loadConfig(opts: LoadOptions = {}): Config {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const layers: Layer[] = [
    readLayer(join(kiteHome(env), "config.json")),
    readLayer(join(cwd, ".kite.json")),
    fromEnv(env),
    opts.flags ?? {},
  ];

  const config: Config = { ...DEFAULTS, permissions: {} };
  const allow: string[] = [];
  const deny: string[] = [];
  for (const layer of layers) {
    const { permissions, ...scalars } = layer;
    for (const [key, value] of Object.entries(scalars))
      if (value !== undefined) (config as Record<string, unknown>)[key] = value;
    allow.push(...(permissions?.allow ?? []));
    deny.push(...(permissions?.deny ?? []));
  }
  config.permissions = { allow, deny };
  return config;
}
