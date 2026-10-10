import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** Recursively list files under `dir` (absolute paths), skipping noise dirs. */
export async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/** Glob -> RegExp. Supports **, *, ? and {a,b}. */
export function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Patterns without "/" match the basename; others match the relative path. */
export function matcher(glob: string, base: string): (full: string) => boolean {
  const re = globToRegex(glob);
  const byName = !glob.includes("/");
  return (full) => {
    const rel = relative(base, full).split(sep).join("/");
    return re.test(byName ? rel.slice(rel.lastIndexOf("/") + 1) : rel);
  };
}
