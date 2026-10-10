import type { Tool } from "../types.ts";
import { bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { findTool } from "./find.ts";
import { gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool } from "./git.ts";
import { grepTool } from "./grep.ts";
import { lsTool } from "./ls.ts";
import { readTool } from "./read.ts";
import { writeTool } from "./write.ts";

export const tools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  lsTool,
  findTool,
  grepTool,
  bashTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
];
