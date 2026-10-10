import { readdir } from "node:fs/promises";

import type { Tool } from "../types.ts";
import { optString, resolveInside, truncate } from "./util.ts";

export const lsTool: Tool = {
  name: "ls",
  risk: "read",
  description: "List the entries of a directory. Folders end with '/'.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory, defaults to the current folder" },
    },
  },
  async execute(args) {
    const dir = resolveInside(optString(args, "path") ?? ".");
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return truncate(
      entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n") ||
        "(empty)",
    );
  },
};
