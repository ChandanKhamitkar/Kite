import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Tool } from "../types.ts";
import { display, reqString, resolveInside } from "./util.ts";

export const writeTool: Tool = {
  name: "write",
  risk: "write",
  description:
    "Create a file, or overwrite it completely. Parent folders are created. Prefer `edit` for changing existing files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path, relative to the current folder" },
      content: { type: "string", description: "Full file contents" },
    },
    required: ["path", "content"],
  },
  async execute(args) {
    const full = resolveInside(reqString(args, "path"));
    const content = reqString(args, "content");
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf-8");
    return `Wrote ${content.length} characters to ${display(full)}`;
  },
};
