import { readFile, writeFile } from "node:fs/promises";

import type { Tool } from "../types.ts";
import { display, optBool, reqString, resolveInside } from "./util.ts";

export const editTool: Tool = {
  name: "edit",
  risk: "write",
  description:
    "Edit a file by replacing an exact string. `old_string` must match exactly once (include surrounding lines to make it unique), unless replace_all is true.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path, relative to the current folder" },
      old_string: { type: "string", description: "Exact text to replace" },
      new_string: { type: "string", description: "Replacement text" },
      replace_all: { type: "boolean", description: "Replace every occurrence" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(args) {
    const full = resolveInside(reqString(args, "path"));
    const oldString = reqString(args, "old_string");
    const newString = reqString(args, "new_string");
    if (oldString === "") throw new Error("old_string must not be empty");
    if (oldString === newString) throw new Error("old_string and new_string are identical");

    const text = await readFile(full, "utf-8");
    const count = text.split(oldString).length - 1;
    if (count === 0) throw new Error("old_string not found in file");
    const all = optBool(args, "replace_all");
    if (count > 1 && !all)
      throw new Error(`old_string matches ${count} times; add more context or set replace_all`);

    // callback / split-join avoid `$` replacement patterns in new_string.
    const next = all
      ? text.split(oldString).join(newString)
      : text.replace(oldString, () => newString);
    await writeFile(full, next, "utf-8");
    const n = all ? count : 1;
    return `Edited ${display(full)} (${n} replacement${n === 1 ? "" : "s"})`;
  },
};
