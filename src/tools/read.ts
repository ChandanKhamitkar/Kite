import { readFile } from "node:fs/promises";

import type { Tool } from "../types.ts";
import { optNumber, reqString, resolveInside, truncate } from "./util.ts";

export const readTool: Tool = {
  name: "read",
  risk: "read",
  description:
    "Read a text file and return its contents. Use offset/limit (1-based line numbers) for large files.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file, relative to the current folder",
      },
      offset: { type: "number", description: "First line to return (1-based)" },
      limit: { type: "number", description: "Maximum number of lines" },
    },
    required: ["path"],
  },
  async execute(args) {
    const text = await readFile(resolveInside(reqString(args, "path")), "utf-8");
    const offset = optNumber(args, "offset");
    const limit = optNumber(args, "limit");
    if (offset === undefined && limit === undefined) return truncate(text);

    const lines = text.split("\n");
    const start = Math.max((offset ?? 1) - 1, 0);
    const end = limit === undefined ? lines.length : start + Math.max(limit, 0);
    return truncate(lines.slice(start, end).join("\n"));
  },
};
