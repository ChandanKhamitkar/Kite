import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_OUTPUT_CHARS = 30_000;

/** Resolve a user/model supplied path, refusing anything outside the cwd. */
export function resolveInside(path: string): string {
  const root = realpathSync(process.cwd());
  const full = resolve(root, path);

  // Follow symlinks on the nearest existing ancestor, so a link cannot escape.
  let existing = full;
  while (!existsSync(existing) && dirname(existing) !== existing) {
    existing = dirname(existing);
  }
  const real = resolve(realpathSync(existing), relative(existing, full));

  const rel = relative(root, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path "${path}" is outside the working directory`);
  }
  return full;
}

/** Path relative to the cwd, with forward slashes (stable for the model). */
export function display(full: string): string {
  return relative(process.cwd(), full).split(sep).join("/") || ".";
}

export function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated: ${text.length - max} more characters]`;
}

export function reqString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`"${key}" must be a string`);
  return value;
}

export function optString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`"${key}" must be a string`);
  return value;
}

export function optNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`"${key}" must be a number`);
  return value;
}

export function optBool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}
