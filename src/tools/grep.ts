import { readFile, stat } from "node:fs/promises";

import type { Tool } from "../types.ts";
import { display, optBool, optString, reqString, resolveInside } from "./util.ts";
import { matcher, walk } from "./walk.ts";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1_000_000;

export const grepTool: Tool = {
  name: "grep",
  risk: "read",
  description:
    "Search file contents with a regular expression. Returns 'path:line:text'. Skips node_modules, .git and binary files.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression" },
      path: { type: "string", description: "Folder or file, defaults to the current folder" },
      glob: { type: "string", description: "Only search files matching this glob, e.g. '*.ts'" },
      ignore_case: { type: "boolean", description: "Case-insensitive search" },
    },
    required: ["pattern"],
  },
  async execute(args) {
    const re = new RegExp(reqString(args, "pattern"), optBool(args, "ignore_case") ? "i" : "");
    const target = resolveInside(optString(args, "path") ?? ".");
    const globArg = optString(args, "glob");
    const isDir = (await stat(target)).isDirectory();
    const include = globArg && isDir ? matcher(globArg, target) : () => true;

    const out: string[] = [];
    const files = isDir ? walk(target) : [target];
    for await (const file of files) {
      if (!include(file)) continue;
      if ((await stat(file)).size > MAX_FILE_BYTES) continue;
      const text = await readFile(file, "utf-8");
      if (text.slice(0, 8000).includes("\0")) continue;

      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i]!)) continue;
        if (out.length === MAX_MATCHES)
          return `${out.join("\n")}\n[truncated: more than ${MAX_MATCHES} matches]`;
        out.push(`${display(file)}:${i + 1}:${lines[i]!.trimEnd().slice(0, 300)}`);
      }
    }
    return out.join("\n") || "No matches";
  },
};
