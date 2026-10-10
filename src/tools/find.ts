import type { Tool } from "../types.ts";
import { display, optString, reqString, resolveInside } from "./util.ts";
import { matcher, walk } from "./walk.ts";

const MAX_RESULTS = 500;

export const findTool: Tool = {
  name: "find",
  risk: "read",
  description:
    "Find files by glob pattern (e.g. '*.ts', 'src/**/*.test.ts'). Skips node_modules and .git.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern" },
      path: { type: "string", description: "Folder to search, defaults to the current folder" },
    },
    required: ["pattern"],
  },
  async execute(args) {
    const base = resolveInside(optString(args, "path") ?? ".");
    const isMatch = matcher(reqString(args, "pattern"), base);
    const found: string[] = [];
    for await (const file of walk(base)) {
      if (!isMatch(file)) continue;
      if (found.length === MAX_RESULTS)
        return `${found.join("\n")}\n[truncated: more than ${MAX_RESULTS} matches]`;
      found.push(display(file));
    }
    return found.join("\n") || "No files found";
  },
};
